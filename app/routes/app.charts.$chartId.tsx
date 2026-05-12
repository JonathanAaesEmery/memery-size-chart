import React from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData, useSearchParams, useFetcher, useNavigate, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ─── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { chartId } = params;
  if (chartId === "new") return { chart: null };

  const chart = await prisma.sizeChart.findFirst({
    where: { id: chartId, shop: session.shop },
    include: {
      columns: { orderBy: { displayOrder: "asc" } },
      rows: { orderBy: { displayOrder: "asc" }, include: { cells: true } },
    },
  });
  if (!chart) throw new Response("Not found", { status: 404 });
  return { chart };
};

// ─── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const { chartId } = params;

  if (intent === "go-back") {
    const url = new URL(request.url);
    return redirect(`/app/charts${url.search}`);
  }

  if (intent === "save-details") {
    const title = (form.get("title") as string)?.trim();
    const description = (form.get("description") as string)?.trim() || null;
    const chartType = (form.get("chartType") as string) || "simple";
    const defaultUnit = (form.get("defaultUnit") as string) || "cm";
    const instructionsHtml = (form.get("instructionsHtml") as string)?.trim() || null;
    if (!title) return { error: "Title is required" };

    if (chartId === "new") {
      const chart = await prisma.sizeChart.create({
        data: { shop: session.shop, title, description, chartType, defaultUnit, instructionsHtml },
      });
      // When called from the inline editor, return JSON so no redirect/navigation happens
      if (form.get("returnJson") === "true") {
        return { newChartId: chart.id };
      }
      const url = new URL(request.url);
      const qs = url.search;
      return redirect(`/app/charts/${chart.id}${qs}`);
    }
    await prisma.sizeChart.updateMany({
      where: { id: chartId, shop: session.shop },
      data: { title, description, chartType, defaultUnit, instructionsHtml },
    });
    return { success: "Saved" };
  }

  if (intent === "add-column") {
    const name = (form.get("columnName") as string)?.trim();
    const columnType = (form.get("columnType") as string) || "size_label";
    const isMatchingKey = form.get("isMatchingKey") === "true";
    const customerInputEnabled = form.get("customerInputEnabled") === "true";
    const apparelMeasurementType = (form.get("apparelMeasurementType") as string)?.trim() || null;
    const inputLabel = (form.get("inputLabel") as string)?.trim() || null;

    if (name && chartId !== "new") {
      const count = await prisma.sizeChartColumn.count({ where: { chartId } });
      await prisma.sizeChartColumn.create({
        data: { chartId: chartId!, name, columnType, displayOrder: count, isMatchingKey, customerInputEnabled, apparelMeasurementType, inputLabel },
      });
    }
    return { success: "Column added" };
  }

  if (intent === "update-column") {
    const columnId = form.get("columnId") as string;
    const name = (form.get("name") as string)?.trim();
    const isMatchingKey = form.get("isMatchingKey") === "true";
    const customerInputEnabled = form.get("customerInputEnabled") === "true";
    const inputLabel = (form.get("inputLabel") as string)?.trim() || null;
    const apparelMeasurementType = (form.get("apparelMeasurementType") as string)?.trim() || null;
    const updateData: any = { isMatchingKey, customerInputEnabled, inputLabel, apparelMeasurementType };
    if (name) updateData.name = name;
    await prisma.sizeChartColumn.update({ where: { id: columnId }, data: updateData });
    return { success: "Column updated" };
  }

  if (intent === "delete-column") {
    await prisma.sizeChartColumn.delete({ where: { id: form.get("columnId") as string } });
    return { success: "Column deleted" };
  }

  if (intent === "add-row") {
    if (chartId !== "new") {
      const count = await prisma.sizeChartRow.count({ where: { chartId } });
      await prisma.sizeChartRow.create({ data: { chartId: chartId!, displayOrder: count } });
    }
    return { success: "Row added" };
  }

  if (intent === "delete-row") {
    await prisma.sizeChartRow.delete({ where: { id: form.get("rowId") as string } });
    return { success: "Row deleted" };
  }

  if (intent === "save-cells") {
    const entries = Array.from(form.entries());
    for (const [key, value] of entries) {
      if (key.startsWith("val-")) {
        const [, rowId, colId] = key.split("-", 3).concat(key.split("-").slice(3));
        const parts = key.replace("val-", "").split("-");
        const rId = parts[0]; const cId = parts[1];
        const minRaw = form.get(`min-${rId}-${cId}`) as string;
        const maxRaw = form.get(`max-${rId}-${cId}`) as string;
        await prisma.sizeChartCell.upsert({
          where: { rowId_columnId: { rowId: rId, columnId: cId } },
          update: { value: value as string, minValue: minRaw ? parseFloat(minRaw) : null, maxValue: maxRaw ? parseFloat(maxRaw) : null },
          create: { rowId: rId, columnId: cId, value: value as string, minValue: minRaw ? parseFloat(minRaw) : null, maxValue: maxRaw ? parseFloat(maxRaw) : null },
        });
      }
    }
    return { success: "Table saved" };
  }

  return null;
};

