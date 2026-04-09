import shopify from "./shopify.server";
import prisma from "./db.server";

// ─────────────────────────────────────────────────────────────────────────────
// ROOT FIX: shopify.api is undefined in @shopify/shopify-app-react-router.
//
// The correct pattern for server-side / background GraphQL calls (sync jobs,
// webhooks, scheduled tasks) is:
//
//   const { admin } = await shopify.unauthenticated.admin(shopDomain);
//   const res = await admin.graphql(QUERY, { variables });
//   const json = await res.json();
//
// unauthenticated.admin() looks up the offline session from storage itself.
// You never need shopify.api.clients or raw session objects.
// ─────────────────────────────────────────────────────────────────────────────

async function gql(shop, query, variables = {}) {
  let admin;
  try {
    ({ admin } = await shopify.unauthenticated.admin(shop));
  } catch (err) {
    throw new Error(
      `No OAuth session found for ${shop}. ` +
        `Make sure the app is installed on that store and it has re-authenticated ` +
        `after the latest deployment. (${err.message})`
    );
  }

  const response = await admin.graphql(query, { variables });
  const json = await response.json();

  if (json.errors?.length) {
    throw new Error(
      `GraphQL error for ${shop}: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }

  return json.data;
}

// ─── GraphQL documents ───────────────────────────────────────────────────────

const PRODUCTS_QUERY = `#graphql
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title descriptionHtml vendor tags status
        images(first: 10) { nodes { src altText } }
        variants(first: 10) {
          nodes { id sku price inventoryQuantity inventoryItem { id } }
        }
      }
    }
  }
`;

const PRODUCTS_BY_IDS = `#graphql
  query ProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id title descriptionHtml vendor tags status
        images(first: 10) { nodes { src altText } }
        variants(first: 10) {
          nodes { id sku price inventoryQuantity inventoryItem { id } }
        }
      }
    }
  }
