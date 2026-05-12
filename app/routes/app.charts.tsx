import React from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Loader ──────────────────────────────────────────────────────────────────

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

// ─── Action (list operations only) ───────────────────────────────────────────

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

// ─── ChartsPage ───────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const { charts } = useLoaderData<typeof loader>();
  const mutFetcher = useFetcher();
  const [editingId, setEditingId] = React.useState<null | "new" | string>(null);

  const handleToggle = (id: string) => {
    mutFetcher.submit({ intent: "toggle", id }, { method: "post" });
  };

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Delete "${title}"?`)) {
      mutFetcher.submit({ intent: "delete", id }, { method: "post" });
    }
  };

  // Show inline editor instead of list when editing
  if (editingId !== null) {
    return (
      <InlineChartEditor
        editingId={editingId}
        onEditingIdChange={setEditingId}
        onBack={() => setEditingId(null)}
      />
    );
  }

  return (
    <s-page heading="Size Charts">
      <div slot="primary-action">
        <button onClick={() => setEditingId("new")} style={btnPrimaryStyle}>+ Create chart</button>
      </div>

      <s-section>
        {charts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ color: "#6d7175", marginBottom: 16 }}>No size charts yet.</p>
            <button onClick={() => setEditingId("new")} style={btnPrimaryStyle}>Create your first chart</button>
          </div>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: 12, overflow: "hidden" }}>
            {charts.map((chart, i) => (
              <div
                key={chart.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 20px",
                  borderBottom: i < charts.length - 1 ? "1px solid #e1e3e5" : "none",
                  background: "#fff",
                }}
              >
                <div>
                  <strong style={{ fontSize: 15 }}>{chart.title}</strong>
                  <span style={{
                    marginLeft: 10,
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 12,
                    background: chart.isActive ? "#d4edda" : "#f8d7da",
                    color: chart.isActive ? "#155724" : "#721c24",
                  }}>
                    {chart.isActive ? "Active" : "Inactive"}
                  </span>
                  <span style={{ marginLeft: 10, color: "#6d7175", fontSize: 13 }}>
                    {chart._count.productMappings} product{chart._count.productMappings !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => setEditingId(chart.id)} style={btnSecondaryStyle}>Edit</button>
                  <button onClick={() => handleToggle(chart.id)} style={btnSecondaryStyle}>
                    {chart.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(chart.id, chart.title)} style={btnDangerStyle}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

// ─── InlineChartEditor ────────────────────────────────────────────────────────
// Renders the chart editor on the same page (no URL navigation).
// Uses useFetcher to load chart data and submit actions to the chart editor
// route handlers — completely bypasses App Bridge navigation interception.

function InlineChartEditor({
  editingId,
  onEditingIdChange,
  onBack,
}: {
  editingId: "new" | string;
  onEditingIdChange: (id: string) => void;
  onBack: () => void;
}) {
  const dataFetcher = useFetcher<{ chart: any }>();
  const editorFetcher = useFetcher<any>();

  const actionUrl = editingId === "new" ? "/app/charts/new" : `/app/charts/${editingId}`;
  const chart = dataFetcher.data?.chart ?? null;
  const isNew = !chart;
  const busy = editorFetcher.state !== "idle";

  const detailsRef = React.useRef<HTMLFormElement>(null);
  const cellsRef = React.useRef<HTMLFormElement>(null);

  // Load chart data when the editor first mounts
  React.useEffect(() => {
    dataFetcher.load(actionUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After each editor action completes, reload data (or switch to new chart ID)
  const prevEditorState = React.useRef<string>("idle");
  React.useEffect(() => {
    const prev = prevEditorState.current;
    const curr = editorFetcher.state;
    prevEditorState.current = curr;

    if (prev !== "idle" && curr === "idle" && editorFetcher.data) {
      if (editorFetcher.data.newChartId) {
        // A new chart was just created — update the editing ID and load it
        const newId = editorFetcher.data.newChartId as string;
        onEditingIdChange(newId);
        dataFetcher.load(`/app/charts/${newId}`);
      } else {
        // Any other action (add-column, save-cells, etc.) — reload current data
        dataFetcher.load(actionUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorFetcher.state]);

  // Submit helper — always posts to the correct chart editor route action
  function editorSubmit(data: FormData | Record<string, string>) {
    editorFetcher.submit(data, { method: "post", action: actionUrl });
  }

  // Confirm-then-delete helper
  function del(intent: string, extra: Record<string, string>) {
    if (!confirm("Are you sure?")) return;
    editorSubmit({ intent, ...extra });
  }

  // Passed to child components so they also submit to the right action URL
  const childSubmit = (data: FormData | Record<string, string>) => {
    editorFetcher.submit(data, { method: "post", action: actionUrl });
  };

  const hasMeasurementCols = chart?.columns?.some(
    (c: any) => c.columnType === "measurement" && (c.isMatchingKey || c.customerInputEnabled)
  );

  // Show a loading screen only on the very first fetch (before any data arrives)
  if (dataFetcher.state === "loading" && !dataFetcher.data) {
    return (
      <s-page heading="Loading…">
        <s-section>
          <p style={{ color: "#6d7175", padding: "8px 0" }}>Loading chart…</p>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={isNew ? "New size chart" : (chart?.title || "Edit chart")}>
      <div slot="breadcrumbs">
        <button
          onClick={onBack}
          style={{ color: "#6d7175", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0 }}
        >
          Size Charts
        </button>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 0 24px" }}>

        {editorFetcher.data && "error" in editorFetcher.data && (
          <div style={bannerStyle("error")}>{editorFetcher.data.error}</div>
        )}
        {editorFetcher.data && "success" in editorFetcher.data && (
          <div style={bannerStyle("success")}>{editorFetcher.data.success}</div>
        )}

        {/* ── Details ── */}
        <div style={editorCard}>
          <h2 style={sectionHeading}>Chart details</h2>
          <form ref={detailsRef}>
            <input type="hidden" name="intent" value="save-details" />
            <div style={fieldGrid}>
              <div style={fieldFull}>
                <label style={labelStyle}>Title *</label>
                <input
                  name="title"
                  defaultValue={chart?.title || ""}
                  required
                  style={editorInput}
                  placeholder="e.g. Women's knitwear, Men's shoes…"
                />
              </div>
              <div>
                <label style={labelStyle}>Chart type</label>
                <select name="chartType" defaultValue={chart?.chartType || "simple"} style={editorSelect}>
                  {CHART_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <p style={hintStyle}>Choose "Apparel" or "Footwear" to enable size recommendations.</p>
              </div>
              <div>
                <label style={labelStyle}>Default unit</label>
                <select name="defaultUnit" defaultValue={chart?.defaultUnit || "cm"} style={editorSelect}>
                  <option value="cm">Centimeters (cm)</option>
                  <option value="inch">Inches (in)</option>
                </select>
              </div>
              <div style={fieldFull}>
                <label style={labelStyle}>Description</label>
                <textarea
                  name="description"
                  defaultValue={chart?.description || ""}
                  rows={2}
                  style={{ ...editorInput, resize: "vertical" } as React.CSSProperties}
                  placeholder="Shown at the top of the guide"
                />
              </div>
              <div style={fieldFull}>
                <label style={labelStyle}>Instructions (HTML)</label>
                <textarea
                  name="instructionsHtml"
                  defaultValue={chart?.instructionsHtml || ""}
                  rows={3}
                  style={{ ...editorInput, resize: "vertical", fontFamily: "monospace", fontSize: 12 } as React.CSSProperties}
                  placeholder="<p>How to measure yourself…</p>"
                />
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!detailsRef.current) return;
                  const fd = new FormData(detailsRef.current);
                  // returnJson tells the chart editor action to return { newChartId }
                  // instead of a redirect() when creating a new chart
                  fd.set("returnJson", "true");
                  editorFetcher.submit(fd, { method: "post", action: actionUrl });
                }}
                style={editorBtnPrimary}
              >
                {isNew ? "Create chart" : "Save details"}
              </button>
            </div>
          </form>
        </div>

        {/* ── Columns ── */}
        {!isNew && (
          <div style={editorCard}>
            <h2 style={sectionHeading}>Columns</h2>
            <p style={hintStyle}>Add columns for your size table. Enable "Customer input" on measurement columns to let customers find their size.</p>
            {chart.columns.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                {chart.columns.map((col: any) => (
                  <ColumnCard
                    key={col.id}
                    col={col}
                    submit={childSubmit}
                    busy={busy}
                    onDelete={() => del("delete-column", { columnId: col.id })}
                  />
                ))}
              </div>
            )}
            <AddColumnForm submit={childSubmit} busy={busy} />
          </div>
        )}

        {/* ── Size table ── */}
        {!isNew && chart.columns.length > 0 && (
          <div style={editorCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ ...sectionHeading, margin: 0 }}>Size table</h2>
              <button type="button" onClick={() => editorSubmit({ intent: "add-row" })} style={editorBtnSecondary}>
                + Add row
              </button>
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
                        {chart.columns.map((col: any) => (
                          <th key={col.id} style={thStyle}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span>{col.name}</span>
                              {col.customerInputEnabled && (
                                <span style={{ fontSize: 10, color: "#8c6af6", fontWeight: 400 }}>customer input</span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                      {hasMeasurementCols && (
                        <tr>
                          <th style={{ ...thStyle, background: "#faf9fb", fontSize: 10, color: "#6d7175" }}>Min / Max</th>
                          {chart.columns.map((col: any) => (
                            <th key={col.id} style={{ ...thStyle, background: "#faf9fb", fontWeight: 400, fontSize: 10, color: "#6d7175" }}>
                              {col.customerInputEnabled ? "min / max" : "—"}
                            </th>
                          ))}
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {chart.rows.map((row: any) => (
                        <tr key={row.id}>
                          <td style={{ ...tdStyle, width: 32 }}>
                            <button type="button" onClick={() => del("delete-row", { rowId: row.id })} style={deleteDotBtn} title="Delete row">✕</button>
                          </td>
                          {chart.columns.map((col: any) => {
                            const cell = row.cells.find((c: any) => c.columnId === col.id);
                            return (
                              <td key={col.id} style={tdStyle}>
                                <input
                                  name={`val-${row.id}-${col.id}`}
                                  defaultValue={cell?.value || ""}
                                  style={cellInput}
                                  placeholder="—"
                                />
                                {col.customerInputEnabled && (
                                  <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                                    <input
                                      name={`min-${row.id}-${col.id}`}
                                      defaultValue={cell?.minValue ?? ""}
                                      style={{ ...cellInput, width: "45%", fontSize: 11, color: "#6d7175" } as React.CSSProperties}
                                      placeholder="min"
                                      type="number"
                                      step="0.1"
                                    />
                                    <input
                                      name={`max-${row.id}-${col.id}`}
                                      defaultValue={cell?.maxValue ?? ""}
                                      style={{ ...cellInput, width: "45%", fontSize: 11, color: "#6d7175" } as React.CSSProperties}
                                      placeholder="max"
                                      type="number"
                                      step="0.1"
                                    />
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
                  <button
                    type="button"
                    onClick={() => {
                      if (!cellsRef.current) return;
                      const fd = new FormData(cellsRef.current);
                      editorFetcher.submit(fd, { method: "post", action: actionUrl });
                    }}
                    style={editorBtnPrimary}
                  >
                    Save table
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

      </div>
    </s-page>
  );
}

// ─── ColumnCard ───────────────────────────────────────────────────────────────

function ColumnCard({ col, submit, busy, onDelete }: any) {
  const [expanded, setExpanded] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#fafafa", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{col.name}</span>
          <span style={typeBadge(col.columnType)}>{col.columnType === "size_label" ? "size label" : "measurement"}</span>
          {col.customerInputEnabled && <span style={typeBadge("input")}>customer input</span>}
          {col.isMatchingKey && <span style={typeBadge("key")}>matching key</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ color: "#6d7175", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ ...deleteDotBtn, position: "static" } as React.CSSProperties}
          >✕</button>
        </div>
      </div>
      {expanded && (
        <form ref={formRef} style={{ padding: "14px 16px", background: "#fff" }}>
          <input type="hidden" name="intent" value="update-column" />
          <input type="hidden" name="columnId" value={col.id} />
          <div style={fieldGrid}>
            <div>
              <label style={labelStyle}>Customer input</label>
              <select name="customerInputEnabled" defaultValue={col.customerInputEnabled ? "true" : "false"} style={editorSelect}>
                <option value="false">No</option>
                <option value="true">Yes — customer can enter this measurement</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Matching key</label>
              <select name="isMatchingKey" defaultValue={col.isMatchingKey ? "true" : "false"} style={editorSelect}>
                <option value="false">No</option>
                <option value="true">Yes — used for size recommendation output</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Measurement type</label>
              <select name="apparelMeasurementType" defaultValue={col.apparelMeasurementType || ""} style={editorSelect}>
                <option value="">— none —</option>
                {MEASUREMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Label shown to customer</label>
              <input name="inputLabel" defaultValue={col.inputLabel || ""} style={editorInput} placeholder="e.g. Bust/Chest (cm)" />
            </div>
          </div>
          <button
            type="button"
            onClick={() => formRef.current && submit(new FormData(formRef.current))}
            style={{ ...editorBtnSecondary, marginTop: 12 }}
          >
            Save column
          </button>
        </form>
      )}
    </div>
  );
}

// ─── AddColumnForm ────────────────────────────────────────────────────────────

function AddColumnForm({ submit, busy }: any) {
  const [type, setType] = React.useState("size_label");
  const formRef = React.useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(formRef.current!);
    submit(fd);
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
            <input name="columnName" required style={editorInput} placeholder="e.g. SIZE, EU, Bust (cm)…" />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select name="columnType" value={type} onChange={(e) => setType(e.target.value)} style={editorSelect}>
              <option value="size_label">Size label (XS, S, M…)</option>
              <option value="measurement">Measurement (number)</option>
            </select>
          </div>
          {type === "measurement" && (
            <>
              <div>
                <label style={labelStyle}>Customer input</label>
                <select name="customerInputEnabled" style={editorSelect}>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Matching key</label>
                <select name="isMatchingKey" style={editorSelect}>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Measurement type</label>
                <select name="apparelMeasurementType" style={editorSelect}>
                  <option value="">— none —</option>
                  {MEASUREMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Label shown to customer</label>
                <input name="inputLabel" style={editorInput} placeholder="e.g. Bust/Chest (cm)" />
              </div>
            </>
          )}
          {type === "size_label" && (
            <input type="hidden" name="customerInputEnabled" value="false" />
          )}
        </div>
        <button type="submit" style={{ ...editorBtnSecondary, marginTop: 14 }}>Add column</button>
      </form>
    </div>
  );
}

// ─── Styles (list) ────────────────────────────────────────────────────────────

const btnPrimaryStyle: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnSecondaryStyle: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const btnDangerStyle: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };

// ─── Styles (editor) ─────────────────────────────────────────────────────────

const editorCard: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: 12, padding: "24px", marginBottom: 20 };
const sectionHeading: React.CSSProperties = { fontSize: 16, fontWeight: 600, margin: "0 0 16px" };
const fieldGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };
const fieldFull: React.CSSProperties = { gridColumn: "1 / -1" };
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 5, fontWeight: 500, fontSize: 13 };
const hintStyle: React.CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "#6d7175" };
const editorInput: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const editorSelect: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 14, background: "#fff", boxSizing: "border-box" };
const cellInput: React.CSSProperties = { width: "100%", padding: "5px 7px", border: "1px solid #e1e3e5", borderRadius: 4, fontSize: 13, boxSizing: "border-box", background: "transparent" };
const thStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid #e1e3e5", background: "#f6f6f7", textAlign: "left", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "4px 6px", border: "1px solid #e1e3e5", verticalAlign: "top" };
const editorBtnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const editorBtnSecondary: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" };
const deleteDotBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "#d72c0d", fontSize: 13, padding: "2px 4px" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
