import React from "react";
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
      <div style={{ minHeight: "100vh", background: "#f6f6f7", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <nav style={{
          background: "#fff",
          borderBottom: "1px solid #e1e3e5",
          padding: "0 20px",
          display: "flex",
          gap: 4,
          alignItems: "center",
          height: 52,
        }}>
          <a href={p("/app/charts")} style={navStyle}>Size Charts</a>
          <a href={p("/app/mappings")} style={navStyle}>Product Mappings</a>
          <a href={p("/app/fallbacks")} style={navStyle}>Fallback Rules</a>
          <a href={p("/app/settings")} style={navStyle}>Settings</a>
        </nav>
        <Outlet />
      </div>
    </AppProvider>
  );
}

const navStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 14,
  textDecoration: "none",
  color: "#6d7175",
  fontWeight: 400,
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
