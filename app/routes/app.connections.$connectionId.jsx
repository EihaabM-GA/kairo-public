import { redirect } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncConnection } from "../sync.server";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const conn = await prisma.storeConnection.findUnique({
    where: { id: params.connectionId },
    include: { syncSettings: true, pricingRule: true },
  });
  if (!conn) return redirect("/app/connections");
  return { conn };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const connectionId = params.connectionId;

  if (intent === "saveSettings") {
    const bool = (key) => formData.get(key) === "on";
    await prisma.syncSetting.upsert({
      where: { connectionId },
      update: {
        syncTitle:       bool("syncTitle"),
        syncDescription: bool("syncDescription"),
        syncImages:      bool("syncImages"),
        syncPrice:       bool("syncPrice"),
        syncInventory:   bool("syncInventory"),
        syncVendor:      bool("syncVendor"),
        syncTags:        bool("syncTags"),
        autoSync:        bool("autoSync"),
        schedule:        formData.get("schedule") || null,
      },
      create: {
        connectionId,
        syncTitle:       bool("syncTitle"),
        syncDescription: bool("syncDescription"),
        syncImages:      bool("syncImages"),
        syncPrice:       bool("syncPrice"),
        syncInventory:   bool("syncInventory"),
        syncVendor:      bool("syncVendor"),
        syncTags:        bool("syncTags"),
        autoSync:        bool("autoSync"),
        schedule:        formData.get("schedule") || null,
      },
    });
    return { saved: "settings" };
  }

  if (intent === "savePricing") {
    const type       = formData.get("pricingType");
    const adjustment = parseFloat(formData.get("adjustment") || "0");
    await prisma.pricingRule.upsert({
      where: { connectionId },
      update: { type, adjustment },
      create: { connectionId, type, adjustment },
    });
    return { saved: "pricing" };
  }

  if (intent === "syncNow") {
    const result = await syncConnection(connectionId);
    return { syncResult: result };
  }

  return null;
};

export default function ConnectionSettings() {
  const { conn } = useLoaderData();
  const fetcher = useFetcher();
  const isLoading = fetcher.state !== "idle";
  const s = conn.syncSettings;
  const p = conn.pricingRule;

  const saved = fetcher.data?.saved;
  const syncResult = fetcher.data?.syncResult;

  const checked = (val) => (val ? { checked: true } : {});

  return (
    <s-page heading={`Connection: ${conn.parentShop} → ${conn.childShop}`}>
      <s-button slot="primary-action" href="/app/connections" variant="tertiary">
        ← Back
      </s-button>

      {saved && (
        <s-section heading="">
          <s-paragraph>
            <s-text tone="success">✅ {saved === "settings" ? "Sync settings" : "Pricing rule"} saved.</s-text>
          </s-paragraph>
        </s-section>
      )}

      {syncResult && (
        <s-section heading="Sync Result">
          <s-paragraph>
            {syncResult.error ? (
              <s-text tone="critical">Error: {syncResult.error}</s-text>
            ) : (
              <s-text>
                ✅ {syncResult.synced} processed — {syncResult.created} created,{" "}
                {syncResult.updated} updated, {syncResult.errors} errors.
              </s-text>
            )}
          </s-paragraph>
        </s-section>
      )}

      {/* Manual sync */}
      <s-section heading="Sync">
        <s-paragraph>
          Manually push all parent products to this child store right now.
        </s-paragraph>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="syncNow" />
          <s-button submit {...(isLoading ? { loading: true } : {})}>
            Sync Now
          </s-button>
        </fetcher.Form>
      </s-section>

      {/* Sync settings */}
      <s-section heading="What to Sync">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="saveSettings" />
          <s-stack direction="block" gap="base">
            <s-paragraph><s-text>Toggle each field independently:</s-text></s-paragraph>

            {[
              ["syncTitle",       "Product Title"],
              ["syncDescription", "Description"],
              ["syncImages",      "Images"],
              ["syncPrice",       "Price (uses pricing rule below)"],
              ["syncInventory",   "Inventory Quantity"],
              ["syncVendor",      "Vendor / Brand"],
              ["syncTags",        "Tags"],
            ].map(([name, label]) => (
              <s-checkbox key={name} name={name} label={label} {...checked(s?.[name])} />
            ))}

            <s-paragraph>
              <s-text>Auto Sync:</s-text>
            </s-paragraph>
            <s-checkbox name="autoSync" label="Enable automatic sync via webhooks (realtime on product change)" {...checked(s?.autoSync)} />

            <s-select
              name="schedule"
              label="Scheduled sync interval (requires cron hitting /api/sync/scheduled)"
              value={s?.schedule || ""}
              options={JSON.stringify([
                { label: "Disabled", value: "" },
                { label: "Realtime (webhook)", value: "realtime" },
                { label: "Hourly", value: "hourly" },
                { label: "Daily", value: "daily" },
                { label: "Weekly", value: "weekly" },
              ])}
            />

            <s-button submit {...(isLoading ? { loading: true } : {})}>
              Save Settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* Pricing rule */}
      <s-section heading="Pricing Adjustment">
        <s-paragraph>
          Adjust the price when products are synced to this child store. Applies to all
          products in this connection. Use negative values to decrease.
        </s-paragraph>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="savePricing" />
          <s-stack direction="block" gap="base">
            <s-select
              name="pricingType"
              label="Adjustment type"
              value={p?.type || "percentage"}
              options={JSON.stringify([
                { label: "Percentage (%)", value: "percentage" },
                { label: "Fixed amount (currency)", value: "fixed" },
              ])}
            />
            <s-text-field
              name="adjustment"
              label="Adjustment value (e.g. 15 for +15%, -10 for -10%, 5.00 for +$5)"
              type="number"
              value={String(p?.adjustment ?? 0)}
            />
            <s-button submit {...(isLoading ? { loading: true } : {})}>
              Save Pricing Rule
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}