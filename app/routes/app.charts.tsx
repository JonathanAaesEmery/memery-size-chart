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
  const mutFetcher = useFetcher();

  // Match exactly how app.tsx builds ui-nav-menu links: only shop + host
  const shop = searchParams.get("shop") || "";
  const host = searchParams.get("host") || "";
  const qs = [shop && `shop=${shop}`, host && `host=${host}`].filter(Boolean).join("&");
  const href = (path: string) => qs ? `${path}?${qs}` : path;

  const handleToggle = (id: string) => {
    mutFetcher.submit({ intent: "toggle", id }, { method: "post" });
  };

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Delete "${title}"?`)) {
      mutFetcher.submit({ intent: "delete", id }, { method: "post" });
    }
  };

  return (
    <s-page heading="Size Charts">
      <div slot="primary-action">
        {/* Plain <a> tag — App Bridge intercepts this click exactly like ui-nav-menu links */}
        <a href={href("/app/charts/new")} style={linkPrimaryStyle}>+ Create chart</a>
      </div>

      <s-section>
        {charts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ color: "#6d7175", marginBottom: 16 }}>No size charts yet.</p>
            <a href={href("/app/charts/new")} style={linkPrimaryStyle}>Create your first chart</a>
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
                  {/* Plain <a> for navigation — same mechanism as ui-nav-menu */}
                  <a href={href(`/app/charts/${chart.id}`)} style={linkSecondaryStyle}>Edit</a>
                  <button onClick={() => handleToggle(chart.id)} style={btnSecondaryStyle}>
                    {chart.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(chart.id, chart.title)} style={btnDangerStyle}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const linkPrimaryStyle: React.CSSProperties = { display: "inline-block", background: "#1a1a1a", color: "#fff", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer", textDecoration: "none" };
const linkSecondaryStyle: React.CSSProperties = { display: "inline-block", background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer", textDecoration: "none" };
const btnSecondaryStyle: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const btnDangerStyle: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
