import React, { useState, useMemo } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Fetch products (for vendor, type, tags) and collections in parallel
  const [productsRes, collectionsRes] = await Promise.all([
    admin.graphql(`#graphql
      query GetProducts {
        products(first: 250) {
          edges {
            node { vendor productType tags }
          }
        }
      }`),
    admin.graphql(`#graphql
      query GetCollections {
        collections(first: 250) {
          edges {
            node { id title handle }
          }
        }
      }`),
  ]);

  const [productsData, collectionsData] = await Promise.all([
    productsRes.json() as Promise<any>,
    collectionsRes.json() as Promise<any>,
  ]);

  const productNodes: Array<{ vendor: string; productType: string; tags: string[] }> =
    productsData.data?.products?.edges?.map((e: any) => e.node) || [];

  // Extract unique, sorted values
  const vendors = [...new Set(productNodes.map((p) => p.vendor).filter(Boolean))].sort();
  const productTypes = [...new Set(productNodes.map((p) => p.productType).filter(Boolean))].sort();
  const tags = [...new Set(productNodes.flatMap((p) => p.tags || []).filter(Boolean))].sort();
  const collections: Array<{ id: string; title: string; handle: string }> =
    collectionsData.data?.collections?.edges?.map((e: any) => e.node) || [];

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

  return { fallbacks, charts, vendors, productTypes, tags, collections };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const chartId = formData.get("chartId") as string;
    const mappingType = formData.get("mappingType") as string;
    const mappingValue = (formData.get("mappingValue") as string)?.trim();
    if (chartId && mappingType && mappingValue) {
      await prisma.fallbackMapping.create({
        data: { shop: session.shop, chartId, mappingType, mappingValue, priority: 0 },
      });
    }
  }

  if (intent === "delete") {
    await prisma.fallbackMapping.deleteMany({ where: { id: formData.get("id") as string, shop: session.shop } });
  }

  return null;
};

const TYPE_LABELS: Record<string, string> = {
  tag: "Product tag",
  vendor: "Vendor",
  product_type: "Product type",
  collection: "Collection",
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

export default function FallbacksPage() {
  const { fallbacks, charts, vendors, productTypes, tags, collections } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [selectedChartId, setSelectedChartId] = useState("");
  const [selectedType, setSelectedType] = useState("tag");
  const [selectedValue, setSelectedValue] = useState("");

  const chartOptions = charts.map((c) => ({ label: c.title, value: c.id }));

  // Options per type
  const valueOptions = useMemo(() => {
    if (selectedType === "vendor") return vendors.map((v) => ({ label: v, value: v }));
    if (selectedType === "product_type") return productTypes.map((t) => ({ label: t, value: t }));
    if (selectedType === "tag") return tags.map((t) => ({ label: t, value: t }));
    if (selectedType === "collection") return collections.map((c) => ({ label: c.title, sublabel: c.handle, value: c.handle }));
    return [];
  }, [selectedType, vendors, productTypes, tags, collections]);

  const valuePlaceholder: Record<string, string> = {
    tag: "Select a tag...",
    vendor: "Select a vendor...",
    product_type: "Select a product type...",
    collection: "Select a collection...",
  };

  const handleAdd = () => {
    if (!selectedChartId || !selectedType || !selectedValue) return;
    fetcher.submit(
      { intent: "add", chartId: selectedChartId, mappingType: selectedType, mappingValue: selectedValue },
      { method: "post" }
    );
    setSelectedChartId("");
    setSelectedValue("");
  };

  const canAdd = !!selectedChartId && !!selectedValue;

  return (
    <s-page heading="Fallback Rules">
      <s-section slot="aside" heading="How fallbacks work">
        <s-paragraph>
          Show a size chart based on product attributes — useful when many products share the same chart.
        </s-paragraph>
        <s-paragraph>
          Product-specific mappings always take priority over fallback rules.
        </s-paragraph>
      </s-section>

      <s-section heading="Add fallback rule">
        {charts.length === 0 ? (
          <s-paragraph>Create a size chart first.</s-paragraph>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Chart */}
            <div>
              <label style={lbl}>Size chart</label>
              <SearchableSelect
                options={chartOptions}
                value={selectedChartId}
                onChange={setSelectedChartId}
                placeholder="Select a chart..."
              />
            </div>

            {/* Match type */}
            <div>
              <label style={lbl}>Match by</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(["tag", "vendor", "product_type", "collection"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => { setSelectedType(type); setSelectedValue(""); }}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 6,
                      border: `1.5px solid ${selectedType === type ? "#1a1a1a" : "#c9cccf"}`,
                      background: selectedType === type ? "#1a1a1a" : "#fff",
                      color: selectedType === type ? "#fff" : "#1a1a1a",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            {/* Value dropdown */}
            <div>
              <label style={lbl}>{TYPE_LABELS[selectedType]}</label>
              {valueOptions.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9c9da0", margin: 0 }}>
                  No {TYPE_LABELS[selectedType].toLowerCase()}s found in your store.
                </p>
              ) : (
                <SearchableSelect
                  options={valueOptions}
                  value={selectedValue}
                  onChange={setSelectedValue}
                  placeholder={valuePlaceholder[selectedType]}
                />
              )}
            </div>

            <div>
              <button
                onClick={handleAdd}
                disabled={!canAdd}
                style={{ ...btnPrimary, opacity: canAdd ? 1 : 0.5, cursor: canAdd ? "pointer" : "not-allowed" }}
              >
                Add rule
              </button>
            </div>
          </div>
        )}
      </s-section>

      <s-section heading={`Fallback rules (${fallbacks.length})`}>
        {fallbacks.length === 0 ? (
          <s-paragraph>No fallback rules yet.</s-paragraph>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden" }}>
            {fallbacks.map((fb, i) => (
              <div key={fb.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: i < fallbacks.length - 1 ? "1px solid #e1e3e5" : "none", background: "#fff" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "#1a1a1a" }}>{fb.chart.title}</div>
                  <div style={{ fontSize: 13, color: "#6d7175", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ background: "#f0f0f0", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500, color: "#555" }}>
                      {TYPE_LABELS[fb.mappingType] || fb.mappingType}
                    </span>
                    <span>→</span>
                    <span style={{ fontWeight: 500 }}>{fb.mappingValue}</span>
                  </div>
                </div>
                <button onClick={() => { if (confirm("Remove this fallback rule?")) fetcher.submit({ intent: "delete", id: fb.id }, { method: "post" }); }} style={btnDanger}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const lbl: React.CSSProperties = { display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14, color: "#1a1a1a" };
const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnDanger: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" };

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