`;

const FIND_BY_SKU = `#graphql
  query FindBySku($q: String!) {
    products(first: 5, query: $q) {
      nodes {
        id
        variants(first: 10) {
          nodes { id sku inventoryQuantity inventoryItem { id } }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS = `#graphql
  query ProductVariants($id: ID!) {
    product(id: $id) {
      variants(first: 10) {
        nodes { id sku inventoryQuantity inventoryItem { id } }
      }
    }
  }
`;

const LOCATIONS = `#graphql
  query { locations(first: 1) { nodes { id } } }
`;

const CREATE_PRODUCT = `#graphql
  mutation CreateProductForSync($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        variants(first: 10) {
          nodes {
            id
            price
            inventoryItem { id }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_PRODUCT = `#graphql
  mutation UpdateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANTS = `#graphql
  mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

const ADJUST_INVENTORY = `#graphql
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup { id }
      userErrors { field message }
    }
  }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applyPricing(price, rule) {
  if (!rule || rule.adjustment === 0) return String(price);
  const p = parseFloat(price);
  return rule.type === "percentage"
    ? (p * (1 + rule.adjustment / 100)).toFixed(2)
    : (p + rule.adjustment).toFixed(2);
}

async function fetchAllProducts(parentShop) {
  const all = [];
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const data = await gql(parentShop, PRODUCTS_QUERY, { cursor });
    all.push(...data.products.nodes);
    hasMore = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }
  return all;
}

// ─── Per-product sync ────────────────────────────────────────────────────────

async function syncOneProduct(parentProduct, parentShop, childShop, connection, pricingRule) {
  const settings = connection.syncSettings;
  const sku = parentProduct.variants.nodes[0]?.sku;

  let map = await prisma.productMap.findUnique({
    where: {
      connectionId_parentProductId: {
        connectionId: connection.id,
        parentProductId: parentProduct.id,
      },
    },
  });

  let childProductId = map?.childProductId;

  // No mapping — try to find by SKU in the child store
  if (!childProductId && sku) {
    const found = await gql(childShop, FIND_BY_SKU, { q: `sku:${sku}` });
    const match = found.products.nodes.find((p) =>
      p.variants.nodes.some((v) => v.sku === sku)
    );
    if (match) {
      childProductId = match.id;
      await prisma.productMap.upsert({
        where: {
          connectionId_parentProductId: {
            connectionId: connection.id,
            parentProductId: parentProduct.id,
          },
        },
        update: { childProductId, parentSku: sku, syncedAt: new Date() },
        create: {
          connectionId: connection.id,
          parentProductId: parentProduct.id,
          childProductId,
          parentSku: sku,
          syncedAt: new Date(),
        },
      });
    }
  }

  // ── EXISTING PRODUCT — update toggled fields ──────────────────────────────
  if (childProductId) {
    const childData = await gql(childShop, PRODUCT_VARIANTS, { id: childProductId });
    const childVariants = childData.product?.variants.nodes || [];

    if (settings?.syncInventory) {
      const locData = await gql(childShop, LOCATIONS);
      const locationId = locData.locations.nodes[0]?.id;
      if (locationId) {
        const changes = [];
        for (const pv of parentProduct.variants.nodes) {
          const cv = childVariants.find(
            (v) => v.sku === pv.sku || (!pv.sku && !v.sku)
          );
          if (cv && pv.inventoryQuantity != null) {
            const delta = pv.inventoryQuantity - (cv.inventoryQuantity || 0);
            if (delta !== 0) {
              changes.push({ inventoryItemId: cv.inventoryItem.id, locationId, delta });
            }
          }
        }
        if (changes.length > 0) {
          await gql(childShop, ADJUST_INVENTORY, {
            input: { reason: "correction", name: "available", changes },
          });
        }
      }
    }

    const updateInput = { id: childProductId };
    let hasUpdate = false;
    if (settings?.syncTitle)       { updateInput.title = parentProduct.title; hasUpdate = true; }
    if (settings?.syncDescription) { updateInput.descriptionHtml = parentProduct.descriptionHtml; hasUpdate = true; }
    if (settings?.syncTags)        { updateInput.tags = parentProduct.tags; hasUpdate = true; }
    if (settings?.syncVendor)      { updateInput.vendor = parentProduct.vendor; hasUpdate = true; }
    if (hasUpdate) {
      await gql(childShop, UPDATE_PRODUCT, { product: updateInput });
    }

    if (settings?.syncPrice) {
      const variantUpdates = parentProduct.variants.nodes
        .map((pv) => {
          const cv = childVariants.find(
            (v) => v.sku === pv.sku || (!pv.sku && !v.sku)
          );
          return cv ? { id: cv.id, price: applyPricing(pv.price, pricingRule) } : null;
        })
        .filter(Boolean);
      if (variantUpdates.length > 0) {
        await gql(childShop, UPDATE_VARIANTS, {
          productId: childProductId,
          variants: variantUpdates,
        });
      }
    }

    return { action: "updated", productId: parentProduct.id };
  }

  // ── NEW PRODUCT — create in child store ───────────────────────────────────
// ── NEW PRODUCT — create in child store ───────────────────────────────────
const productInput = { status: "ACTIVE", title: parentProduct.title };

if (settings?.syncDescription) productInput.descriptionHtml = parentProduct.descriptionHtml;
if (settings?.syncVendor)      productInput.vendor = parentProduct.vendor;
if (settings?.syncTags)        productInput.tags = parentProduct.tags;

// Build media array from parent images (if enabled)
let mediaInput;
if (settings?.syncImages && parentProduct.images.nodes.length > 0) {
  mediaInput = parentProduct.images.nodes.map((img) => ({
    originalSource: img.src,
    alt: img.altText || "",
    mediaContentType: "IMAGE",
  }));
}

// Call productCreate with product + media
const created = await gql(childShop, CREATE_PRODUCT, {
  product: productInput,
  media: mediaInput,
});

if (created.productCreate.userErrors?.length > 0) {
  return {
    action: "error",
    productId: parentProduct.id,
    errors: created.productCreate.userErrors.map((e) => e.message),
  };
}

const newId = created.productCreate.product.id;
const newVariants = created.productCreate.product.variants.nodes;

await prisma.productMap.upsert({
    where: {
      connectionId_parentProductId: {
        connectionId: connection.id,
        parentProductId: parentProduct.id,
      },
    },
    update: { childProductId: newId, parentSku: sku, syncedAt: new Date() },
    create: {
      connectionId: connection.id,
      parentProductId: parentProduct.id,
      childProductId: newId,
      parentSku: sku,
      syncedAt: new Date(),
    },
  });

  if (settings?.syncInventory && newVariants.length > 0) {
    const locData = await gql(childShop, LOCATIONS);
    const locationId = locData.locations.nodes[0]?.id;
    if (locationId) {
      const changes = newVariants
        .map((nv, i) => {
          const pv = parentProduct.variants.nodes[i];
          return pv?.inventoryQuantity
            ? { inventoryItemId: nv.inventoryItem.id, locationId, delta: pv.inventoryQuantity }
            : null;
        })
        .filter(Boolean);
      if (changes.length > 0) {
        await gql(childShop, ADJUST_INVENTORY, {
          input: { reason: "correction", name: "available", changes },
        }).catch((err) =>
          console.warn(`[sync] inventory set failed for new product ${newId}:`, err.message)
        );
      }
    }
  }

  return { action: "created", productId: parentProduct.id };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function syncConnection(connectionId, productIds = null) {
  const connection = await prisma.storeConnection.findUnique({
    where: { id: connectionId },
    include: { syncSettings: true, pricingRule: true },
  });

  if (!connection || connection.status !== "active") {
    return { error: "Connection not found or paused" };
  }

  const { parentShop, childShop } = connection;

  const log = await prisma.syncLog.create({
    data: { connectionId, status: "running" },
  });

  try {
    // Verify sessions exist up-front — gives a clear error instead of a
    // cryptic crash mid-sync if a store hasn't re-authenticated.
    try {
      await shopify.unauthenticated.admin(parentShop);
    } catch {
      throw new Error(
        `No OAuth session for parent store "${parentShop}". ` +
          `Open that store in the Shopify admin and re-open the app to re-authenticate.`
      );
    }
    try {
      await shopify.unauthenticated.admin(childShop);
    } catch {
      throw new Error(
        `No OAuth session for child store "${childShop}". ` +
          `Open that store in the Shopify admin and re-open the app to re-authenticate.`
      );
    }

    let products;
    if (productIds?.length) {
      const data = await gql(parentShop, PRODUCTS_BY_IDS, { ids: productIds });
      products = data.nodes.filter(Boolean);
    } else {
      products = await fetchAllProducts(parentShop);
    }

    let created = 0, updated = 0, errors = 0;
    const details = [];

    for (const product of products) {
      const result = await syncOneProduct(
        product,
        parentShop,
        childShop,
        connection,
        connection.pricingRule
      );
      if (result.action === "created") created++;
      else if (result.action === "updated") updated++;
      else if (result.action === "error") {
        errors++;
        console.error(`[sync] product error ${result.productId}:`, result.errors);
      }
      details.push(result);
    }

    const synced = products.length;
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: errors > 0 && errors === synced ? "error" : "success",
        synced,
        created,
        updated,
        errors,
        details: JSON.stringify(details.slice(0, 100)),
      },
    });

    if (connection.syncSettings) {
      await prisma.syncSetting.update({
        where: { connectionId },
        data: { lastSyncAt: new Date() },
      });
    }

    return { synced, created, updated, errors };
  } catch (err) {
    console.error(`[sync] syncConnection error for ${connectionId}:`, err);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "error", details: JSON.stringify([err.message]) },
    });
    return { error: err.message };
  }
}

export async function getStoreRole(shop) {
  const config = await prisma.storeConfig.findUnique({ where: { shop } });
  return config?.role ?? null;
}