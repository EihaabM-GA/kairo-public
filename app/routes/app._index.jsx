import { redirect } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await prisma.storeConfig.findUnique({
    where: { shop: session.shop },
  });
  if (config) return redirect("/app/dashboard");
  return { shop: session.shop };
};

// Every route calling authenticate.admin() needs this — see app.jsx comment.
export const headers = (headersArgs) => boundary.headers(headersArgs);

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const role = formData.get("role");
  if (!["parent", "child", "both"].includes(role)) {
    return { error: "Invalid role selected." };
  }
  await prisma.storeConfig.upsert({
    where: { shop: session.shop },
    update: { role },
    create: { shop: session.shop, role },
  });
  return redirect("/app/dashboard");
};

export default function Onboarding() {
  const { shop } = useLoaderData();
  const fetcher = useFetcher();
  const isLoading = fetcher.state !== "idle";
  const selectRole = (role) => fetcher.submit({ role }, { method: "post" });

  return (
    <s-page heading="Welcome to Kairo Sync">
      <s-section heading={`Setting up ${shop}`}>
        <s-paragraph>
          Kairo keeps your Shopify stores in sync. Choose how this store will
          participate. You can always add more connections later.
        </s-paragraph>
      </s-section>

      {fetcher.data?.error && (
        <s-section heading="">
          <s-paragraph>
            <s-text tone="critical">⚠️ {fetcher.data.error}</s-text>
          </s-paragraph>
        </s-section>
      )}

      <s-section heading="What role does this store play?">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-heading>🏪 Parent Store</s-heading>
              <s-paragraph>
                This store owns the products. Changes here will push to
                connected child stores automatically or on demand.
              </s-paragraph>
              <s-button onClick={() => selectRole("parent")} {...(isLoading ? { loading: true } : {})}>
                Set as Parent
              </s-button>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-heading>🏬 Child Store</s-heading>
              <s-paragraph>
                This store receives products from a parent. Inventory and
                product data will be synced in from another store.
              </s-paragraph>
              <s-button variant="secondary" onClick={() => selectRole("child")} {...(isLoading ? { loading: true } : {})}>
                Set as Child
              </s-button>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-heading>🔄 Both</s-heading>
              <s-paragraph>
                This store can act as both a parent and a child — syncing to
                some stores while receiving from others.
              </s-paragraph>
              <s-button variant="tertiary" onClick={() => selectRole("both")} {...(isLoading ? { loading: true } : {})}>
                Set as Both
              </s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}