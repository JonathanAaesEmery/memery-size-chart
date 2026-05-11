import React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useRouteError, useSearchParams, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const shop = searchParams.get("shop") || "";
  const host = searchParams.get("host") || "";
  const qs = [shop && `shop=${shop}`, host && `host=${host}`].filter(Boolean).join("&");
  const p = (path: string) => (qs ? `${path}?${qs}` : path);

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/* ui-nav-menu is handled natively by App Bridge for proper client-side navigation */}
      <ui-nav-menu>
        <a href={p("/app/charts")} rel="home">Size Charts</a>
        <a href={p("/app/mappings")}>Product Mappings</a>
        <a href={p("/app/fallbacks")}>Fallback Rules</a>
        <a href={p("/app/settings")}>Settings</a>
      </ui-nav-menu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
