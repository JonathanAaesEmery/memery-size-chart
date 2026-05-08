import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { chartId } = params;

  if (chartId === "new") {
    return { chart: null };
  }

  const chart = await prisma.sizeChart.findFirst({
    where: { id: chartId, shop: session.shop },
    include: {
      columns: { orderBy: { displayOrder: "asc" } },
      rows: {
        orderBy: { displayOrder: "asc" },
        include: { cells: true },
      },
    },
  });

  if (!chart) throw new Response("Not found", { status: 404 });
  return { chart };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const { chartId } = params;

  if (intent === "save") {
    const title = (formData.get("title") as string)?.trim();
    const description = (formData.get("description") as string)?.trim() || null;
    const defaultUnit = (formData.get("defaultUnit") as string) || "cm";
    const instructionsHtml = (formData.get("instructionsHtml") as string)?.trim() || null;

    if (!title) return { error: "Title is required" };

    if (chartId === "new") {
      const chart = await prisma.sizeChart.create({
        data: { shop: session.shop, title, description, defaultUnit, instructionsHtml },
      });
      return redirect(`/app/charts/${chart.id}`);
    } else {
      await prisma.sizeChart.updateMany({
        where: { id: chartId, shop: session.shop },
        data: { title, description, defaultUnit, instructionsHtml },
      });
    }
  }

  if (intent === "add-column") {
    const name = (formData.get("columnName") as string)?.trim();
    const columnType = (formData.get("columnType") as string) || "measurement";
    if (name && chartId !== "new") {
      const count = await prisma.sizeChartColumn.count({ where: { chartId } });
      await prisma.sizeChartColumn.create({
        data: { chartId: chartId!, name, columnType, displayOrder: count },
      });
    }
  }

  if (intent === "add-row") {
    if (chartId !== "new") {
      const count = await prisma.sizeChartRow.count({ where: { chartId } });
      await prisma.sizeChartRow.create({
        data: { chartId: chartId!, displayOrder: count },
      });
    }
  }

  if (intent === "delete-column") {
    const columnId = formData.get("columnId") as string;
    await prisma.sizeChartColumn.delete({ where: { id: columnId } });
  }

  if (intent === "delete-row") {
    const rowId = formData.get("rowId") as string;
    await prisma.sizeChartRow.delete({ where: { id: rowId } });
  }

  if (intent === "save-cells") {
    const entries = Array.from(formData.entries()).filter(([k]) => k.startsWith("cell-"));
    for (const [key, value] of entries) {
      const [, rowId, columnId] = key.split("-", 3).concat(key.split("-").slice(2));
      const parts = key.replace("cell-", "").split("-");
      const cRowId = parts[0];
      const cColId = parts[1];
      await prisma.sizeChartCell.upsert({
        where: { rowId_columnId: { rowId: cRowId, columnId: cColId } },
        update: { value: value as string },
        create: { rowId: cRowId, columnId: cColId, value: value as string },
      });
    }
  }

  return null;
};

