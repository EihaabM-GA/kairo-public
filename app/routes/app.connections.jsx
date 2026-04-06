import { redirect } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await prisma.storeConfig.findUnique({ where: { shop } });
  if (!config) return redirect("/app");

  const connections = await prisma.storeConnection.findMany({
    where: { OR: [{ parentShop: shop }, { childShop: shop }] },
    include: { syncSettings: true, pricingRule: true },
    orderBy: { createdAt: "desc" },
  });

  return { shop, role: config.role, connections };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const childShop = formData.get("childShop")?.trim().toLowerCase().replace(/https?:\/\//, "");
    const parentShop = formData.get("parentShop")?.trim().toLowerCase().replace(/https?:\/\//, "");

    const ps = parentShop || shop;
    const cs = childShop || shop;

    if (ps === cs) return { error: "Parent and child cannot be the same store" };

    const existing = await prisma.storeConnection.findUnique({
      where: { parentShop_childShop: { parentShop: ps, childShop: cs } },
    });
    if (existing) return { error: "This connection already exists" };

    const conn = await prisma.storeConnection.create({
      data: {
        parentShop: ps,
        childShop: cs,
        syncSettings: {
          create: {
            syncTitle: true,
            syncDescription: true,
            syncImages: true,
            syncInventory: true,
            syncPrice: false,
            syncVendor: false,
            syncTags: true,
          },
        },
        pricingRule: {
          create: { type: "percentage", adjustment: 0 },
        },
      },
    });

    return redirect(`/app/connections/${conn.id}`);
  }

  if (intent === "delete") {
    const connectionId = formData.get("connectionId");
    await prisma.storeConnection.delete({ where: { id: connectionId } });
    return { deleted: true };
  }

  if (intent === "toggle") {
    const connectionId = formData.get("connectionId");
    const conn = await prisma.storeConnection.findUnique({ where: { id: connectionId } });
    await prisma.storeConnection.update({
      where: { id: connectionId },
      data: { status: conn.status === "active" ? "paused" : "active" },
    });
    return { toggled: true };
  }

  return null;
};

export default function Connections() {
  const { shop, role, connections } = useLoaderData();
  const fetcher = useFetcher();
  const isLoading = fetcher.state !== "idle";
  const actionData = fetcher.data;

  const canBeParent = role === "parent" || role === "both";
  const canBeChild  = role === "child"  || role === "both";

  return (
    <s-page heading="Connections">
      <s-section heading="Add New Connection">
        {actionData?.error && (
          <s-paragraph>
            <s-text tone="critical">⚠️ {actionData.error}</s-text>
          </s-paragraph>
        )}
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="block" gap="base">
            {canBeParent && (
              <s-stack direction="block" gap="tight">
                <s-paragraph>
                  <s-text>Push products FROM this store TO a child store:</s-text>
                </s-paragraph>
                <input type="hidden" name="parentShop" value={shop} />
                <s-text-field
                  label="Child store domain"
                  name="childShop"
                  placeholder="other-store.myshopify.com"
                />
              </s-stack>
            )}
            {canBeChild && !canBeParent && (
              <s-stack direction="block" gap="tight">
                <s-paragraph>
                  <s-text>Receive products FROM a parent store:</s-text>
                </s-paragraph>
                <input type="hidden" name="childShop" value={shop} />
                <s-text-field
                  label="Parent store domain"
                  name="parentShop"
                  placeholder="parent-store.myshopify.com"
                />
              </s-stack>
            )}
            <s-button submit {...(isLoading ? { loading: true } : {})}>
              Create Connection
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {connections.length === 0 ? (
        <s-section heading="No connections">
          <s-paragraph>Add your first connection above to get started.</s-paragraph>
        </s-section>
      ) : (
        connections.map((conn) => {
          const isParent = conn.parentShop === shop;
          const other = isParent ? conn.childShop : conn.parentShop;
          const direction = isParent ? `→ Push to ${other}` : `← Receive from ${other}`;

          return (
            <s-section key={conn.id} heading={direction}>
              <s-stack direction="inline" gap="tight">
                <s-button href={`/app/connections/${conn.id}`} variant="secondary">
                  Configure
                </s-button>
                <fetcher.Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="intent" value="toggle" />
                  <input type="hidden" name="connectionId" value={conn.id} />
                  <s-button submit variant="tertiary">
                    {conn.status === "active" ? "Pause" : "Resume"}
                  </s-button>
                </fetcher.Form>
                <fetcher.Form
                  method="post"
                  style={{ display: "inline" }}
                  onSubmit={(e) => {
                    if (!confirm("Delete this connection?")) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="connectionId" value={conn.id} />
                  <s-button submit tone="critical" variant="tertiary">
                    Delete
                  </s-button>
                </fetcher.Form>
              </s-stack>
            </s-section>
          );
        })
      )}
    </s-page>
  );
}