import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,

  // ─── SCOPE FIX ───────────────────────────────────────────────────────────
  // Hardcoded so nothing can be accidentally omitted from .env.
  // write_inventory + read_locations were missing — that's why every
  // inventory/locations query returned "Access denied".
  // After deploying: uninstall + reinstall BOTH stores so new tokens
  // are issued with these scopes.
  // ─────────────────────────────────────────────────────────────────────────
  scopes: [
    "read_products",
    "write_products",
    "read_inventory",
    "write_inventory",
    "read_locations",
  ],

  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // No `future` block — offline tokens don't expire by default

  hooks: {
    afterAuth: async ({ session, admin }) => {
      const response = await admin.graphql(`
        mutation {
          webhookSubscriptionCreate(
            topic: PRODUCTS_UPDATE
            webhookSubscription: {
              format: JSON
              callbackUrl: "${process.env.SHOPIFY_APP_URL}/webhooks/products/update"
            }
          ) {
            webhookSubscription { id }
            userErrors { field message }
          }
        }
      `);
      const json = await response.json();
      const errors = json?.data?.webhookSubscriptionCreate?.userErrors ?? [];
      if (errors.length > 0) {
        console.error(`[afterAuth] webhook errors for ${session.shop}:`, errors);
      } else {
        console.log(`[afterAuth] webhook registered for ${session.shop}`);
      }
    },
  },

  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;