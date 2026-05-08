import React from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useRouteError, NavLink, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async (_: LoaderFunctionArgs) => {
  return null;
};

export default function App() {
  const [searchParams] = useSearchParams();

  // These params must survive every navigation so authenticate.admin() can find the shop.
  const shop = searchParams.get("shop") || "";
  const host = searchParams.get("host") || "";
  const qs = [shop && `shop=${shop}`, host && `host=${host}`].filter(Boolean).join("&");
  const p = (path: string) => (qs ? `${path}?${qs}` : path);

  return (
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
        <NavLink to={p("/app/charts")} style={navLinkStyle}>Size Charts</NavLink>
        <NavLink to={p("/app/mappings")} style={navLinkStyle}>Product Mappings</NavLink>
        <NavLink to={p("/app/fallbacks")} style={navLinkStyle}>Fallback Rules</NavLink>
        <NavLink to={p("/app/settings")} style={navLinkStyle}>Settings</NavLink>
      </nav>
      <Outlet />
    </div>
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
