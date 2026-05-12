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

// ─── Action ──────────────────────────────────────────────────────────────────

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

// ─── ChartsPage (list) ───────────────────────────────────────────────────────

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
        <button onClick={() => setEditingId("new")} style={btnPrimary}>+ Create chart</button>
      </div>
      <s-section>
        {charts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <p style={{ color: "#6d7175", marginBottom: 16 }}>No size charts yet.</p>
            <button onClick={() => setEditingId("new")} style={btnPrimary}>Create your first chart</button>
          </div>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: 12, overflow: "hidden" }}>
            {charts.map((chart, i) => (
              <div
                key={chart.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 20px",
                  borderBottom: i < charts.length - 1 ? "1px solid #e1e3e5" : "none",
                  background: "#fff",
                }}
              >
                <div>
                  <strong style={{ fontSize: 15 }}>{chart.title}</strong>
                  <span style={{ marginLeft: 10, padding: "2px 8px", borderRadius: 10, fontSize: 12, background: chart.isActive ? "#d4edda" : "#f8d7da", color: chart.isActive ? "#155724" : "#721c24" }}>
                    {chart.isActive ? "Active" : "Inactive"}
                  </span>
                  <span style={{ marginLeft: 10, color: "#6d7175", fontSize: 13 }}>
                    {chart._count.productMappings} product{chart._count.productMappings !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setEditingId(chart.id)} style={btnSecondary}>Edit</button>
                  <button onClick={() => handleToggle(chart.id)} style={btnSecondary}>
                    {chart.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(chart.id, chart.title)} style={btnDanger}>Delete</button>
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

  // Load chart data on mount
  React.useEffect(() => {
    dataFetcher.load(actionUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After each action completes, reload data (or switch to the new chart ID)
  const prevEditorState = React.useRef<string>("idle");
  React.useEffect(() => {
    const prev = prevEditorState.current;
    const curr = editorFetcher.state;
    prevEditorState.current = curr;
    if (prev !== "idle" && curr === "idle" && editorFetcher.data) {
      if (editorFetcher.data.newChartId) {
        const newId = editorFetcher.data.newChartId as string;
        onEditingIdChange(newId);
        dataFetcher.load(`/app/charts/${newId}`);
      } else {
        dataFetcher.load(actionUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorFetcher.state]);

  function editorSubmit(data: FormData | Record<string, string>) {
    editorFetcher.submit(data, { method: "post", action: actionUrl });
  }
  function del(intent: string, extra: Record<string, string>) {
    if (!confirm("Are you sure?")) return;
    editorSubmit({ intent, ...extra });
  }
  const childSubmit = (data: FormData | Record<string, string>) => {
    editorFetcher.submit(data, { method: "post", action: actionUrl });
  };

  const hasMeasurementCols = chart?.columns?.some(
    (c: any) => c.columnType === "measurement" && (c.isMatchingKey || c.customerInputEnabled)
  );

  if (dataFetcher.state === "loading" && !dataFetcher.data) {
    return (
      <s-page heading="Loading…">
        <s-section><p style={{ color: "#6d7175" }}>Loading…</p></s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={isNew ? "New size chart" : (chart?.title || "Edit chart")}>
      <div slot="breadcrumbs">
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#6d7175", fontSize: 13, padding: 0 }}>
          Size Charts
        </button>
      </div>

      {/* Two-column layout: builder left, preview right */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "24px", alignItems: "start", padding: "0 0 32px" }}>

        {/* ── LEFT: Builder ── */}
        <div>

          {/* Feedback banners */}
          {editorFetcher.data && "error" in editorFetcher.data && (
            <div style={banner("error")}>{editorFetcher.data.error}</div>
          )}
          {editorFetcher.data && "success" in editorFetcher.data && (
            <div style={banner("success")}>{editorFetcher.data.success}</div>
          )}

          {/* ① Chart details */}
          <div style={card}>
            <h3 style={cardHeading}>① Chart details</h3>
            <form ref={detailsRef}>
              <input type="hidden" name="intent" value="save-details" />
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={lbl}>Title *</label>
                  <input name="title" defaultValue={chart?.title || ""} required style={inp} placeholder="e.g. Women's Knitwear, Men's Shoes…" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={lbl}>Chart type</label>
                    <select name="chartType" defaultValue={chart?.chartType || "simple"} style={sel}>
                      {CHART_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Default unit</label>
                    <select name="defaultUnit" defaultValue={chart?.defaultUnit || "cm"} style={sel}>
                      <option value="cm">Centimeters (cm)</option>
                      <option value="inch">Inches (in)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={lbl}>Description <span style={{ color: "#6d7175", fontWeight: 400 }}>(shown below title)</span></label>
                  <input name="description" defaultValue={chart?.description || ""} style={inp} placeholder="e.g. Size guide for knitwear" />
                </div>
                <div>
                  <label style={lbl}>Measurement instructions <span style={{ color: "#6d7175", fontWeight: 400 }}>(HTML, shown below table)</span></label>
                  <textarea name="instructionsHtml" defaultValue={chart?.instructionsHtml || ""} rows={3}
                    style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 12 } as React.CSSProperties}
                    placeholder="<p><strong>Bust:</strong> Measure around the fullest point…</p>" />
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <button type="button" disabled={busy} style={btnPrimary}
                  onClick={() => {
                    if (!detailsRef.current) return;
                    const fd = new FormData(detailsRef.current);
                    fd.set("returnJson", "true");
                    editorFetcher.submit(fd, { method: "post", action: actionUrl });
                  }}>
                  {isNew ? "Create chart →" : "Save details"}
                </button>
                {isNew && <p style={{ marginTop: 8, fontSize: 12, color: "#6d7175" }}>After creating, you can add columns and rows.</p>}
              </div>
            </form>
          </div>

          {/* ② Columns */}
          {!isNew && (
            <div style={card}>
              <h3 style={cardHeading}>② Columns</h3>
              <p style={hint}>One column per data type — e.g. SIZE, EU, UK, Bust (cm). Enable <strong>Customer input</strong> on measurement columns to let customers find their size.</p>

              {chart.columns.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {chart.columns.map((col: any) => (
                    <ColumnCard key={col.id} col={col} submit={childSubmit} busy={busy}
                      onDelete={() => del("delete-column", { columnId: col.id })} />
                  ))}
                </div>
              )}
              <AddColumnForm submit={childSubmit} busy={busy} />
            </div>
          )}

          {/* ③ Size table */}
          {!isNew && chart.columns.length > 0 && (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <h3 style={{ ...cardHeading, margin: 0 }}>③ Size table</h3>
                <button type="button" onClick={() => editorSubmit({ intent: "add-row" })} style={btnSecondary} disabled={busy}>
                  + Add row
                </button>
              </div>
              <p style={{ ...hint, marginBottom: 14 }}>Fill in the values for each size. For measurement columns with customer input, also set the min/max range used for size recommendations.</p>

              {chart.rows.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px 0", color: "#6d7175", fontSize: 13 }}>
                  No rows yet — click "+ Add row" to start.
                </div>
              ) : (
                <form ref={cellsRef}>
                  <input type="hidden" name="intent" value="save-cells" />
                  <div style={{ overflowX: "auto", marginBottom: 14 }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={th}></th>
                          {chart.columns.map((col: any) => (
                            <th key={col.id} style={th}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <span>{col.name}</span>
                                {col.customerInputEnabled && <span style={{ fontSize: 10, color: "#8c6af6", fontWeight: 400 }}>+ min/max</span>}
                              </div>
                            </th>
                          ))}
                        </tr>
                        {hasMeasurementCols && (
                          <tr style={{ background: "#faf9fb" }}>
                            <th style={{ ...th, fontSize: 10, color: "#6d7175" }}></th>
                            {chart.columns.map((col: any) => (
                              <th key={col.id} style={{ ...th, fontWeight: 400, fontSize: 10, color: "#6d7175" }}>
                                {col.customerInputEnabled ? "value / min / max" : "value"}
                              </th>
                            ))}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {chart.rows.map((row: any) => (
                          <tr key={row.id}>
                            <td style={{ ...td, width: 28 }}>
                              <button type="button" onClick={() => del("delete-row", { rowId: row.id })}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#d72c0d", fontSize: 13, padding: "2px 4px" }}
                                title="Delete row">✕</button>
                            </td>
                            {chart.columns.map((col: any) => {
                              const cell = row.cells.find((c: any) => c.columnId === col.id);
                              return (
                                <td key={col.id} style={td}>
                                  <input name={`val-${row.id}-${col.id}`} defaultValue={cell?.value || ""}
                                    style={cellInp} placeholder="—" />
                                  {col.customerInputEnabled && (
                                    <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                                      <input name={`min-${row.id}-${col.id}`} defaultValue={cell?.minValue ?? ""}
                                        style={{ ...cellInp, fontSize: 11, color: "#6d7175" } as React.CSSProperties}
                                        placeholder="min" type="number" step="0.1" />
                                      <input name={`max-${row.id}-${col.id}`} defaultValue={cell?.maxValue ?? ""}
                                        style={{ ...cellInp, fontSize: 11, color: "#6d7175" } as React.CSSProperties}
                                        placeholder="max" type="number" step="0.1" />
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
                  <button type="button" style={btnPrimary}
                    onClick={() => {
                      if (!cellsRef.current) return;
                      editorFetcher.submit(new FormData(cellsRef.current), { method: "post", action: actionUrl });
                    }}>
                    Save table
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Live preview ── */}
        <div style={{ position: "sticky", top: "24px" }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#6d7175", letterSpacing: "0.08em", margin: "0 0 8px", textTransform: "uppercase" }}>
            Customer preview
          </p>
          <ChartPreview chart={chart} />
        </div>

      </div>
    </s-page>
  );
}

// ─── ChartPreview ─────────────────────────────────────────────────────────────
// Mimics the customer-facing size chart popup so the merchant can see exactly
// what their customers will see as they build the chart.

function ChartPreview({ chart }: { chart: any }) {
  const [unit, setUnit] = React.useState("cm");
  const [vals, setVals] = React.useState<Record<string, string>>({});

  const inputCols: any[] = chart?.columns?.filter((c: any) => c.customerInputEnabled) || [];
  const hasInputs = inputCols.length > 0;

  // Find the matching size row based on entered measurements
  const matchedRowId = React.useMemo(() => {
    if (!hasInputs || !chart?.rows?.length) return null;
    for (const row of chart.rows) {
      const allMatch = inputCols.every((col: any) => {
        const measurement = parseFloat(vals[col.id]);
        if (isNaN(measurement)) return false;
        const cell = row.cells?.find((c: any) => c.columnId === col.id);
        if (!cell) return false;
        const min = cell.minValue;
        const max = cell.maxValue;
        if (min == null || max == null) return false;
        return measurement >= min && measurement <= max;
      });
      if (allMatch) return row.id;
    }
    return null;
  }, [vals, chart, inputCols]);

  const hasContent = chart?.title || chart?.columns?.length;

  return (
    <div style={{ border: "1px solid #d0d0d0", borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.10)", background: "#f6f6f7", fontSize: 13 }}>

      {/* Modal header */}
      <div style={{ background: "#fff", padding: "18px 20px 14px", borderBottom: "1px solid #e1e3e5" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 3px", color: "#1a1a1a", lineHeight: 1.2 }}>
              {chart?.title || <span style={{ color: "#c9cccf" }}>Chart title</span>}
            </h2>
            {chart?.description && (
              <p style={{ margin: 0, fontSize: 12, color: "#6d7175", lineHeight: 1.4 }}>{chart.description}</p>
            )}
          </div>
          {/* CM / IN toggle */}
          <div style={{ display: "flex", border: "1.5px solid #1a1a1a", borderRadius: 5, overflow: "hidden", flexShrink: 0 }}>
            {["cm", "in"].map(u => (
              <button key={u} onClick={() => setUnit(u)}
                style={{ padding: "5px 11px", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", letterSpacing: "0.05em", background: unit === u ? "#1a1a1a" : "#fff", color: unit === u ? "#fff" : "#1a1a1a", transition: "all 0.15s" }}>
                {u.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, maxHeight: 520, overflowY: "auto" }}>

        {!hasContent ? (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📐</div>
            <p style={{ color: "#c9cccf", fontSize: 13 }}>Fill in the chart details to see your preview here</p>
          </div>
        ) : (
          <>
            {/* Measurement input section */}
            {hasInputs && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "13px 15px" }}>
                <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 15 }}>📏</span> Enter your measurements
                </p>
                <p style={{ margin: "0 0 11px", fontSize: 11, color: "#6d7175" }}>
                  Enter your measurements below to find your perfect size.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                  {inputCols.map((col: any) => (
                    <div key={col.id}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3, color: "#3d3d3d" }}>
                        {col.inputLabel || col.name}{" "}
                        <span style={{ fontWeight: 400, color: "#6d7175" }}>({unit})</span>
                      </label>
                      <input
                        type="number"
                        placeholder={unit === "cm" ? "e.g., 92" : "e.g., 36"}
                        value={vals[col.id] || ""}
                        onChange={(e) => setVals(v => ({ ...v, [col.id]: e.target.value }))}
                        style={{ width: "100%", padding: "6px 9px", border: "1px solid #c9cccf", borderRadius: 5, fontSize: 12, boxSizing: "border-box" } as React.CSSProperties}
                      />
                    </div>
                  ))}
                </div>
                {matchedRowId && (
                  <div style={{ marginTop: 10, padding: "7px 10px", background: "#e8f4ff", borderRadius: 6, fontSize: 12, color: "#1a5fa8", fontWeight: 500 }}>
                    ✓ Your recommended size is highlighted in the table below
                  </div>
                )}
              </div>
            )}

            {/* Size table */}
            {chart?.columns?.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#1a1a1a" }}>
                        {chart.columns.map((col: any) => (
                          <th key={col.id} style={{ padding: "9px 11px", color: "#fff", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap", fontSize: 10, letterSpacing: "0.07em" }}>
                            {col.name.toUpperCase()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {!chart?.rows?.length ? (
                        <tr>
                          <td colSpan={chart.columns.length} style={{ padding: "14px 12px", color: "#c9cccf", textAlign: "center", fontSize: 12 }}>
                            No rows yet
                          </td>
                        </tr>
                      ) : chart.rows.map((row: any, ri: number) => {
                        const isMatch = row.id === matchedRowId;
                        return (
                          <tr key={row.id} style={{ background: isMatch ? "#dbeeff" : ri % 2 === 0 ? "#fff" : "#fafafa" }}>
                            {chart.columns.map((col: any, ci: number) => {
                              const cell = row.cells?.find((c: any) => c.columnId === col.id);
                              const val = cell?.value || "—";
                              return (
                                <td key={col.id} style={{
                                  padding: "9px 11px",
                                  borderBottom: "1px solid #f0f0f0",
                                  fontWeight: ci === 0 ? 600 : 400,
                                  color: isMatch && ci === 0 ? "#1a5fa8" : "#1a1a1a",
                                }}>
                                  {val}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Instructions */}
            {chart?.instructionsHtml && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "13px 15px" }}>
                <div
                  style={{ fontSize: 12, color: "#3d3d3d", lineHeight: 1.65 }}
                  dangerouslySetInnerHTML={{ __html: chart.instructionsHtml }}
                />
              </div>
            )}

            {/* Empty state hint */}
            {!chart?.columns?.length && (
              <p style={{ color: "#c9cccf", fontSize: 12, textAlign: "center", padding: "8px 0" }}>
                Add columns to see the size table
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── ColumnCard ───────────────────────────────────────────────────────────────

function ColumnCard({ col, submit, busy, onDelete }: any) {
  const [expanded, setExpanded] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const badgeColor = col.columnType === "size_label"
    ? { bg: "#e3f1e3", color: "#2d6a2d" }
    : { bg: "#e8f0ff", color: "#1a4a9c" };

  return (
    <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, marginBottom: 6, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#fafafa", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{col.name}</span>
          <span style={{ padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500, background: badgeColor.bg, color: badgeColor.color }}>
            {col.columnType === "size_label" ? "size label" : "measurement"}
          </span>
          {col.customerInputEnabled && <span style={{ padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500, background: "#f3edff", color: "#5c21ba" }}>customer input</span>}
          {col.isMatchingKey && <span style={{ padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500, background: "#fff3cd", color: "#856404" }}>matching key</span>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "#6d7175", fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>
          <button type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#d72c0d", fontSize: 13, padding: "2px 5px" }}>✕</button>
        </div>
      </div>
      {expanded && (
        <form ref={formRef} style={{ padding: "14px 16px", background: "#fff" }}>
          <input type="hidden" name="intent" value="update-column" />
          <input type="hidden" name="columnId" value={col.id} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>Customer input</label>
              <select name="customerInputEnabled" defaultValue={col.customerInputEnabled ? "true" : "false"} style={sel}>
                <option value="false">No</option>
                <option value="true">Yes — customer enters this measurement</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Matching key (size recommendation output)</label>
              <select name="isMatchingKey" defaultValue={col.isMatchingKey ? "true" : "false"} style={sel}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Measurement type</label>
              <select name="apparelMeasurementType" defaultValue={col.apparelMeasurementType || ""} style={sel}>
                <option value="">— none —</option>
                {MEASUREMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Label shown to customer</label>
              <input name="inputLabel" defaultValue={col.inputLabel || ""} style={inp} placeholder="e.g. Bust/Chest (cm)" />
            </div>
          </div>
          <button type="button" style={{ ...btnSecondary, marginTop: 12 }}
            onClick={() => formRef.current && submit(new FormData(formRef.current))}>
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
    <div style={{ border: "2px dashed #e1e3e5", borderRadius: 8, padding: "14px 16px" }}>
      <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: 13, color: "#3d3d3d" }}>+ Add column</p>
      <form ref={formRef} onSubmit={handleSubmit}>
        <input type="hidden" name="intent" value="add-column" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={lbl}>Column name *</label>
            <input name="columnName" required style={inp} placeholder="e.g. SIZE, EU, Bust (cm)…" />
          </div>
          <div>
            <label style={lbl}>Type</label>
            <select name="columnType" value={type} onChange={e => setType(e.target.value)} style={sel}>
              <option value="size_label">Size label (XS, S, M…)</option>
              <option value="measurement">Measurement (number)</option>
            </select>
          </div>
          {type === "measurement" && (
            <>
              <div>
                <label style={lbl}>Customer input</label>
                <select name="customerInputEnabled" style={sel}>
                  <option value="false">No</option>
                  <option value="true">Yes — customer can enter this</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Matching key</label>
                <select name="isMatchingKey" style={sel}>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Measurement type</label>
                <select name="apparelMeasurementType" style={sel}>
                  <option value="">— none —</option>
                  {MEASUREMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Label shown to customer</label>
                <input name="inputLabel" style={inp} placeholder="e.g. Bust/Chest (cm)" />
              </div>
            </>
          )}
          {type === "size_label" && <input type="hidden" name="customerInputEnabled" value="false" />}
        </div>
        <button type="submit" style={{ ...btnSecondary, marginTop: 12 }}>Add column</button>
      </form>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const btnDanger: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: 12, padding: "20px 22px", marginBottom: 16 };
const cardHeading: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: "0 0 14px", color: "#1a1a1a" };
const lbl: React.CSSProperties = { display: "block", marginBottom: 4, fontWeight: 500, fontSize: 12, color: "#3d3d3d" };
const hint: React.CSSProperties = { margin: "0 0 12px", fontSize: 12, color: "#6d7175", lineHeight: 1.5 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, boxSizing: "border-box" };
const sel: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, background: "#fff", boxSizing: "border-box" };
const cellInp: React.CSSProperties = { width: "100%", padding: "5px 7px", border: "1px solid #e1e3e5", borderRadius: 4, fontSize: 12, boxSizing: "border-box", background: "transparent" };
const th: React.CSSProperties = { padding: "8px 10px", border: "1px solid #e1e3e5", background: "#f6f6f7", textAlign: "left", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "4px 6px", border: "1px solid #e1e3e5", verticalAlign: "top" };

function banner(type: "error" | "success"): React.CSSProperties {
  return {
    padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13,
    background: type === "error" ? "#fff4f4" : "#f1faf1",
    color: type === "error" ? "#d72c0d" : "#1a6b1a",
    border: `1px solid ${type === "error" ? "#f9c0b9" : "#a8d5a8"}`,
  };
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
