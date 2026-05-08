import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
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
  collection: "Collection",
};

export default function FallbacksPage() {
  const { fallbacks, charts } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const handleDelete = (id: string) => {
    if (confirm("Remove this fallback rule?")) {
      submit({ intent: "delete", id }, { method: "POST" });
    }
  };

  return (
    <s-page heading="Fallback Rules">
      <s-section
        slot="aside"
        heading="How fallbacks work"
      >
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
          <s-paragraph>
            <s-link href="/app/charts">Create a size chart first</s-link>.
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
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                    Match by
                  </label>
                  <select
                    name="mappingType"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #c9cccf",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  >
                    <option value="tag">Product tag</option>
                    <option value="vendor">Vendor</option>
                    <option value="product_type">Product type</option>
                  </select>
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                    Value
                  </label>
                  <input
                    name="mappingValue"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #c9cccf",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                    placeholder="e.g. womens, Memery, T-Shirts"
                  />
                </div>
                <div style={{ width: "80px" }}>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                    Priority
                  </label>
                  <input
                    name="priority"
                    type="number"
                    defaultValue="0"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid #c9cccf",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  />
                </div>
              </div>
              <div>
                <s-button submit disabled={isLoading}>Add rule</s-button>
              </div>
            </div>
          </form>
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
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => handleDelete(fb.id)}
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
