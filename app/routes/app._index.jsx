import { redirect } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await prisma.storeConfig.findUnique({ where: { shop: session.shop } });
  if (config) return redirect("/app/dashboard");
  return { shop: session.shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const role = formData.get("role");

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

  return (
    <s-page heading="Welcome to Kairo Sync">
      <s-section heading={`Setting up ${shop}`}>
        <s-paragraph>
          Kairo keeps your Shopify stores in sync. Choose how this store will participate.
          You can always add more connections later.
        </s-paragraph>
      </s-section>

      <s-section heading="What role does this store play?">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-heading>🏪 Parent Store</s-heading>
              <s-paragraph>
                This store owns the products. Changes here will push to connected child stores.
              </s-paragraph>
              <fetcher.Form method="post">
                <input type="hidden" name="role" value="parent" />
                <s-button submit {...(isLoading ? { loading: true } : {})}>
                  Set as Parent
                </s-button>
              </fetcher.Form>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-heading>🏬 Child Store</s-heading>
              <s-paragraph>
                This store receives products from a parent. Inventory and product data will be
                synced in from another store.
              </s-paragraph>
              <fetcher.Form method="post">
                <input type="hidden" name="role" value="child" />
                <s-button submit variant="secondary" {...(isLoading ? { loading: true } : {})}>
                  Set as Child
                </s-button>
              </fetcher.Form>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-heading>🔄 Both</s-heading>
              <s-paragraph>
                This store can act as both a parent and a child — syncing to some stores while
                receiving from others.
              </s-paragraph>
              <fetcher.Form method="post">
                <input type="hidden" name="role" value="both" />
                <s-button submit variant="tertiary" {...(isLoading ? { loading: true } : {})}>
                  Set as Both
                </s-button>
              </fetcher.Form>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}