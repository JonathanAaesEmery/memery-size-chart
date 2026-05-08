import React, { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [fallbacks, charts] = await Promise.all([
    prisma.fallbackMapping.findMany({
      where: { shop: session.shop },
      include: { chart: { select: { title: true } } },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    }),
    prisma.sizeChart.findMany({
      where: { shop: session.shop, isActive: true },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);

  return { fallbacks, charts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const chartId = formData.get("chartId") as string;
    const mappingType = formData.get("mappingType") as string;
    const mappingValue = (formData.get("mappingValue") as string)?.trim();
    const priority = parseInt(formData.get("priority") as string) || 0;

    if (chartId && mappingType && mappingValue) {
      await prisma.fallbackMapping.create({
        data: { shop: session.shop, chartId, mappingType, mappingValue, priority },
      });
    }
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.fallbackMapping.deleteMany({ where: { id, shop: session.shop } });
  }

  return null;
};

const TYPE_LABELS: Record<string, string> = {
  tag: "Product tag",
  vendor: "Vendor",
  product_type: "Product type",
};

export default function FallbacksPage() {
  const { fallbacks, charts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const chartIdRef = useRef<HTMLSelectElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const priorityRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const chartId = chartIdRef.current?.value || "";
    const mappingType = typeRef.current?.value || "";
    const mappingValue = valueRef.current?.value?.trim() || "";
    const priority = priorityRef.current?.value || "0";
    if (!chartId || !mappingType || !mappingValue) return;
    fetcher.submit({ intent: "add", chartId, mappingType, mappingValue, priority }, { method: "post" });
    if (valueRef.current) valueRef.current.value = "";
  };

  const handleDelete = (id: string) => {
    if (confirm("Remove this fallback rule?")) {
      fetcher.submit({ intent: "delete", id }, { method: "post" });
    }
  };

  return (
    <s-page heading="Fallback Rules">
      <s-section slot="aside" heading="How fallbacks work">
        <s-paragraph>
          Fallback rules show a size chart based on product attributes — useful when
          you have many products that should share the same chart.
        </s-paragraph>
        <s-paragraph>
          Rules are checked in priority order (highest first). Product-specific
          mappings always take precedence over fallback rules.
        </s-paragraph>
      </s-section>

      <s-section heading="Add fallback rule">
        {charts.length === 0 ? (
          <s-paragraph>Create a size chart first.</s-paragraph>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>Size chart</label>
              <select ref={chartIdRef} style={selectStyle}>
                <option value="">Select a chart...</option>
                {charts.map((chart) => (
                  <option key={chart.id} value={chart.id}>{chart.title}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>Match by</label>
                <select ref={typeRef} style={selectStyle}>
                  <option value="tag">Product tag</option>
                  <option value="vendor">Vendor</option>
                  <option value="product_type">Product type</option>
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>Value</label>
                <input ref={valueRef} style={inputStyle} placeholder="e.g. womens, Memery, T-Shirts" />
              </div>
              <div style={{ width: "80px" }}>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>Priority</label>
                <input ref={priorityRef} type="number" defaultValue="0" style={inputStyle} />
              </div>
            </div>
            <div>
              <button onClick={handleAdd} style={btnPrimaryStyle}>Add rule</button>
            </div>
          </div>
        )}
      </s-section>

      <s-section heading={`Fallback rules (${fallbacks.length})`}>
        {fallbacks.length === 0 ? (
          <s-paragraph>No fallback rules yet.</s-paragraph>
        ) : (
          fallbacks.map((fb) => (
            <div
              key={fb.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid #e1e3e5",
              }}
            >
              <div>
                <strong>{fb.chart.title}</strong>
                <span style={{ margin: "0 8px", color: "#6d7175" }}>→</span>
                <span style={{ fontSize: "13px" }}>
                  {TYPE_LABELS[fb.mappingType] || fb.mappingType}:{" "}
                  <code style={{ background: "#f6f6f7", padding: "2px 6px", borderRadius: "3px" }}>
                    {fb.mappingValue}
                  </code>
                </span>
                <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6d7175" }}>
                  priority: {fb.priority}
                </span>
              </div>
              <button onClick={() => handleDelete(fb.id)} style={btnDangerStyle}>Remove</button>
            </div>
          ))
        )}
      </s-section>
    </s-page>
  );
}

const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "4px", fontSize: "14px" } as React.CSSProperties;
const selectStyle = { width: "100%", padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "4px", fontSize: "14px" } as React.CSSProperties;
const btnPrimaryStyle = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" } as React.CSSProperties;
const btnDangerStyle = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" } as React.CSSProperties;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