export default function ChartEditor() {
  const { chart } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";
  const isNew = !chart;

  const handleDeleteColumn = (columnId: string) => {
    if (confirm("Delete this column? All cell data will be lost.")) {
      submit({ intent: "delete-column", columnId }, { method: "POST" });
    }
  };

  const handleDeleteRow = (rowId: string) => {
    if (confirm("Delete this row? All cell data will be lost.")) {
      submit({ intent: "delete-row", rowId }, { method: "POST" });
    }
  };

  return (
    <s-page heading={isNew ? "Create size chart" : chart.title} back-action="/app/charts">
      {actionData?.error && (
        <s-banner tone="critical" style={{ marginBottom: "16px" }}>
          {actionData.error}
        </s-banner>
      )}

      {/* Basic info form */}
      <s-section heading="Chart details">
        <form method="POST">
          <input type="hidden" name="intent" value="save" />
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Title *
              </label>
              <input
                name="title"
                defaultValue={chart?.title || ""}
                required
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
                placeholder="e.g. Women's Tops"
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Description
              </label>
              <textarea
                name="description"
                defaultValue={chart?.description || ""}
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontSize: "14px",
                  resize: "vertical",
                }}
                placeholder="Optional description shown to customers"
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Default unit
              </label>
              <select
                name="defaultUnit"
                defaultValue={chart?.defaultUnit || "cm"}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
              >
                <option value="cm">cm</option>
                <option value="inch">inch</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Instructions (HTML)
              </label>
              <textarea
                name="instructionsHtml"
                defaultValue={chart?.instructionsHtml || ""}
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontFamily: "monospace",
                  resize: "vertical",
                }}
                placeholder="<p>How to measure yourself...</p>"
              />
            </div>
            <div>
              <s-button submit disabled={isLoading}>
                {isNew ? "Create chart" : "Save details"}
              </s-button>
            </div>
          </div>
        </form>
      </s-section>

      {/* Table editor — only shown after chart exists */}
      {!isNew && (
        <>
          <s-section heading="Size table">
            {/* Add column */}
            <form method="POST" style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "flex-end" }}>
              <input type="hidden" name="intent" value="add-column" />
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>
                  Column name
                </label>
                <input
                  name="columnName"
                  required
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #c9cccf",
                    borderRadius: "4px",
                    fontSize: "13px",
                  }}
                  placeholder="e.g. XS, Chest (cm)"
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>
                  Type
                </label>
                <select
                  name="columnType"
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #c9cccf",
                    borderRadius: "4px",
                    fontSize: "13px",
                  }}
                >
                  <option value="size_label">Size label</option>
                  <option value="measurement">Measurement</option>
                </select>
              </div>
              <s-button submit variant="secondary">Add column</s-button>
            </form>

            {/* The table */}
            {chart.columns.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <form method="POST">
                  <input type="hidden" name="intent" value="save-cells" />
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "13px" }}>
                    <thead>
                      <tr>
                        <th style={{ padding: "6px", border: "1px solid #e1e3e5", background: "#f6f6f7", width: "32px" }} />
                        {chart.columns.map((col) => (
                          <th
                            key={col.id}
                            style={{
                              padding: "6px 10px",
                              border: "1px solid #e1e3e5",
                              background: "#f6f6f7",
                              textAlign: "left",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span>{col.name}</span>
                              <span style={{ fontSize: "11px", color: "#6d7175" }}>({col.columnType})</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteColumn(col.id)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  color: "#d72c0d",
                                  fontSize: "12px",
                                  padding: "0 2px",
                                }}
                                title="Delete column"
                              >
                                ✕
                              </button>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chart.rows.map((row) => (
                        <tr key={row.id}>
                          <td style={{ padding: "4px", border: "1px solid #e1e3e5", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(row.id)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "#d72c0d",
                                fontSize: "12px",
                              }}
                              title="Delete row"
                            >
                              ✕
                            </button>
                          </td>
                          {chart.columns.map((col) => {
                            const cell = row.cells.find((c) => c.columnId === col.id);
                            return (
                              <td key={col.id} style={{ padding: "2px", border: "1px solid #e1e3e5" }}>
                                <input
                                  name={`cell-${row.id}-${col.id}`}
                                  defaultValue={cell?.value || ""}
                                  style={{
                                    width: "100%",
                                    padding: "4px 8px",
                                    border: "none",
                                    fontSize: "13px",
                                    background: "transparent",
                                  }}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                    <s-button submit disabled={isLoading}>Save table</s-button>
                  </div>
                </form>
              </div>
            ) : (
              <s-paragraph>Add columns to start building your size table.</s-paragraph>
            )}

            {/* Add row */}
            <form method="POST" style={{ marginTop: "12px" }}>
              <input type="hidden" name="intent" value="add-row" />
              <s-button submit variant="secondary" disabled={chart.columns.length === 0 || isLoading}>
                Add row
              </s-button>
            </form>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
