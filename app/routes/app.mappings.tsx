import React, { useState, useMemo } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const productsResponse = await admin.graphql(
    `#graphql
    query GetProducts {
      products(first: 250) {
        edges {
          node { id title handle }
        }
      }
    }`
  );

  const productsData = (await productsResponse.json()) as {
    data?: { products?: { edges?: Array<{ node: ShopifyProduct }> } };
  };

  const products: ShopifyProduct[] =
    productsData.data?.products?.edges?.map((e) => e.node) || [];

  const [mappings, charts] = await Promise.all([
    prisma.productMapping.findMany({
      where: { shop: session.shop },
      include: { chart: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sizeChart.findMany({
      where: { shop: session.shop, isActive: true },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);

  return { mappings, charts, products, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const chartId = formData.get("chartId") as string;
    const productHandle = (formData.get("productHandle") as string)?.trim() || null;
    const productId = (formData.get("productId") as string)?.trim() || null;
    if (chartId && (productHandle || productId)) {
      const normalizedProductId = productId
        ? productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`
        : null;
      await prisma.productMapping.create({
        data: { shop: session.shop, chartId, productHandle, productId: normalizedProductId },
      });
    }
  }

  if (intent === "delete") {
    await prisma.productMapping.deleteMany({ where: { id: formData.get("id") as string, shop: session.shop } });
  }

  return null;
};

// ─── Reusable searchable dropdown (position:fixed to escape overflow clipping) ──

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
}: {
  options: { label: string; sublabel?: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const t = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(t) || o.sublabel?.toLowerCase().includes(t));
  }, [search, options]);

  const openDropdown = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(true);
  };

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (opt: typeof options[0]) => {
    onChange(opt.value);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={triggerRef}>
      <div
        onClick={() => open ? setOpen(false) : openDropdown()}
        style={{ border: `1px solid ${open ? "#1a1a1a" : "#c9cccf"}`, borderRadius: 6, padding: "10px 12px", cursor: "pointer", background: "#fff", fontSize: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span>
          {selected ? (
            <span>
              <span style={{ fontWeight: 500, color: "#1a1a1a" }}>{selected.label}</span>
              {selected.sublabel && <span style={{ fontSize: 12, color: "#6d7175", marginLeft: 8 }}>{selected.sublabel}</span>}
            </span>
          ) : (
            <span style={{ color: "#9c9da0" }}>{placeholder}</span>
          )}
        </span>
        <span style={{ color: "#6d7175", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && rect && (
        <div style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, background: "#fff", border: "1px solid #c9cccf", borderRadius: 6, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }}>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Search..."
            style={{ width: "100%", padding: "10px 12px", border: "none", borderBottom: "1px solid #e1e3e5", borderRadius: "6px 6px 0 0", fontSize: 13, boxSizing: "border-box", outline: "none" } as React.CSSProperties}
          />
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px", color: "#9c9da0", fontSize: 13, textAlign: "center" }}>No results</div>
            ) : (
              filtered.map((opt) => (
                <div
                  key={opt.value}
                  onMouseDown={(e) => { e.preventDefault(); select(opt); }}
                  style={{ padding: "10px 12px", borderBottom: "1px solid #f3f3f3", cursor: "pointer", background: value === opt.value ? "#f6f6f7" : "#fff", fontSize: 13 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#f6f6f7"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = value === opt.value ? "#f6f6f7" : "#fff"; }}
                >
                  <div style={{ fontWeight: 500, color: "#1a1a1a" }}>{opt.label}</div>
                  {opt.sublabel && <div style={{ fontSize: 11, color: "#9c9da0", marginTop: 2 }}>{opt.sublabel}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MappingsPage() {
  const { mappings, charts, products, shop } = useLoaderData<typeof loader>();
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const appUrl = "https://memery-size-chart-production.up.railway.app";

  function copyShareLink(handle: string | null, productId: string | null) {
    const param = handle ? `product_handle=${handle}` : `product_id=${productId}`;
    const url = `${appUrl}/share/size-chart?shop=${shop}&${param}`;
    navigator.clipboard.writeText(url).then(() => {
      const key = handle || productId || "";
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }
  const fetcher = useFetcher();

  const [selectedChartId, setSelectedChartId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedProductHandle, setSelectedProductHandle] = useState("");

  const productOptions = products.map((p) => ({ label: p.title, sublabel: p.handle, value: p.id }));
  const chartOptions = charts.map((c) => ({ label: c.title, value: c.id }));

  const handleAdd = () => {
    if (!selectedChartId || !selectedProductId) return;
    fetcher.submit(
      { intent: "add", chartId: selectedChartId, productHandle: selectedProductHandle, productId: selectedProductId },
      { method: "post" }
    );
    setSelectedChartId("");
    setSelectedProductId("");
    setSelectedProductHandle("");
  };

  // Build a map of productId → title for display in the list
  const productTitleMap = Object.fromEntries(products.map((p) => [p.id, p.title]));
  const productHandleMap = Object.fromEntries(products.map((p) => [p.handle, p.title]));

  return (
    <s-page heading="Product Mappings">
      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Link a size chart to a specific product. When a customer views that product, the size chart button will appear.
        </s-paragraph>
        <s-paragraph>
          Product-specific mappings always take priority over fallback rules.
        </s-paragraph>
      </s-section>

      <s-section heading="Add mapping">
        {charts.length === 0 ? (
          <s-paragraph>Create a size chart first before adding mappings.</s-paragraph>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={lbl}>Size chart</label>
              <SearchableSelect
                options={chartOptions}
                value={selectedChartId}
                onChange={setSelectedChartId}
                placeholder="Select a chart..."
              />
            </div>
            <div>
              <label style={lbl}>Product</label>
              <SearchableSelect
                options={productOptions}
                value={selectedProductId}
                onChange={(id) => {
                  setSelectedProductId(id);
                  const p = products.find((p) => p.id === id);
                  setSelectedProductHandle(p?.handle || "");
                }}
                placeholder="Select a product..."
              />
            </div>
            <div>
              <button
                onClick={handleAdd}
                disabled={!selectedChartId || !selectedProductId}
                style={{ ...btnPrimary, opacity: !selectedChartId || !selectedProductId ? 0.5 : 1, cursor: !selectedChartId || !selectedProductId ? "not-allowed" : "pointer" }}
              >
                Add mapping
              </button>
            </div>
          </div>
        )}
      </s-section>

      <s-section heading={`Mappings (${mappings.length})`}>
        {mappings.length === 0 ? (
          <s-paragraph>No mappings yet.</s-paragraph>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden" }}>
            {mappings.map((mapping, i) => {
              const productTitle =
                (mapping.productId && productTitleMap[mapping.productId]) ||
                (mapping.productHandle && productHandleMap[mapping.productHandle]) ||
                null;
              return (
                <div key={mapping.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: i < mappings.length - 1 ? "1px solid #e1e3e5" : "none", background: "#fff" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#1a1a1a" }}>{mapping.chart.title}</div>
                    <div style={{ fontSize: 13, color: "#6d7175", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      <span>→</span>
                      <span>{productTitle || <code style={{ background: "#f6f6f7", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{mapping.productHandle || mapping.productId || "unknown"}</code>}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => copyShareLink(mapping.productHandle, mapping.productId)}
                      style={btnSecondary}
                      title="Copy shareable link for customer support"
                    >
                      {copiedId === (mapping.productHandle || mapping.productId) ? "✓ Copied!" : "🔗 Copy link"}
                    </button>
                    <button onClick={() => { if (confirm("Remove this mapping?")) fetcher.submit({ intent: "delete", id: mapping.id }, { method: "post" }); }} style={btnDanger}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const lbl: React.CSSProperties = { display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14, color: "#1a1a1a" };
const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" };
const btnDanger: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" };

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
