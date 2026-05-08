import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, NavLink } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
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
          <NavLink to="/app/charts" style={navLinkStyle}>Size Charts</NavLink>
          <NavLink to="/app/mappings" style={navLinkStyle}>Product Mappings</NavLink>
          <NavLink to="/app/fallbacks" style={navLinkStyle}>Fallback Rules</NavLink>
          <NavLink to="/app/settings" style={navLinkStyle}>Settings</NavLink>
        </nav>
        <Outlet />
      </div>
    </AppProvider>
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

import React from "react";

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
