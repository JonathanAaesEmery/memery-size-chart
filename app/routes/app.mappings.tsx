import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
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
      // Normalize productId to GID format
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
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const handleDelete = (id: string) => {
    if (confirm("Remove this mapping?")) {
      submit({ intent: "delete", id }, { method: "POST" });
    }
  };

  return (
    <s-page heading="Product Mappings">
      <s-section
        slot="aside"
        heading="How it works"
      >
        <s-paragraph>
          Link a size chart to specific products by their handle or product ID.
          When a customer views that product, your size chart will appear.
        </s-paragraph>
        <s-paragraph>
          The product handle is the URL-friendly name found in the product URL,
          e.g. <code>womens-slim-tee</code>.
        </s-paragraph>
      </s-section>

      {/* Add mapping form */}
      <s-section heading="Add mapping">
        {charts.length === 0 ? (
          <s-paragraph>
            <s-link href="/app/charts">Create a size chart first</s-link> before adding mappings.
          </s-paragraph>
        ) : (
          <form method="POST">
            <input type="hidden" name="intent" value="add" />
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Size chart
                </label>
                <select
                  name="chartId"
                  required
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #c9cccf",
                    borderRadius: "4px",
                    fontSize: "14px",
                  }}
                >
                  <option value="">Select a chart...</option>
                  {charts.map((chart) => (
                    <option key={chart.id} value={chart.id}>
                      {chart.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Product handle
                </label>
                <input
                  name="productHandle"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #c9cccf",
                    borderRadius: "4px",
                    fontSize: "14px",
                  }}
                  placeholder="e.g. womens-slim-tee"
                />
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6d7175" }}>
                  Found in the product URL: /products/<strong>product-handle</strong>
                </p>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Or product ID
                </label>
                <input
                  name="productId"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #c9cccf",
                    borderRadius: "4px",
                    fontSize: "14px",
                  }}
                  placeholder="e.g. 123456789"
                />
              </div>
              <div>
                <s-button submit disabled={isLoading}>Add mapping</s-button>
              </div>
            </div>
          </form>
        )}
      </s-section>

      {/* Existing mappings */}
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
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => handleDelete(mapping.id)}
                disabled={isLoading}
              >
                Remove
              </s-button>
            </div>
          ))
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
