import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
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
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Delete "${title}"? This cannot be undone.`)) {
      submit({ intent: "delete", id }, { method: "POST" });
    }
  };

  const handleToggle = (id: string) => {
    submit({ intent: "toggle", id }, { method: "POST" });
  };

  return (
    <s-page heading="Size Charts">
      <s-button slot="primary-action" href="/app/charts/new">
        Create chart
      </s-button>

      {charts.length === 0 ? (
        <s-section>
          <s-paragraph>
            No size charts yet. Create your first chart to get started.
          </s-paragraph>
          <s-button href="/app/charts/new">Create your first chart</s-button>
        </s-section>
      ) : (
        <s-section>
          <s-data-table
            headings={JSON.stringify(["Title", "Status", "Mappings", "Actions"])}
            rows={JSON.stringify(
              charts.map((chart) => [
                chart.title,
                chart.isActive ? "Active" : "Inactive",
                `${chart._count.productMappings} products`,
                "",
              ])
            )}
          />
          <div style={{ marginTop: "16px" }}>
            {charts.map((chart) => (
              <div
                key={chart.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 0",
                  borderBottom: "1px solid #e1e3e5",
                }}
              >
                <div>
                  <strong>{chart.title}</strong>
                  <span
                    style={{
                      marginLeft: "8px",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      backgroundColor: chart.isActive ? "#d4edda" : "#f8d7da",
                      color: chart.isActive ? "#155724" : "#721c24",
                    }}
                  >
                    {chart.isActive ? "Active" : "Inactive"}
                  </span>
                  <span style={{ marginLeft: "8px", color: "#6d7175", fontSize: "13px" }}>
                    {chart._count.productMappings} product{chart._count.productMappings !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <s-button variant="tertiary" href={`/app/charts/${chart.id}`}>
                    Edit
                  </s-button>
                  <s-button
                    variant="tertiary"
                    onClick={() => handleToggle(chart.id)}
                    disabled={isLoading}
                  >
                    {chart.isActive ? "Deactivate" : "Activate"}
                  </s-button>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => handleDelete(chart.id, chart.title)}
                    disabled={isLoading}
                  >
                    Delete
                  </s-button>
                </div>
              </div>
            ))}
          </div>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
