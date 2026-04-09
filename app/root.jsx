import { 
  Links, 
  Meta, 
  Outlet, 
  Scripts, 
  ScrollRestoration,
  useRouteError // <-- 1. Import useRouteError
} from "react-router";

// 2. Import Shopify's boundary utility. 
// (Note: If you are using the older Remix package, this import will 
// be "@shopify/shopify-app-remix/server" instead)
import { boundary } from "@shopify/shopify-app-react-router/server";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// 3. Add Shopify's ErrorBoundary. 
// When your loader throws an auth redirect, this catches it and transforms it 
// so App Bridge knows how to handle the top-level navigation.
export function ErrorBoundary() {
  const error = useRouteError();
  return boundary.error(error);
}

// 4. Add the headers export.
// This physically injects the required X-Shopify App Bridge headers into the response.
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};