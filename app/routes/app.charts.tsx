import React from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const charts = await prisma.sizeChart.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      isActive: true,
      createdAt: true,
      _count: { select: { productMappings: true } },
    },
  });
  return { charts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.sizeChart.deleteMany({ where: { id, shop: session.shop } });
  }

  if (intent === "toggle") {
    const id = formData.get("id") as string;
    const current = await prisma.sizeChart.findFirst({ where: { id, shop: session.shop } });
    if (current) {
      await prisma.sizeChart.update({ where: { id }, data: { isActive: !current.isActive } });
    }
  }

  return null;
};

export default function ChartsPage() {
  const { charts } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const fetcher = useFetcher();

  const shopifyNavigate = (url: string) => {
    if (typeof window !== "undefined" && (window as any).shopify?.navigate) {
      (window as any).shopify.navigate(url);
    } else {
      window.location.href = url;
    }
  };

  const handleToggle = (id: string) => {
    fetcher.submit({ intent: "toggle", id }, { method: "post" });
  };

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Delete "${title}"?`)) {
      fetcher.submit({ intent: "delete", id }, { method: "post" });
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px", fontFamily: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Size Charts</h1>
        <button onClick={() => shopifyNavigate(`/app/charts/new${qs}`)} style={btnPrimaryStyle}>+ Create chart</button>
      </div>

      {charts.length === 0 ? (
        <div style={{ border: "1px solid #e1e3e5", borderRadius: 12, padding: "40px 24px", textAlign: "center" }}>
          <p style={{ color: "#6d7175", marginBottom: 16 }}>No size charts yet.</p>
          <button onClick={() => shopifyNavigate(`/app/charts/new${qs}`)} style={btnPrimaryStyle}>Create your first chart</button>
        </div>
      ) : (
        <div style={{ border: "1px solid #e1e3e5", borderRadius: 12, overflow: "hidden" }}>
          {charts.map((chart, i) => (
            <div
              key={chart.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 20px",
                borderBottom: i < charts.length - 1 ? "1px solid #e1e3e5" : "none",
                background: "#fff",
              }}
            >
              <div>
                <strong style={{ fontSize: 15 }}>{chart.title}</strong>
                <span style={{
                  marginLeft: 10,
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: 12,
                  background: chart.isActive ? "#d4edda" : "#f8d7da",
                  color: chart.isActive ? "#155724" : "#721c24",
                }}>
                  {chart.isActive ? "Active" : "Inactive"}
                </span>
                <span style={{ marginLeft: 10, color: "#6d7175", fontSize: 13 }}>
                  {chart._count.productMappings} product{chart._count.productMappings !== 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => shopifyNavigate(`/app/charts/${chart.id}${qs}`)} style={btnSecondaryStyle}>Edit</button>
                <button onClick={() => handleToggle(chart.id)} style={btnSecondaryStyle}>
                  {chart.isActive ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => handleDelete(chart.id, chart.title)} style={btnDangerStyle}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btnPrimaryStyle: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnSecondaryStyle: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const btnDangerStyle: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
