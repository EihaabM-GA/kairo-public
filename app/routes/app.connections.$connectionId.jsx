import { redirect } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
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

export const headers = (headersArgs) => boundary.headers(headersArgs);

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const connectionId = params.connectionId;

  if (intent === "saveSettings") {
    const bool = (key) => formData.get(key) === "true";
    await prisma.syncSetting.upsert({
      where: { connectionId },
      update: {
        syncTitle: bool("syncTitle"),
        syncDescription: bool("syncDescription"),
        syncImages: bool("syncImages"),
        syncPrice: bool("syncPrice"),
        syncInventory: bool("syncInventory"),
        syncVendor: bool("syncVendor"),
        syncTags: bool("syncTags"),
        autoSync: bool("autoSync"),
        schedule: formData.get("schedule") || null,
      },
      create: {
        connectionId,
        syncTitle: bool("syncTitle"),
        syncDescription: bool("syncDescription"),
        syncImages: bool("syncImages"),
        syncPrice: bool("syncPrice"),
        syncInventory: bool("syncInventory"),
        syncVendor: bool("syncVendor"),
        syncTags: bool("syncTags"),
        autoSync: bool("autoSync"),
        schedule: formData.get("schedule") || null,
      },
    });
    return { saved: "settings" };
  }

  if (intent === "savePricing") {
    const type = formData.get("pricingType") || "percentage";
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

const SYNC_FIELDS = [
  { key: "syncTitle", label: "Product Title" },
  { key: "syncDescription", label: "Description" },
  { key: "syncImages", label: "Images" },
  { key: "syncPrice", label: "Price (uses pricing rule below)" },
  { key: "syncInventory", label: "Inventory Quantity" },
  { key: "syncVendor", label: "Vendor / Brand" },
  { key: "syncTags", label: "Tags" },
];

export default function ConnectionSettings() {
  const { conn } = useLoaderData();
  const fetcher = useFetcher();
  const isLoading = fetcher.state !== "idle";

  const s = conn.syncSettings;
  const p = conn.pricingRule;

  const [toggles, setToggles] = useState({
    syncTitle: s?.syncTitle ?? true,
    syncDescription: s?.syncDescription ?? true,
    syncImages: s?.syncImages ?? true,
    syncPrice: s?.syncPrice ?? false,
    syncInventory: s?.syncInventory ?? true,
    syncVendor: s?.syncVendor ?? false,
    syncTags: s?.syncTags ?? true,
    autoSync: s?.autoSync ?? false,
  });
  const [schedule, setSchedule] = useState(s?.schedule || "");
  const [pricingType, setPricingType] = useState(p?.type || "percentage");
  const [adjustment, setAdjustment] = useState(String(p?.adjustment ?? 0));

  const toggle = (key) => setToggles((prev) => ({ ...prev, [key]: !prev[key] }));

  const saveSettings = () => {
    fetcher.submit(
      {
        intent: "saveSettings",
        ...Object.fromEntries(Object.entries(toggles).map(([k, v]) => [k, String(v)])),
        schedule,
      },
      { method: "post" }
    );
  };

  const savePricing = () => {
    fetcher.submit({ intent: "savePricing", pricingType, adjustment }, { method: "post" });
  };

  const syncNow = () => {
    fetcher.submit({ intent: "syncNow" }, { method: "post" });
  };

  const saved = fetcher.data?.saved;
  const syncResult = fetcher.data?.syncResult;

  return (
    <s-page heading={`Connection: ${conn.parentShop} → ${conn.childShop}`}>
      <s-button slot="primary-action" href="/app/connections" variant="tertiary">
        ← Back
      </s-button>

      {saved && (
        <s-section heading="">
          <s-paragraph>
            <s-text tone="success">
              ✅ {saved === "settings" ? "Sync settings" : "Pricing rule"} saved successfully.
            </s-text>
          </s-paragraph>
        </s-section>
      )}

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

      <s-section heading="Manual Sync">
        <s-paragraph>Push all parent products to this child store right now.</s-paragraph>
        <s-button onClick={syncNow} {...(isLoading ? { loading: true } : {})}>
          Sync Now
        </s-button>
      </s-section>

      <s-section heading="What to Sync">
        <s-stack direction="block" gap="base">
          <s-paragraph><s-text>Toggle each field independently:</s-text></s-paragraph>

          {SYNC_FIELDS.map(({ key, label }) => (
            <s-checkbox
              key={key}
              label={label}
              {...(toggles[key] ? { checked: true } : {})}
              onChange={() => toggle(key)}
            />
          ))}

          <s-paragraph><s-text>Automatic Sync:</s-text></s-paragraph>
          <s-checkbox
            label="Enable automatic sync via webhooks (real-time on product change)"
            {...(toggles.autoSync ? { checked: true } : {})}
            onChange={() => toggle("autoSync")}
          />

          <s-select
            label="Scheduled sync interval"
            value={schedule}
            options={JSON.stringify([
              { label: "Disabled", value: "" },
              { label: "Real-time (webhook only)", value: "realtime" },
              { label: "Hourly", value: "hourly" },
              { label: "Daily", value: "daily" },
              { label: "Weekly", value: "weekly" },
            ])}
            onChange={(e) => setSchedule(e.target?.value ?? e.detail?.value ?? "")}
          />

          <s-button onClick={saveSettings} {...(isLoading ? { loading: true } : {})}>
            Save Sync Settings
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Pricing Adjustment">
        <s-paragraph>
          Adjust prices when products are synced to this child store. Applies to{" "}
          <strong>all products</strong> in this connection. Use negative values to decrease prices.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-select
            label="Adjustment type"
            value={pricingType}
            options={JSON.stringify([
              { label: "Percentage (%)", value: "percentage" },
              { label: "Fixed amount (currency units)", value: "fixed" },
            ])}
            onChange={(e) => setPricingType(e.target?.value ?? e.detail?.value ?? "percentage")}
          />
          <s-text-field
            label={
              pricingType === "percentage"
                ? "Percentage adjustment (e.g. 15 = +15%, -10 = -10%)"
                : "Fixed amount (e.g. 5.00 = +$5, -2.50 = -$2.50)"
            }
            type="number"
            value={adjustment}
            onChange={(e) => setAdjustment(e.target?.value ?? e.detail?.value ?? "0")}
          />
          <s-button onClick={savePricing} {...(isLoading ? { loading: true } : {})}>
            Save Pricing Rule
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}