// ─── Component ─────────────────────────────────────────────────────────────────

const CHART_TYPES = [
  { value: "simple", label: "Simple table" },
  { value: "apparel", label: "Apparel (with size recommendation)" },
  { value: "footwear", label: "Footwear (with size recommendation)" },
];

const MEASUREMENT_TYPES = [
  { value: "bust", label: "Bust/Chest" },
  { value: "waist", label: "Waist" },
  { value: "hip", label: "Hip" },
  { value: "shoulder", label: "Shoulder" },
  { value: "length", label: "Length" },
  { value: "sleeve", label: "Sleeve" },
  { value: "foot_length", label: "Foot length" },
  { value: "inseam", label: "Inseam" },
];

export default function ChartEditor() {
  const { chart } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const isNew = !chart;
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const detailsRef = React.useRef<HTMLFormElement>(null);
  const cellsRef = React.useRef<HTMLFormElement>(null);

  function del(intent: string, extra: Record<string, string>) {
    if (!confirm("Are you sure?")) return;
    submit({ intent, ...extra }, { method: "post" });
  }

  const hasMeasurementCols = chart?.columns?.some(
    (c) => c.columnType === "measurement" && (c.isMatchingKey || c.customerInputEnabled)
  );

  const navigate = useNavigate();
  const shop = searchParams.get("shop") || "";
  const host = searchParams.get("host") || "";
  const navQs = [shop && `shop=${shop}`, host && `host=${host}`].filter(Boolean).join("&");
  const goBack = () => {
    const path = navQs ? `/app/charts?${navQs}` : "/app/charts";
    (window as any).shopify?.navigate?.(path);
    navigate(path);
  };

  return (
    <s-page heading={isNew ? "New size chart" : chart.title}>
      <div slot="breadcrumbs">
        <button onClick={goBack} style={{ color: "#6d7175", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0 }}>
          Size Charts
        </button>
      </div>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0 24px" }}>

      {actionData && "error" in actionData && (
        <div style={bannerStyle("error")}>{actionData.error}</div>
      )}
      {actionData && "success" in actionData && (
        <div style={bannerStyle("success")}>{actionData.success}</div>
      )}

      {/* ── Section 1: Details ── */}
      <div style={cardStyle}>
        <h2 style={sectionHeading}>Chart details</h2>
        <form ref={detailsRef}>
          <input type="hidden" name="intent" value="save-details" />
          <div style={fieldGrid}>
            <div style={fieldFull}>
              <label style={labelStyle}>Title *</label>
              <input name="title" defaultValue={chart?.title || ""} required style={inputStyle} placeholder="e.g. Women's knitwear, Men's shoes…" />
            </div>
            <div>
              <label style={labelStyle}>Chart type</label>
              <select name="chartType" defaultValue={chart?.chartType || "simple"} style={selectStyle}>
                {CHART_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <p style={hintStyle}>Choose "Apparel" or "Footwear" to enable customer measurement input and size recommendation.</p>
            </div>
            <div>
              <label style={labelStyle}>Default unit</label>
              <select name="defaultUnit" defaultValue={chart?.defaultUnit || "cm"} style={selectStyle}>
                <option value="cm">Centimeters (cm)</option>
                <option value="inch">Inches (in)</option>
              </select>
            </div>
            <div style={fieldFull}>
              <label style={labelStyle}>Description</label>
              <textarea name="description" defaultValue={chart?.description || ""} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Shown at the top of the guide, e.g. 'Size guide for knitwear'" />
            </div>
            <div style={fieldFull}>
              <label style={labelStyle}>Instructions (HTML)</label>
              <textarea name="instructionsHtml" defaultValue={chart?.instructionsHtml || ""} rows={3} style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} placeholder="<p>How to measure yourself…</p>" />
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={() => detailsRef.current && submit(new FormData(detailsRef.current), { method: "post" })} style={btnPrimary}>
              {isNew ? "Create chart" : "Save details"}
            </button>
          </div>
        </form>
      </div>

      {/* ── Section 2: Columns ── */}
      {!isNew && (
        <div style={cardStyle}>
          <h2 style={sectionHeading}>Columns</h2>
          <p style={hintStyle}>Add the columns for your size table. Enable "Customer input" on measurement columns to let customers find their size.</p>

          {chart.columns.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {chart.columns.map((col) => (
                <ColumnCard key={col.id} col={col} submit={submit} busy={busy} onDelete={() => del("delete-column", { columnId: col.id })} />
              ))}
            </div>
          )}

          <AddColumnForm submit={submit} busy={busy} />
        </div>
      )}

      {/* ── Section 3: Size table ── */}
      {!isNew && chart.columns.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ ...sectionHeading, margin: 0 }}>Size table</h2>
            <button onClick={() => submit({ intent: "add-row" }, { method: "post" })} style={btnSecondary}>+ Add row</button>
          </div>

          {chart.rows.length === 0 ? (
            <p style={{ color: "#6d7175", fontSize: 14 }}>No rows yet. Click "Add row" to start.</p>
          ) : (
            <form ref={cellsRef}>
              <input type="hidden" name="intent" value="save-cells" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}></th>
                      {chart.columns.map((col) => (
                        <th key={col.id} style={thStyle}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span>{col.name}</span>
                            {col.customerInputEnabled && <span style={{ fontSize: 10, color: "#8c6af6", fontWeight: 400 }}>customer input</span>}
                          </div>
                        </th>
                      ))}
                    </tr>
                    {hasMeasurementCols && (
                      <tr>
                        <th style={{ ...thStyle, background: "#faf9fb", fontSize: 10, color: "#6d7175" }}>Min / Max</th>
                        {chart.columns.map((col) => (
                          <th key={col.id} style={{ ...thStyle, background: "#faf9fb", fontWeight: 400, fontSize: 10, color: "#6d7175" }}>
                            {col.customerInputEnabled ? "min / max" : "—"}
                          </th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {chart.rows.map((row) => (
                      <tr key={row.id}>
                        <td style={{ ...tdStyle, width: 32 }}>
                          <button type="button" onClick={() => del("delete-row", { rowId: row.id })} style={deleteDotBtn} title="Delete row">✕</button>
                        </td>
                        {chart.columns.map((col) => {
                          const cell = row.cells.find((c) => c.columnId === col.id);
                          return (
                            <td key={col.id} style={tdStyle}>
                              <input name={`val-${row.id}-${col.id}`} defaultValue={cell?.value || ""} style={cellInput} placeholder="—" />
                              {col.customerInputEnabled && (
                                <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                                  <input name={`min-${row.id}-${col.id}`} defaultValue={cell?.minValue ?? ""} style={{ ...cellInput, width: "45%", fontSize: 11, color: "#6d7175" }} placeholder="min" type="number" step="0.1" />
                                  <input name={`max-${row.id}-${col.id}`} defaultValue={cell?.maxValue ?? ""} style={{ ...cellInput, width: "45%", fontSize: 11, color: "#6d7175" }} placeholder="max" type="number" step="0.1" />
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 14 }}>
                <button onClick={() => cellsRef.current && submit(new FormData(cellsRef.current), { method: "post" })} style={btnPrimary}>Save table</button>
              </div>
            </form>
          )}
        </div>
      )}
      </div>
    </s-page>
  );
}

// ─── ColumnCard ─────────────────────────────────────────────────────────────────

function ColumnCard({ col, submit, busy, onDelete }: any) {
  const [expanded, setExpanded] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#fafafa", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{col.name}</span>
          <span style={typeBadge(col.columnType)}>{col.columnType === "size_label" ? "size label" : "measurement"}</span>
          {col.customerInputEnabled && <span style={typeBadge("input")}>customer input</span>}
          {col.isMatchingKey && <span style={typeBadge("key")}>matching key</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ color: "#6d7175", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...deleteDotBtn, position: "static" }}>✕</button>
        </div>
      </div>
      {expanded && (
        <form ref={formRef} style={{ padding: "14px 16px", background: "#fff" }}>
          <input type="hidden" name="intent" value="update-column" />
          <input type="hidden" name="columnId" value={col.id} />
          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Customer input</label>
              <select name="customerInputEnabled" defaultValue={col.customerInputEnabled ? "true" : "false"} style={selectStyle}>
                <option value="false">No</option>
                <option value="true">Yes — customer can enter this measurement</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Matching key</label>
              <select name="isMatchingKey" defaultValue={col.isMatchingKey ? "true" : "false"} style={selectStyle}>
                <option value="false">No</option>
                <option value="true">Yes — used for size recommendation output</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Measurement type</label>
              <select name="apparelMeasurementType" defaultValue={col.apparelMeasurementType || ""} style={selectStyle}>
                <option value="">— none —</option>
                {MEASUREMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Label shown to customer</label>
              <input name="inputLabel" defaultValue={col.inputLabel || ""} style={inputStyle} placeholder="e.g. Bust/Chest (cm)" />
            </div>
          </div>
          <button onClick={() => formRef.current && submit(new FormData(formRef.current), { method: "post" })} style={{ ...btnSecondary, marginTop: 12 }}>Save column</button>
        </form>
      )}
    </div>
  );
}

// ─── AddColumnForm ───────────────────────────────────────────────────────────────

function AddColumnForm({ submit, busy }: any) {
  const [type, setType] = React.useState("size_label");
  const formRef = React.useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(formRef.current!);
    submit(fd, { method: "post" });
    formRef.current?.reset();
    setType("size_label");
  }

  return (
    <div style={{ border: "2px dashed #e1e3e5", borderRadius: 8, padding: "16px" }}>
      <p style={{ margin: "0 0 12px", fontWeight: 500, fontSize: 14 }}>+ New column</p>
      <form ref={formRef} onSubmit={handleSubmit}>
        <input type="hidden" name="intent" value="add-column" />
        <div style={fieldGrid}>
          <div>
            <label style={labelStyle}>Column name *</label>
            <input name="columnName" required style={inputStyle} placeholder="e.g. SIZE, EU, Bust (cm)…" />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select name="columnType" value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
              <option value="size_label">Size label (XS, S, M…)</option>
              <option value="measurement">Measurement (number)</option>
            </select>
          </div>
          {type === "measurement" && (
            <>
              <div>
                <label style={labelStyle}>Customer input</label>
                <select name="customerInputEnabled" style={selectStyle}>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Matching key</label>
                <select name="isMatchingKey" style={selectStyle}>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Measurement type</label>
                <select name="apparelMeasurementType" style={selectStyle}>
                  <option value="">— none —</option>
                  {MEASUREMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Label shown to customer</label>
                <input name="inputLabel" style={inputStyle} placeholder="e.g. Bust/Chest (cm)" />
              </div>
            </>
          )}
          {type === "size_label" && (
            <input type="hidden" name="customerInputEnabled" value="false" />
          )}
        </div>
        <button type="submit" style={{ ...btnSecondary, marginTop: 14 }}>Add column</button>
      </form>
    </div>
  );
}


// ─── Styles ─────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: 12, padding: "24px", marginBottom: 20 };
const sectionHeading: React.CSSProperties = { fontSize: 16, fontWeight: 600, margin: "0 0 16px" };
const fieldGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };
const fieldFull: React.CSSProperties = { gridColumn: "1 / -1" };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 5, fontWeight: 500, fontSize: 13 };
const hintStyle: React.CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "#6d7175" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const selectStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 14, background: "#fff", boxSizing: "border-box" };
const cellInput: React.CSSProperties = { width: "100%", padding: "5px 7px", border: "1px solid #e1e3e5", borderRadius: 4, fontSize: 13, boxSizing: "border-box", background: "transparent" };
const thStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #e1e3e5", background: "#f6f6f7", textAlign: "left", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "4px 6px", border: "1px solid #e1e3e5", verticalAlign: "top" };
const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" };
const deleteDotBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "#d72c0d", fontSize: 13, padding: "2px 4px" };

function typeBadge(type: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    size_label: { bg: "#e3f1e3", color: "#2d6a2d" },
    measurement: { bg: "#e8f0ff", color: "#1a4a9c" },
    input: { bg: "#f3edff", color: "#5c21ba" },
    key: { bg: "#fff3cd", color: "#856404" },
  };
  const c = colors[type] || { bg: "#f0f0f0", color: "#555" };
  return { display: "inline-block", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500, background: c.bg, color: c.color };
}

function bannerStyle(type: "error" | "success"): React.CSSProperties {
  return {
    padding: "10px 14px", borderRadius: 6, marginBottom: 16, fontSize: 14,
    background: type === "error" ? "#fff4f4" : "#f1faf1",
    color: type === "error" ? "#d72c0d" : "#1a6b1a",
    border: `1px solid ${type === "error" ? "#f9c0b9" : "#a8d5a8"}`,
  };
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
