import { redirect } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await prisma.storeConfig.findUnique({ where: { shop } });
  if (!config) return redirect("/app");

  const connections = await prisma.storeConnection.findMany({
    where: { OR: [{ parentShop: shop }, { childShop: shop }] },
    select: { id: true, parentShop: true, childShop: true },
  });

  const connectionIds = connections.map((c) => c.id);
  const connectionMap = Object.fromEntries(connections.map((c) => [c.id, c]));

  const logs = await prisma.syncLog.findMany({
    where: { connectionId: { in: connectionIds } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return { logs, connectionMap, shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clearLogs") {
    const connections = await prisma.storeConnection.findMany({
      where: { OR: [{ parentShop: shop }, { childShop: shop }] },
      select: { id: true },
    });
    const ids = connections.map((c) => c.id);
    await prisma.syncLog.deleteMany({ where: { connectionId: { in: ids } } });
    return { cleared: true };
  }

  return null;
};

const STATUS_TONE = {
  success: "success",
  error: "critical",
  running: "subdued",
};

export default function Logs() {
  const { logs, connectionMap, shop } = useLoaderData();
  const fetcher = useFetcher();
  const isLoading = fetcher.state !== "idle";
  const cleared = fetcher.data?.cleared;

  const clearLogs = () => {
    if (confirm("Clear all sync logs for this store? This cannot be undone.")) {
      fetcher.submit({ intent: "clearLogs" }, { method: "post" });
    }
  };

  const displayLogs = cleared ? [] : logs;

  return (
    <s-page heading="Sync Logs">
      <s-button slot="primary-action" href="/app/dashboard" variant="tertiary">
        ← Dashboard
      </s-button>

      {/* Summary counts */}
      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <s-paragraph>
            <s-text>Total logs: {displayLogs.length}</s-text>
          </s-paragraph>
          <s-paragraph>
            <s-text tone="success">
              ✅ Successful:{" "}
              {displayLogs.filter((l) => l.status === "success").length}
            </s-text>
          </s-paragraph>
          <s-paragraph>
            <s-text tone="critical">
              ❌ Errors:{" "}
              {displayLogs.filter((l) => l.status === "error").length}
            </s-text>
          </s-paragraph>
        </s-stack>
        {displayLogs.length > 0 && (
          <s-button
            tone="critical"
            variant="tertiary"
            onClick={clearLogs}
            {...(isLoading ? { loading: true } : {})}
          >
            Clear All Logs
          </s-button>
        )}
      </s-section>

      {displayLogs.length === 0 ? (
        <s-section heading="No logs yet">
          <s-paragraph>
            Sync logs will appear here after your first sync operation.
          </s-paragraph>
        </s-section>
      ) : (
        displayLogs.map((log) => {
          const conn = connectionMap[log.connectionId];
          if (!conn) return null;
          const isParent = conn.parentShop === shop;
          const other = isParent ? conn.childShop : conn.parentShop;
          const direction = isParent ? `→ ${other}` : `← ${other}`;

          let details = null;
          if (log.details) {
            try {
              details = JSON.parse(log.details);
            } catch {
              details = null;
            }
          }

          const errorItems = details?.filter((d) => d.action === "error") ?? [];

          return (
            <s-section
              key={log.id}
              heading={`${direction} — ${new Date(log.createdAt).toLocaleString()}`}
            >
              <s-stack direction="block" gap="tight">
                <s-paragraph>
                  <s-text
                    tone={STATUS_TONE[log.status] ?? "subdued"}
                  >
                    Status: {log.status.toUpperCase()}
                  </s-text>
                </s-paragraph>

                <s-paragraph>
                  <s-text>
                    {log.synced} processed — {log.created} created,{" "}
                    {log.updated} updated, {log.errors} errors
                  </s-text>
                </s-paragraph>

                {errorItems.length > 0 && (
                  <s-paragraph>
                    <s-text tone="critical">
                      Failed product IDs:{" "}
                      {errorItems
                        .slice(0, 5)
                        .map((e) => e.productId?.split("/").pop())
                        .join(", ")}
                      {errorItems.length > 5
                        ? ` +${errorItems.length - 5} more`
                        : ""}
                    </s-text>
                  </s-paragraph>
                )}

                <s-paragraph>
                  <s-link href={`/app/connections/${log.connectionId}`}>
                    View connection settings
                  </s-link>
                </s-paragraph>
              </s-stack>
            </s-section>
          );
        })
      )}
    </s-page>
  );
}