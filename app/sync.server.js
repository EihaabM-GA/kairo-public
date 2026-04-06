import shopify from "./shopify.server";
import prisma from "./db.server";

async function getSession(shop) {
  const id = shopify.api.session.getOfflineId(shop);
  return shopify.sessionStorage.loadSession(id);
}

async function gql(session, query, variables = {}) {
  const client = new shopify.api.clients.Graphql({ session });
  const res = await client.request(query, { variables });
  return res.data;
}

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
        variants(first: 10) { nodes { id sku inventoryQuantity inventoryItem { id } } }
      }
    }
  }
`;

const PRODUCT_VARIANTS = `#graphql
  query ProductVariants($id: ID!) {
    product(id: $id) {
      variants(first: 10) { nodes { id sku inventoryQuantity inventoryItem { id } } }
    }
  }
`;

const LOCATIONS = `#graphql
  query { locations(first: 1) { nodes { id } } }
`;

const CREATE_PRODUCT = `#graphql
  mutation CreateProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        variants(first: 10) { nodes { id inventoryItem { id } } }
      }
      userErrors { field message }
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

function applyPricing(price, rule) {
  if (!rule || rule.adjustment === 0) return String(price);
  const p = parseFloat(price);
  return rule.type === "percentage"
    ? (p * (1 + rule.adjustment / 100)).toFixed(2)
    : (p + rule.adjustment).toFixed(2);
}

async function fetchAllProducts(session) {
  const all = [];
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const data = await gql(session, PRODUCTS_QUERY, { cursor });
    all.push(...data.products.nodes);
    hasMore = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }
  return all;
}

async function syncOneProduct(parentProduct, childSession, connection, pricingRule) {
  const settings = connection.syncSettings;
  const sku = parentProduct.variants.nodes[0]?.sku;

  // Look for existing mapping
  let map = await prisma.productMap.findUnique({
    where: {
      connectionId_parentProductId: {
        connectionId: connection.id,
        parentProductId: parentProduct.id,
      },
    },
  });

  let childProductId = map?.childProductId;

  // Try to find in child store by SKU if no map
  if (!childProductId && sku) {
    const found = await gql(childSession, FIND_BY_SKU, { q: `sku:${sku}` });
    const match = found.products.nodes.find((p) =>
      p.variants.nodes.some((v) => v.sku === sku)
    );
    if (match) {
      childProductId = match.id;
      map = await prisma.productMap.upsert({
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

  // — EXISTING PRODUCT: update inventory + toggled fields —
  if (childProductId) {
    const childData = await gql(childSession, PRODUCT_VARIANTS, { id: childProductId });
    const childVariants = childData.product?.variants.nodes || [];

    if (settings?.syncInventory) {
      const locData = await gql(childSession, LOCATIONS);
      const locationId = locData.locations.nodes[0]?.id;
      if (locationId) {
        const changes = [];
        for (const pv of parentProduct.variants.nodes) {
          const cv = childVariants.find((v) => v.sku === pv.sku || (!pv.sku && !v.sku));
          if (cv && pv.inventoryQuantity != null) {
            const delta = pv.inventoryQuantity - (cv.inventoryQuantity || 0);
            if (delta !== 0) changes.push({ inventoryItemId: cv.inventoryItem.id, locationId, delta });
          }
        }
        if (changes.length > 0) {
          await gql(childSession, ADJUST_INVENTORY, {
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
    if (hasUpdate) await gql(childSession, UPDATE_PRODUCT, { product: updateInput });

    if (settings?.syncPrice) {
      const variantUpdates = parentProduct.variants.nodes
        .map((pv) => {
          const cv = childVariants.find((v) => v.sku === pv.sku || (!pv.sku && !v.sku));
          return cv ? { id: cv.id, price: applyPricing(pv.price, pricingRule) } : null;
        })
        .filter(Boolean);
      if (variantUpdates.length > 0) {
        await gql(childSession, UPDATE_VARIANTS, {
          productId: childProductId,
          variants: variantUpdates,
        });
      }
    }

    return { action: "updated", productId: parentProduct.id };
  }

  // — NEW PRODUCT: create in child —
  const productInput = {
    status: "ACTIVE",
    title: parentProduct.title,
  };
  if (settings?.syncDescription) productInput.descriptionHtml = parentProduct.descriptionHtml;
  if (settings?.syncVendor)      productInput.vendor = parentProduct.vendor;
  if (settings?.syncTags)        productInput.tags = parentProduct.tags;
  if (settings?.syncImages && parentProduct.images.nodes.length > 0) {
    productInput.images = parentProduct.images.nodes.map((img) => ({
      src: img.src,
      altText: img.altText || "",
    }));
  }
  productInput.variants = parentProduct.variants.nodes.map((v) => ({
    ...(v.sku ? { sku: v.sku } : {}),
    price: settings?.syncPrice ? applyPricing(v.price, pricingRule) : v.price,
  }));

  const created = await gql(childSession, CREATE_PRODUCT, { product: productInput });

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
    const locData = await gql(childSession, LOCATIONS);
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
        await gql(childSession, ADJUST_INVENTORY, {
          input: { reason: "correction", name: "available", changes },
        }).catch(() => {});
      }
    }
  }

  return { action: "created", productId: parentProduct.id };
}

export async function syncConnection(connectionId, productIds = null) {
  const connection = await prisma.storeConnection.findUnique({
    where: { id: connectionId },
    include: { syncSettings: true, pricingRule: true },
  });

  if (!connection || connection.status !== "active") {
    return { error: "Connection not found or paused" };
  }

  const log = await prisma.syncLog.create({ data: { connectionId, status: "running" } });

  try {
    const parentSession = await getSession(connection.parentShop);
    const childSession  = await getSession(connection.childShop);

    if (!parentSession || !childSession) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: "error", details: JSON.stringify(["Missing OAuth session for a store"]) },
      });
      return { error: "Missing sessions — both stores must have the app installed" };
    }

    let products;
    if (productIds?.length) {
      const data = await gql(parentSession, PRODUCTS_BY_IDS, { ids: productIds });
      products = data.nodes.filter(Boolean);
    } else {
      products = await fetchAllProducts(parentSession);
    }

    let created = 0, updated = 0, errors = 0;
    const details = [];

    for (const product of products) {
      const result = await syncOneProduct(product, childSession, connection, connection.pricingRule);
      if (result.action === "created") created++;
      else if (result.action === "updated") updated++;
      else if (result.action === "error") errors++;
      details.push(result);
    }

    const synced = products.length;
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: errors === synced && synced > 0 ? "error" : "success",
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