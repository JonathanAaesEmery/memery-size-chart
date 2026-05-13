import React, { useRef, useState, useMemo } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Fetch collections from Shopify Admin API
  const collectionsResponse = await admin.graphql(
    `#graphql
    query GetCollections {
      collections(first: 250) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
    `
  );

  const collectionsData = (await collectionsResponse.json()) as {
    data?: {
      collections?: {
        edges?: Array<{
          node: ShopifyCollection;
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const collections: ShopifyCollection[] =
    collectionsData.data?.collections?.edges?.map((edge) => edge.node) || [];

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

  return { fallbacks, charts, collections };
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
  collection: "Collection",
};

function CollectionSelector({
  collections,
  value,
  onChange,
}: {
  collections: ShopifyCollection[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<ShopifyCollection | null>(
    value && collections.find((c) => c.handle === value) ? collections.find((c) => c.handle === value)! : null
  );

  const filteredCollections = useMemo(() => {
    if (!searchTerm.trim()) return collections;
    const term = searchTerm.toLowerCase();
    return collections.filter(
      (c) => c.title.toLowerCase().includes(term) || c.handle.toLowerCase().includes(term)
    );
  }, [searchTerm, collections]);

  const handleSelect = (collection: ShopifyCollection) => {
    setSelectedCollection(collection);
    onChange(collection.handle);
    setIsOpen(false);
    setSearchTerm("");
  };

  return (
    <div style={{ position: "relative", flex: 2 }}>
      <div
        style={{
          border: "1px solid #c9cccf",
          borderRadius: "6px",
          padding: "10px 12px",
          cursor: "pointer",
          background: "#fff",
          fontSize: "14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          transition: "border-color 0.2s",
          borderColor: isOpen ? "#1a73e8" : "#c9cccf",
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>
          {selectedCollection ? (
            <div>
              <div style={{ fontWeight: 500, color: "#1a1a1a" }}>{selectedCollection.title}</div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
                {selectedCollection.handle}
              </div>
            </div>
          ) : (
            <span style={{ color: "#9c9da0" }}>Search or select collection...</span>
          )}
        </span>
        <span style={{ color: "#6d7175", marginLeft: "8px", flexShrink: 0 }}>
          {isOpen ? "▲" : "▼"}
        </span>
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #c9cccf",
            borderRadius: "6px",
            marginTop: "4px",
            zIndex: 10,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
          }}
        >
          <input
            type="text"
            placeholder="Search by title or handle..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "none",
              borderBottom: "1px solid #e1e3e5",
              borderRadius: "6px 6px 0 0",
              fontSize: "14px",
              boxSizing: "border-box",
              outline: "none",
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
          <div
            style={{
              maxHeight: "240px",
              overflowY: "auto",
            }}
          >
            {filteredCollections.length === 0 ? (
              <div style={{ padding: "12px 12px", color: "#6d7175", fontSize: "13px", textAlign: "center" }}>
                No collections found
              </div>
            ) : (
              filteredCollections.map((collection) => (
                <div
                  key={collection.id}
                  onClick={() => handleSelect(collection)}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid #f3f3f3",
                    cursor: "pointer",
                    fontSize: "13px",
                    background:
                      selectedCollection?.id === collection.id ? "#f6f6f7" : "#fff",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background =
                      "#f6f6f7";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background =
                      selectedCollection?.id === collection.id ? "#f6f6f7" : "#fff";
                  }}
                >
                  <div style={{ fontWeight: 500, color: "#1a1a1a" }}>{collection.title}</div>
                  <div style={{ fontSize: "11px", color: "#9c9da0", marginTop: "2px" }}>
                    {collection.handle}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FallbacksPage() {
  const { fallbacks, charts, collections } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const chartIdRef = useRef<HTMLSelectElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const priorityRef = useRef<HTMLInputElement>(null);
  const selectedCollectionRef = useRef<string | null>(null);

  const currentType = typeRef.current?.value || "tag";

  const handleCollectionSelect = (value: string) => {
    selectedCollectionRef.current = value;
  };

  const handleAdd = () => {
    const chartId = chartIdRef.current?.value || "";
    const mappingType = typeRef.current?.value || "";

    // For collections, use the dropdown value if available
    const mappingValue =
      mappingType === "collection"
        ? selectedCollectionRef.current?.trim() || ""
        : valueRef.current?.value?.trim() || "";

    const priority = priorityRef.current?.value || "0";
    if (!chartId || !mappingType || !mappingValue) return;
    fetcher.submit({ intent: "add", chartId, mappingType, mappingValue, priority }, { method: "post" });
    if (valueRef.current) valueRef.current.value = "";
    selectedCollectionRef.current = null;
    if (priorityRef.current) priorityRef.current.value = "0";
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
          Fallback rules show a size chart based on product attributes. Use this when
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
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: 500, fontSize: "14px", color: "#1a1a1a" }}>
                Size chart
              </label>
              <select ref={chartIdRef} style={selectStyle}>
                <option value="">Select a chart...</option>
                {charts.map((chart) => (
                  <option key={chart.id} value={chart.id}>
                    {chart.title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: 500, fontSize: "14px", color: "#1a1a1a" }}>
                  Match by
                </label>
                <select ref={typeRef} style={selectStyle}>
                  <option value="tag">Product tag</option>
                  <option value="vendor">Vendor</option>
                  <option value="product_type">Product type</option>
                  <option value="collection">Collection</option>
                </select>
              </div>

              {currentType === "collection" ? (
                <CollectionSelector
                  collections={collections}
                  value={selectedCollectionRef.current || ""}
                  onChange={handleCollectionSelect}
                />
              ) : (
                <div style={{ flex: 2 }}>
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: 500, fontSize: "14px", color: "#1a1a1a" }}>
                    Value
                  </label>
                  <input
                    ref={valueRef}
                    style={inputStyle}
                    placeholder="e.g. womens, Memery, T-Shirts"
                  />
                </div>
              )}

              <div style={{ width: "90px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: 500, fontSize: "14px", color: "#1a1a1a" }}>
                  Priority
                </label>
                <input
                  ref={priorityRef}
                  type="number"
                  defaultValue="0"
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <button onClick={handleAdd} style={btnPrimaryStyle}>
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
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            {fallbacks.map((fb, index) => (
              <div
                key={fb.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  borderBottom: index < fallbacks.length - 1 ? "1px solid #e1e3e5" : "none",
                  background: "#fff",
                }}
              >
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 500, color: "#1a1a1a" }}>
                    {fb.chart.title}
                  </div>
                  <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
                    <span style={{ marginRight: "6px" }}>
                      {TYPE_LABELS[fb.mappingType] || fb.mappingType}:
                    </span>
                    <code style={{ background: "#f6f6f7", padding: "2px 6px", borderRadius: "4px" }}>
                      {fb.mappingValue}
                    </code>
                    <span style={{ marginLeft: "12px", color: "#9c9da0", fontSize: "12px" }}>
                      priority {fb.priority}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(fb.id)}
                  style={btnDangerStyle}
                >
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

const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "14px", boxSizing: "border-box" as const, outline: "none" } as React.CSSProperties;
const selectStyle = { width: "100%", padding: "10px 12px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "14px", background: "#fff", boxSizing: "border-box" as const, outline: "none" } as React.CSSProperties;
const btnPrimaryStyle = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "background 0.2s" } as React.CSSProperties;
const btnDangerStyle = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer", transition: "all 0.2s" } as React.CSSProperties;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
