import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  // authenticate.admin() does two things when called here:
  // 1. If the session is valid → returns normally, app renders
  // 2. If the session is missing/expired → throws a redirect response
  //    that AppBridge intercepts to break out of the iframe and
  //    do OAuth at the top-level frame. This is the correct fix for
  //    "accounts.shopify.com refused to connect".
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    // `embedded` tells AppProvider to initialise Shopify AppBridge.
    // AppBridge is what intercepts auth redirects so they break out of
    // the iframe instead of trying to load OAuth inside it.
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/connections">Connections</s-link>
        <s-link href="/app/logs">Sync Logs</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// boundary.error() catches Shopify's thrown redirect responses (e.g. auth
// redirects) and ensures their headers (including the AppBridge redirect
// header) are included in the response sent to the browser.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};