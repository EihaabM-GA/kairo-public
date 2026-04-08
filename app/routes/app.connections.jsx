import { redirect } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
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
    // Normalise domains — strip protocol, lowercase, trim
    const normalize = (v) =>
      (v || "")
        .trim()
        .toLowerCase()
        .replace(/https?:\/\//, "")
        .replace(/\/$/, "");

    const rawParent = formData.get("parentShop");
    const rawChild = formData.get("childShop");

    const ps = normalize(rawParent) || shop;
    const cs = normalize(rawChild) || shop;

    if (!ps) return { error: "Parent shop domain is required." };
    if (!cs) return { error: "Child shop domain is required." };
    if (ps === cs) return { error: "Parent and child cannot be the same store." };

    const existing = await prisma.storeConnection.findUnique({
      where: { parentShop_childShop: { parentShop: ps, childShop: cs } },
    });
    if (existing) return { error: "A connection between these two stores already exists." };

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
            autoSync: false,
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
    const conn = await prisma.storeConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) return { error: "Connection not found." };
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
  const navigate = useNavigate();

  const canBeParent = role === "parent" || role === "both";
  const canBeChild = role === "child" || role === "both";

  // KEY FIX: use fetcher.submit() for all mutations
  const createConnection = () => {
    const parentInput = document.getElementById("ks-parentShop");
    const childInput = document.getElementById("ks-childShop");
    const data = { intent: "create" };
    if (canBeParent) {
      data.parentShop = shop;
      data.childShop = childInput?.value ?? "";
    } else {
      data.childShop = shop;
      data.parentShop = parentInput?.value ?? "";
    }
    fetcher.submit(data, { method: "post" });
  };

  const toggleConnection = (connectionId) => {
    fetcher.submit({ intent: "toggle", connectionId }, { method: "post" });
  };

  const deleteConnection = (connectionId) => {
    if (confirm("Permanently delete this connection and all its sync history?")) {
      fetcher.submit({ intent: "delete", connectionId }, { method: "post" });
    }
  };

  return (
    <s-page heading="Connections">
      <s-button slot="primary-action" href="/app/dashboard" variant="tertiary">
        ← Dashboard
      </s-button>

      {/* Add new connection */}
      <s-section heading="Add New Connection">
        {actionData?.error && (
          <s-paragraph>
            <s-text tone="critical">⚠️ {actionData.error}</s-text>
          </s-paragraph>
        )}

        <s-stack direction="block" gap="base">
          {canBeParent && (
            <s-stack direction="block" gap="tight">
              <s-paragraph>
                <s-text>
                  This store (<strong>{shop}</strong>) will push products TO:
                </s-text>
              </s-paragraph>
              <s-text-field
                id="ks-childShop"
                label="Child store domain"
                placeholder="other-store.myshopify.com"
              />
            </s-stack>
          )}

          {canBeChild && !canBeParent && (
            <s-stack direction="block" gap="tight">
              <s-paragraph>
                <s-text>
                  This store (<strong>{shop}</strong>) will receive products FROM:
                </s-text>
              </s-paragraph>
              <s-text-field
                id="ks-parentShop"
                label="Parent store domain"
                placeholder="parent-store.myshopify.com"
              />
            </s-stack>
          )}

          {canBeParent && canBeChild && (
            <s-paragraph>
              <s-text tone="subdued">
                Your role is "Both" — you're adding a connection where this store is the parent (pusher).
                To add one where this store is the child, update your role first.
              </s-text>
            </s-paragraph>
          )}

          <s-button
            onClick={createConnection}
            {...(isLoading ? { loading: true } : {})}
          >
            Create Connection
          </s-button>
        </s-stack>
      </s-section>

      {/* Existing connections */}
      {connections.length === 0 ? (
        <s-section heading="No connections yet">
          <s-paragraph>
            Add your first connection above to start syncing products between stores.
          </s-paragraph>
        </s-section>
      ) : (
        connections.map((conn) => {
          const isParent = conn.parentShop === shop;
          const other = isParent ? conn.childShop : conn.parentShop;
          const isPaused = conn.status === "paused";

          return (
            <s-section
              key={conn.id}
              heading={isParent ? `→ Pushing to ${other}` : `← Receiving from ${other}`}
            >
              <s-stack direction="block" gap="tight">
                <s-paragraph>
                  <s-text>
                    Status: {isPaused ? "⏸ Paused" : "✅ Active"}
                  </s-text>
                </s-paragraph>
                {conn.syncSettings?.lastSyncAt && (
                  <s-paragraph>
                    <s-text>
                      Last sync:{" "}
                      {new Date(conn.syncSettings.lastSyncAt).toLocaleString()}
                    </s-text>
                  </s-paragraph>
                )}

                <s-stack direction="inline" gap="tight">
                  <s-button
                    onClick={() => navigate(`/app/connections/${conn.id}`)}
                    variant="secondary"
                  >
                    Configure
                  </s-button>
                  <s-button
                    variant="tertiary"
                    onClick={() => toggleConnection(conn.id)}
                    {...(isLoading ? { loading: true } : {})}
                  >
                    {isPaused ? "Resume" : "Pause"}
                  </s-button>
                  <s-button
                    tone="critical"
                    variant="tertiary"
                    onClick={() => deleteConnection(conn.id)}
                    {...(isLoading ? { loading: true } : {})}
                  >
                    Delete
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          );
        })
      )}
    </s-page>
  );
}