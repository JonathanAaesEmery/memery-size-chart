import React from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, NavLink, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const host = url.searchParams.get("host") || "";
  const shop = url.searchParams.get("shop") || "";
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return { apiKey, host, shop };
};

export default function App() {
  const { apiKey, host, shop } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  // Preserve Shopify params across all internal navigations
  const currentHost = searchParams.get("host") || host;
  const currentShop = searchParams.get("shop") || shop;
  const shopifyParams = new URLSearchParams();
  if (currentHost) shopifyParams.set("host", currentHost);
  if (currentShop) shopifyParams.set("shop", currentShop);
  const qs = shopifyParams.toString() ? `?${shopifyParams.toString()}` : "";

  function navTo(path: string) {
    return `${path}${qs}`;
  }

  return (
    <>
      {/* App Bridge — loads with host param so it can initialize properly */}
      {apiKey && currentHost && (
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key={apiKey}
          data-host={currentHost}
        />
      )}
      <div style={{ minHeight: "100vh", background: "#f6f6f7" }}>
        <nav style={{
          background: "#fff",
          borderBottom: "1px solid #e1e3e5",
          padding: "0 20px",
          display: "flex",
          gap: 4,
          alignItems: "center",
          height: 52,
        }}>
          <NavLink to={navTo("/app/charts")} style={navLinkStyle}>Size Charts</NavLink>
          <NavLink to={navTo("/app/mappings")} style={navLinkStyle}>Product Mappings</NavLink>
          <NavLink to={navTo("/app/fallbacks")} style={navLinkStyle}>Fallback Rules</NavLink>
          <NavLink to={navTo("/app/settings")} style={navLinkStyle}>Settings</NavLink>
        </nav>
        <Outlet />
      </div>
    </>
  );
}

function navLinkStyle({ isActive }: { isActive: boolean }) {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 14,
    textDecoration: "none",
    color: isActive ? "#1a1a1a" : "#6d7175",
    fontWeight: isActive ? 600 : 400,
    background: isActive ? "#f1f1f1" : "transparent",
  } as React.CSSProperties;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
