import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

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

  return { mappings, charts };
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

export default function MappingsPage() {
  const { mappings, charts } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Product Mappings">
      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Link a size chart to specific products by their handle or product ID.
          When a customer views that product, your size chart will appear.
        </s-paragraph>
        <s-paragraph>
          The product handle is the URL-friendly name found in the product URL,
          e.g. <code>womens-slim-tee</code>.
        </s-paragraph>
      </s-section>

      <s-section heading="Add mapping">
        {charts.length === 0 ? (
          <s-paragraph>
            <s-link href="/app/charts">Create a size chart first</s-link> before adding mappings.
          </s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="add" />
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Size chart
                </label>
                <select name="chartId" required style={selectStyle}>
                  <option value="">Select a chart...</option>
                  {charts.map((chart) => (
                    <option key={chart.id} value={chart.id}>{chart.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Product handle
                </label>
                <input name="productHandle" style={inputStyle} placeholder="e.g. womens-slim-tee" />
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6d7175" }}>
                  Found in the product URL: /products/<strong>product-handle</strong>
                </p>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Or product ID
                </label>
                <input name="productId" style={inputStyle} placeholder="e.g. 123456789" />
              </div>
              <div>
                <button type="submit" style={btnPrimaryStyle}>Add mapping</button>
              </div>
            </div>
          </Form>
        )}
      </s-section>

      <s-section heading={`Mappings (${mappings.length})`}>
        {mappings.length === 0 ? (
          <s-paragraph>No mappings yet.</s-paragraph>
        ) : (
          mappings.map((mapping) => (
            <div
              key={mapping.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid #e1e3e5",
              }}
            >
              <div>
                <strong>{mapping.chart.title}</strong>
                <span style={{ margin: "0 8px", color: "#6d7175" }}>→</span>
                <code style={{ fontSize: "13px", background: "#f6f6f7", padding: "2px 6px", borderRadius: "3px" }}>
                  {mapping.productHandle || mapping.productId || "unknown"}
                </code>
              </div>
              <Form method="post" onSubmit={(e) => { if (!confirm("Remove this mapping?")) e.preventDefault(); }}>
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="id" value={mapping.id} />
                <button type="submit" style={btnDangerStyle}>Remove</button>
              </Form>
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
