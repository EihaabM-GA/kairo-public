import { redirect } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncConnection } from "../sync.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const config = await prisma.storeConfig.findUnique({ where: { shop } });
  if (!config) return redirect("/app");

  const connections = await prisma.storeConnection.findMany({
    where: { OR: [{ parentShop: shop }, { childShop: shop }] },
    include: {
      syncSettings: true,
      pricingRule: true,
      syncLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return { shop, role: config.role, connections };
};

// Required on every route that calls authenticate.admin()
export const headers = (headersArgs) => boundary.headers(headersArgs);

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    const connectionId = formData.get("connectionId");
    const result = await syncConnection(connectionId);
    return { result, intent };
  }

  if (intent === "reset") {
    const shop = session.shop;
    const connections = await prisma.storeConnection.findMany({
      where: { OR: [{ parentShop: shop }, { childShop: shop }] },
    });
    for (const conn of connections) {
      await prisma.storeConnection.delete({ where: { id: conn.id } });
    }
    await prisma.storeConfig.delete({ where: { shop } });
    return redirect("/app");
  }

  return null;
};

export default function Dashboard() {
  const { shop, role, connections } = useLoaderData();
  const fetcher = useFetcher();
  const isSyncing = fetcher.state !== "idle";

  const roleLabel = {
    parent: "Parent 🏪",
    child: "Child 🏬",
    both: "Parent + Child 🔄",
  }[role] ?? role;

  const syncNow = (connectionId) =>
    fetcher.submit({ intent: "sync", connectionId }, { method: "post" });

  const resetStore = () => {
    if (confirm("This will permanently delete ALL Kairo data for this store. Are you sure?")) {
      fetcher.submit({ intent: "reset" }, { method: "post" });
    }
  };

  const syncResult = fetcher.data?.intent === "sync" ? fetcher.data?.result : null;

  return (
    <s-page heading="Kairo Sync — Dashboard">
      <s-button slot="primary-action" href="/app/connections">
        + Add Connection
      </s-button>

      <s-section heading={`This store: ${shop}`}>
        <s-paragraph><s-text>Role: {roleLabel}</s-text></s-paragraph>
        <s-paragraph>
          <s-link href="/app/connections">Manage connections</s-link>
          {" · "}
          <s-link href="/app/logs">View sync logs</s-link>
        </s-paragraph>
      </s-section>

      {syncResult && (
        <s-section heading="Sync Result">
          <s-paragraph>
            {syncResult.error ? (
              <s-text tone="critical">❌ {syncResult.error}</s-text>
            ) : (
              <s-text tone="success">
                ✅ {syncResult.synced} processed — {syncResult.created} created,{" "}
                {syncResult.updated} updated, {syncResult.errors} errors.
              </s-text>
            )}
          </s-paragraph>
        </s-section>
      )}

      {connections.length === 0 ? (
        <s-section heading="No connections yet">
          <s-paragraph>Add your first connection to start syncing products between stores.</s-paragraph>
          <s-button href="/app/connections">Add Connection</s-button>
        </s-section>
      ) : (
        connections.map((conn) => {
          const isParent = conn.parentShop === shop;
          const otherShop = isParent ? conn.childShop : conn.parentShop;
          const lastLog = conn.syncLogs?.[0];
          const lastSync = conn.syncSettings?.lastSyncAt
            ? new Date(conn.syncSettings.lastSyncAt).toLocaleString()
            : "Never";

          return (
            <s-section
              key={conn.id}
              heading={isParent ? `→ Pushing to ${otherShop}` : `← Receiving from ${otherShop}`}
            >
              <s-stack direction="block" gap="tight">
                <s-paragraph>
                  <s-text>Status: {conn.status === "active" ? "✅ Active" : "⏸ Paused"}</s-text>
                </s-paragraph>
                <s-paragraph>
                  <s-text>Last sync: {lastSync}</s-text>
                </s-paragraph>
                {lastLog && (
                  <s-paragraph>
                    <s-text>
                      Last result: {lastLog.status} — {lastLog.synced} synced,{" "}
                      {lastLog.created} created, {lastLog.updated} updated, {lastLog.errors} errors
                    </s-text>
                  </s-paragraph>
                )}
                <s-stack direction="inline" gap="tight">
                  {isParent && (
                    <s-button onClick={() => syncNow(conn.id)} {...(isSyncing ? { loading: true } : {})}>
                      Sync Now
                    </s-button>
                  )}
                  <s-button href={`/app/connections/${conn.id}`} variant="secondary">
                    Settings
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          );
        })
      )}

      <s-section slot="aside" heading="Danger Zone">
        <s-paragraph>
          Reset wipes all connections, product maps, sync logs, and pricing rules for this store.
        </s-paragraph>
        <s-button tone="critical" onClick={resetStore} {...(isSyncing ? { loading: true } : {})}>
          Reset Store
        </s-button>
      </s-section>
    </s-page>
  );
}