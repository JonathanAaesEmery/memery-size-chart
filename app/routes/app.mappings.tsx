import React, { useRef, useState, useMemo } from "react";
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

  // Fetch products from Shopify Admin API
  const productsResponse = await admin.graphql(
    `#graphql
    query GetProducts {
      products(first: 250) {
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

  const productsData = (await productsResponse.json()) as {
    data?: {
      products?: {
        edges?: Array<{
          node: ShopifyProduct;
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const products: ShopifyProduct[] =
    productsData.data?.products?.edges?.map((edge) => edge.node) || [];

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

  return { mappings, charts, products };
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
    const id = formData.get("id") as string;
    await prisma.productMapping.deleteMany({ where: { id, shop: session.shop } });
  }

  return null;
};

function ProductSelector({
  products,
  value,
  onChange,
}: {
  products: ShopifyProduct[];
  value: string;
  onChange: (productId: string, handle: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(
    value && products.find((p) => p.id === value) ? products.find((p) => p.id === value)! : null
  );

  const filteredProducts = useMemo(() => {
    if (!searchTerm.trim()) return products;
    const term = searchTerm.toLowerCase();
    return products.filter(
      (p) => p.title.toLowerCase().includes(term) || p.handle.toLowerCase().includes(term)
    );
  }, [searchTerm, products]);

  const handleSelect = (product: ShopifyProduct) => {
    setSelectedProduct(product);
    onChange(product.id, product.handle);
    setIsOpen(false);
    setSearchTerm("");
  };

  return (
    <div style={{ position: "relative" }}>
      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "block", marginBottom: "8px", fontWeight: 500, fontSize: "14px", color: "#1a1a1a" }}>
          Product
        </label>
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
            {selectedProduct ? (
              <div>
                <div style={{ fontWeight: 500, color: "#1a1a1a" }}>{selectedProduct.title}</div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
                  {selectedProduct.handle}
                </div>
              </div>
            ) : (
              <span style={{ color: "#9c9da0" }}>Search or select product...</span>
            )}
          </span>
          <span style={{ color: "#6d7175", marginLeft: "8px", flexShrink: 0 }}>
            {isOpen ? "▲" : "▼"}
          </span>
        </div>
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
            {filteredProducts.length === 0 ? (
              <div style={{ padding: "12px 12px", color: "#6d7175", fontSize: "13px", textAlign: "center" }}>
                No products found
              </div>
            ) : (
              filteredProducts.map((product) => (
                <div
                  key={product.id}
                  onClick={() => handleSelect(product)}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid #f3f3f3",
                    cursor: "pointer",
                    fontSize: "13px",
                    background:
                      selectedProduct?.id === product.id ? "#f6f6f7" : "#fff",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background =
                      "#f6f6f7";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background =
                      selectedProduct?.id === product.id ? "#f6f6f7" : "#fff";
                  }}
                >
                  <div style={{ fontWeight: 500, color: "#1a1a1a" }}>{product.title}</div>
                  <div style={{ fontSize: "11px", color: "#9c9da0", marginTop: "2px" }}>
                    {product.handle}
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

export default function MappingsPage() {
  const { mappings, charts, products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const chartIdRef = useRef<HTMLSelectElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);
  const productIdRef = useRef<HTMLInputElement>(null);
  const selectedProductRef = useRef<{ id: string; handle: string } | null>(null);

  const handleProductSelect = (productId: string, handle: string) => {
    selectedProductRef.current = { id: productId, handle };
  };

  const handleAdd = () => {
    const chartId = chartIdRef.current?.value || "";

    // Prefer selected product from dropdown
    const productHandle = selectedProductRef.current?.handle?.trim() || handleRef.current?.value?.trim() || "";
    const productId = selectedProductRef.current?.id?.trim() || productIdRef.current?.value?.trim() || "";

    if (!chartId || (!productHandle && !productId)) return;

    fetcher.submit(
      { intent: "add", chartId, productHandle, productId },
      { method: "post" }
    );

    // Reset form
    selectedProductRef.current = null;
    if (handleRef.current) handleRef.current.value = "";
    if (productIdRef.current) productIdRef.current.value = "";
  };

  const handleDelete = (id: string) => {
    if (confirm("Remove this mapping?")) {
      fetcher.submit({ intent: "delete", id }, { method: "post" });
    }
  };

  return (
    <s-page heading="Product Mappings">
      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Link a size chart to specific products. When a customer views that
          product, your size chart will appear.
        </s-paragraph>
        <s-paragraph>
          Use the product search to find and select products from your store,
          or enter the product handle/ID manually if needed.
        </s-paragraph>
      </s-section>

      <s-section heading="Add mapping">
        {charts.length === 0 ? (
          <s-paragraph>Create a size chart first before adding mappings.</s-paragraph>
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

            <ProductSelector
              products={products}
              value={selectedProductRef.current?.id || ""}
              onChange={handleProductSelect}
            />

            <div style={{ borderTop: "1px solid #e1e3e5", paddingTop: "16px" }}>
              <p style={{ fontSize: "13px", color: "#1a1a1a", marginBottom: "12px", fontWeight: 500 }}>
                Manual fallback
              </p>
              <p style={{ fontSize: "12px", color: "#6d7175", marginBottom: "12px" }}>
                Enter product handle or ID if product is not in the list above
              </p>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: 500, fontSize: "13px", color: "#1a1a1a" }}>
                    Product handle
                  </label>
                  <input
                    ref={handleRef}
                    style={inputStyle}
                    placeholder="e.g. womens-slim-tee"
                  />
                  <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#9c9da0" }}>
                    From URL: /products/<strong>handle</strong>
                  </p>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: 500, fontSize: "13px", color: "#1a1a1a" }}>
                    Or product ID
                  </label>
                  <input
                    ref={productIdRef}
                    style={inputStyle}
                    placeholder="e.g. 123456789"
                  />
                </div>
              </div>
            </div>

            <div>
              <button onClick={handleAdd} style={btnPrimaryStyle}>
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
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            {mappings.map((mapping, index) => (
              <div
                key={mapping.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  borderBottom: index < mappings.length - 1 ? "1px solid #e1e3e5" : "none",
                  background: "#fff",
                }}
              >
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 500, color: "#1a1a1a" }}>
                    {mapping.chart.title}
                  </div>
                  <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>
                    <code style={{ background: "#f6f6f7", padding: "2px 6px", borderRadius: "4px" }}>
                      {mapping.productHandle || mapping.productId || "unknown"}
                    </code>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(mapping.id)}
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
