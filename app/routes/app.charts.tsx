import React from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const CHART_TYPES = [
  { value: "simple", label: "Simple table" },
  { value: "apparel", label: "Apparel (size recommendation)" },
  { value: "footwear", label: "Footwear (size recommendation)" },
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
    select: { id: true, title: true, isActive: true, createdAt: true, _count: { select: { productMappings: true } } },
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
    if (current) await prisma.sizeChart.update({ where: { id }, data: { isActive: !current.isActive } });
  }
  return null;
};

// ─── ChartsPage ───────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const { charts } = useLoaderData<typeof loader>();
  const mutFetcher = useFetcher();
  const [editingId, setEditingId] = React.useState<null | "new" | string>(null);

  if (editingId !== null) {
    return <InlineChartEditor editingId={editingId} onEditingIdChange={setEditingId} onBack={() => setEditingId(null)} />;
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
              <div key={chart.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: i < charts.length - 1 ? "1px solid #e1e3e5" : "none", background: "#fff" }}>
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
                  <button onClick={() => mutFetcher.submit({ intent: "toggle", id: chart.id }, { method: "post" })} style={btnSecondary}>
                    {chart.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => { if (confirm(`Delete "${chart.title}"?`)) mutFetcher.submit({ intent: "delete", id: chart.id }, { method: "post" }); }} style={btnDanger}>
                    Delete
                  </button>
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

function InlineChartEditor({ editingId, onEditingIdChange, onBack }: { editingId: "new" | string; onEditingIdChange: (id: string) => void; onBack: () => void }) {
  const dataFetcher = useFetcher<{ chart: any }>();
  const editorFetcher = useFetcher<any>();

  const actionUrl = editingId === "new" ? "/app/charts/new" : `/app/charts/${editingId}`;
  const chart = dataFetcher.data?.chart ?? null;
  const isNew = !chart;
  const busy = editorFetcher.state !== "idle";

  const detailsRef = React.useRef<HTMLFormElement>(null);
  const [showInstructions, setShowInstructions] = React.useState(false);

  React.useEffect(() => { dataFetcher.load(actionUrl); }, []); // eslint-disable-line

  const prevState = React.useRef("idle");
  React.useEffect(() => {
    const prev = prevState.current;
    prevState.current = editorFetcher.state;
    if (prev !== "idle" && editorFetcher.state === "idle" && editorFetcher.data) {
      if (editorFetcher.data.newChartId) {
        const newId = editorFetcher.data.newChartId as string;
        onEditingIdChange(newId);
        dataFetcher.load(`/app/charts/${newId}`);
      } else {
        dataFetcher.load(actionUrl);
      }
    }
  }, [editorFetcher.state]); // eslint-disable-line

  const sub = (data: FormData | Record<string, string>) => editorFetcher.submit(data, { method: "post", action: actionUrl });

  const saveDetails = () => {
    if (!detailsRef.current) return;
    const fd = new FormData(detailsRef.current);
    fd.set("returnJson", "true");
    editorFetcher.submit(fd, { method: "post", action: actionUrl });
  };

  if (dataFetcher.state === "loading" && !dataFetcher.data) {
    return <s-page heading="Loading…"><s-section><p style={{ color: "#6d7175" }}>Loading…</p></s-section></s-page>;
  }

  return (
    <s-page heading={isNew ? "New size chart" : (chart?.title || "Edit chart")}>
      <div slot="breadcrumbs">
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#6d7175", fontSize: 13, padding: 0 }}>Size Charts</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "20px", alignItems: "start", paddingBottom: 40 }}>

        {/* ── LEFT: Builder ── */}
        <div>

          {/* Banners */}
          {editorFetcher.data && "error" in editorFetcher.data && <div style={bannerStyle("error")}>{editorFetcher.data.error}</div>}
          {editorFetcher.data && "success" in editorFetcher.data && <div style={bannerStyle("success")}>{editorFetcher.data.success}</div>}

          {/* Details card */}
          <div style={card}>
            <form ref={detailsRef}>
              <input type="hidden" name="intent" value="save-details" />
              {/* Row 1: title + type + unit + save */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 3, minWidth: 180 }}>
                  <label style={lbl}>Chart title *</label>
                  <input name="title" defaultValue={chart?.title || ""} required style={inp} placeholder="e.g. Women's Knitwear" />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={lbl}>Type</label>
                  <select name="chartType" defaultValue={chart?.chartType || "simple"} style={sel}>
                    {CHART_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div style={{ minWidth: 80 }}>
                  <label style={lbl}>Unit</label>
                  <select name="defaultUnit" defaultValue={chart?.defaultUnit || "cm"} style={sel}>
                    <option value="cm">cm</option>
                    <option value="inch">inch</option>
                  </select>
                </div>
                <button type="button" disabled={busy} onClick={saveDetails} style={btnPrimary}>
                  {isNew ? "Create →" : "Save"}
                </button>
              </div>

              {/* Row 2: description */}
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>Description <span style={{ fontWeight: 400, color: "#6d7175" }}>(shown above the table)</span></label>
                <input name="description" defaultValue={chart?.description || ""} style={inp} placeholder="e.g. Size guide for knitwear" />
              </div>

              {/* Collapsible: instructions */}
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => setShowInstructions(s => !s)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#6d7175", fontSize: 12, padding: 0 }}>
                  {showInstructions ? "▲" : "▼"} Measurement instructions (HTML)
                </button>
                {showInstructions && (
                  <textarea name="instructionsHtml" defaultValue={chart?.instructionsHtml || ""} rows={4}
                    style={{ ...inp, marginTop: 6, resize: "vertical", fontFamily: "monospace", fontSize: 12, display: "block" } as React.CSSProperties}
                    placeholder="<p><strong>Bust:</strong> Measure around the fullest point…</p>" />
                )}
                {!showInstructions && <input type="hidden" name="instructionsHtml" value={chart?.instructionsHtml || ""} />}
              </div>
            </form>

            {isNew && <p style={{ marginTop: 8, fontSize: 12, color: "#6d7175" }}>Save the title first, then you can build the table.</p>}
          </div>

          {/* Spreadsheet table */}
          {!isNew && (
            <div style={{ ...card, padding: "12px 14px" }}>
              <SizeTable chart={chart} actionUrl={actionUrl} editorFetcher={editorFetcher} />
            </div>
          )}
        </div>

        {/* ── RIGHT: Preview ── */}
        <div style={{ position: "sticky", top: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6d7175", letterSpacing: "0.08em", margin: "0 0 8px", textTransform: "uppercase" }}>Customer preview</p>
          <ChartPreview chart={chart} />
        </div>

      </div>
    </s-page>
  );
}

// ─── SizeTable ────────────────────────────────────────────────────────────────
// Spreadsheet-style editor. Click column name to rename. Toggle "Matching" to
// enable customer measurement input. All cell edits save with one button.

function SizeTable({ chart, actionUrl, editorFetcher }: { chart: any; actionUrl: string; editorFetcher: any }) {
  const [editColId, setEditColId] = React.useState<string | null>(null);
  const [editColName, setEditColName] = React.useState("");
  const [showAddCol, setShowAddCol] = React.useState(false);
  const [newColName, setNewColName] = React.useState("");
  const [newColMatching, setNewColMatching] = React.useState(false);
  const tableFormRef = React.useRef<HTMLFormElement>(null);

  const sub = (data: FormData | Record<string, string>) => editorFetcher.submit(data, { method: "post", action: actionUrl });

  const saveColName = (col: any) => {
    const name = editColName.trim();
    if (name && name !== col.name) {
      sub({ intent: "update-column", columnId: col.id, name, customerInputEnabled: String(col.customerInputEnabled), isMatchingKey: String(col.isMatchingKey), inputLabel: col.inputLabel || "", apparelMeasurementType: col.apparelMeasurementType || "" });
    }
    setEditColId(null);
  };

  const toggleMatching = (col: any) => {
    sub({ intent: "update-column", columnId: col.id, name: col.name, customerInputEnabled: String(!col.customerInputEnabled), isMatchingKey: String(col.isMatchingKey), inputLabel: col.name, apparelMeasurementType: col.apparelMeasurementType || "" });
  };

  const deleteCol = (col: any) => {
    if (confirm(`Remove column "${col.name}" and all its data?`)) sub({ intent: "delete-column", columnId: col.id });
  };

  const deleteRow = (rowId: string) => {
    if (confirm("Remove this row?")) sub({ intent: "delete-row", rowId });
  };

  const addCol = () => {
    if (!newColName.trim()) return;
    sub({ intent: "add-column", columnName: newColName.trim(), columnType: newColMatching ? "measurement" : "size_label", customerInputEnabled: String(newColMatching), isMatchingKey: "false" });
    setNewColName(""); setNewColMatching(false); setShowAddCol(false);
  };

  const saveCells = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableFormRef.current) return;
    const fd = new FormData(tableFormRef.current);
    editorFetcher.submit(fd, { method: "post", action: actionUrl });
  };

  const cols: any[] = chart?.columns || [];
  const rows: any[] = chart?.rows || [];
  const hasMatchingCols = cols.some((c: any) => c.customerInputEnabled);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <form ref={tableFormRef} onSubmit={saveCells}>
          <input type="hidden" name="intent" value="save-cells" />

          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
            <thead>
              <tr>
                {/* Delete-row column */}
                <th style={{ width: 28 }} />

                {/* Column headers */}
                {cols.map((col: any) => (
                  <th key={col.id} style={{
                    border: "1px solid #e1e3e5",
                    padding: "7px 10px",
                    background: col.customerInputEnabled ? "#f5f0ff" : "#f6f6f7",
                    verticalAlign: "top",
                    minWidth: 100,
                    textAlign: "left",
                  }}>
                    {/* Editable name */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
                      {editColId === col.id ? (
                        <input
                          autoFocus
                          value={editColName}
                          onChange={e => setEditColName(e.target.value)}
                          onBlur={() => saveColName(col)}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditColId(null); }}
                          style={{ flex: 1, border: "1px solid #7c3aed", borderRadius: 4, padding: "2px 5px", fontSize: 13, fontWeight: 600, outline: "none" }}
                        />
                      ) : (
                        <span
                          title="Click to rename"
                          onClick={() => { setEditColId(col.id); setEditColName(col.name); }}
                          style={{ flex: 1, fontWeight: 700, fontSize: 13, cursor: "text", userSelect: "none" } as React.CSSProperties}
                        >{col.name}</span>
                      )}
                      <button type="button" title="Remove column" onClick={() => deleteCol(col)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#c9cccf", fontSize: 15, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
                    </div>

                    {/* Matching toggle */}
                    <button type="button" onClick={() => toggleMatching(col)}
                      style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, border: "1.5px solid", cursor: "pointer",
                        background: col.customerInputEnabled ? "#7c3aed" : "transparent",
                        color: col.customerInputEnabled ? "#fff" : "#aaa",
                        borderColor: col.customerInputEnabled ? "#7c3aed" : "#d8d8d8",
                        letterSpacing: "0.02em",
                      }}>
                      {col.customerInputEnabled ? "📏 Matching" : "Label"}
                    </button>
                  </th>
                ))}

                {/* Add column */}
                <th style={{ border: "1px dashed #d0d0d0", padding: "8px 10px", background: "#fafafa", verticalAlign: "top", minWidth: showAddCol ? 160 : 90 }}>
                  {showAddCol ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        autoFocus
                        value={newColName}
                        onChange={e => setNewColName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") addCol(); if (e.key === "Escape") { setShowAddCol(false); setNewColName(""); } }}
                        placeholder="Column name"
                        style={{ border: "1px solid #c9cccf", borderRadius: 4, padding: "4px 7px", fontSize: 12, width: "100%", boxSizing: "border-box" } as React.CSSProperties}
                      />
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer", color: "#444" }}>
                        <input type="checkbox" checked={newColMatching} onChange={e => setNewColMatching(e.target.checked)} />
                        Matching column
                      </label>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button type="button" onClick={addCol}
                          style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Add</button>
                        <button type="button" onClick={() => { setShowAddCol(false); setNewColName(""); }}
                          style={{ background: "none", border: "1px solid #c9cccf", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>✕</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setShowAddCol(true)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#6d7175", fontSize: 13, padding: 0, fontWeight: 500 }}>
                      + Column
                    </button>
                  )}
                </th>
              </tr>

              {/* Sub-header: hint row for matching columns */}
              {hasMatchingCols && (
                <tr>
                  <th style={{ width: 28 }} />
                  {cols.map((col: any) => (
                    <th key={col.id} style={{ border: "1px solid #f0f0f0", padding: "3px 10px", background: col.customerInputEnabled ? "#faf7ff" : "#fafafa", fontWeight: 400, fontSize: 10, color: "#888", textAlign: "left" }}>
                      {col.customerInputEnabled ? "value · min · max" : "value"}
                    </th>
                  ))}
                  <th style={{ border: "1px dashed #e8e8e8", background: "#fafafa" }} />
                </tr>
              )}
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 2} style={{ padding: "24px", textAlign: "center", color: "#aaa", fontSize: 13, border: "1px solid #f0f0f0", borderTop: "none" }}>
                    Click "+ Add row" to add your first size
                  </td>
                </tr>
              ) : rows.map((row: any) => (
                <tr key={row.id}>
                  {/* Delete row */}
                  <td style={{ border: "1px solid #f4f4f4", width: 28, textAlign: "center", background: "#fafafa" }}>
                    <button type="button" onClick={() => deleteRow(row.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 15, padding: "4px", display: "block", width: "100%" }}
                      title="Remove row">×</button>
                  </td>

                  {/* Cells */}
                  {cols.map((col: any) => {
                    const cell = row.cells?.find((c: any) => c.columnId === col.id);
                    return (
                      <td key={col.id} style={{ border: "1px solid #f0f0f0", padding: "5px 6px", background: col.customerInputEnabled ? "#fdfbff" : "#fff", verticalAlign: "top" }}>
                        <input
                          name={`val-${row.id}-${col.id}`}
                          defaultValue={cell?.value || ""}
                          style={{ width: "100%", border: "none", fontSize: 13, padding: "2px 3px", outline: "none", background: "transparent", boxSizing: "border-box", minWidth: 60 } as React.CSSProperties}
                          placeholder="—"
                        />
                        {col.customerInputEnabled && (
                          <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                            <input name={`min-${row.id}-${col.id}`} defaultValue={cell?.minValue ?? ""} type="number" step="0.1" placeholder="min"
                              style={{ width: "50%", border: "1px solid #e0d4ff", borderRadius: 3, fontSize: 10, padding: "2px 4px", color: "#7c3aed", background: "transparent" } as React.CSSProperties} />
                            <input name={`max-${row.id}-${col.id}`} defaultValue={cell?.maxValue ?? ""} type="number" step="0.1" placeholder="max"
                              style={{ width: "50%", border: "1px solid #e0d4ff", borderRadius: 3, fontSize: 10, padding: "2px 4px", color: "#7c3aed", background: "transparent" } as React.CSSProperties} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ border: "1px dashed #e8e8e8", background: "#fafafa" }} />
                </tr>
              ))}

              {/* Footer row */}
              <tr>
                <td colSpan={cols.length + 2} style={{ border: "1px dashed #d8d8d8", padding: "8px 12px", background: "#fafafa" }}>
                  <button type="button" onClick={() => editorFetcher.submit({ intent: "add-row" }, { method: "post", action: actionUrl })}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#6d7175", fontSize: 13, padding: 0, fontWeight: 500 }}>
                    + Add row
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Save button */}
          {rows.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" style={btnPrimary}>Save table</button>
            </div>
          )}
        </form>
      </div>

      {/* Legend */}
      {hasMatchingCols && (
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "#888" }}>
          <span style={{ color: "#7c3aed", fontWeight: 600 }}>📏 Matching columns:</span> enter the display value (e.g. "84–88"), and the min/max range used to match the customer's measurement.
        </p>
      )}
    </div>
  );
}

// ─── ChartPreview ─────────────────────────────────────────────────────────────

function ChartPreview({ chart }: { chart: any }) {
  const [unit, setUnit] = React.useState("cm");
  const [vals, setVals] = React.useState<Record<string, string>>({});

  const inputCols: any[] = chart?.columns?.filter((c: any) => c.customerInputEnabled) || [];
  const hasInputs = inputCols.length > 0;

  const matchedRowId = React.useMemo(() => {
    if (!hasInputs || !chart?.rows?.length) return null;
    for (const row of chart.rows) {
      const allMatch = inputCols.every((col: any) => {
        const measurement = parseFloat(vals[col.id]);
        if (isNaN(measurement)) return false;
        const cell = row.cells?.find((c: any) => c.columnId === col.id);
        if (!cell || cell.minValue == null || cell.maxValue == null) return false;
        return measurement >= cell.minValue && measurement <= cell.maxValue;
      });
      if (allMatch) return row.id;
    }
    return null;
  }, [vals, chart, inputCols]);

  const hasContent = chart?.title || chart?.columns?.length;

  return (
    <div style={{ border: "1px solid #d0d0d0", borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.10)", background: "#f6f6f7", fontSize: 13 }}>

      {/* Header */}
      <div style={{ background: "#fff", padding: "16px 18px 12px", borderBottom: "1px solid #e1e3e5" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 3px", color: "#1a1a1a", lineHeight: 1.2 }}>
              {chart?.title || <span style={{ color: "#ccc" }}>Chart title</span>}
            </h2>
            {chart?.description && <p style={{ margin: 0, fontSize: 12, color: "#6d7175" }}>{chart.description}</p>}
          </div>
          <div style={{ display: "flex", border: "1.5px solid #1a1a1a", borderRadius: 5, overflow: "hidden", flexShrink: 0 }}>
            {["cm", "in"].map(u => (
              <button key={u} type="button" onClick={() => setUnit(u)}
                style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", letterSpacing: "0.05em", background: unit === u ? "#1a1a1a" : "#fff", color: unit === u ? "#fff" : "#1a1a1a" }}>
                {u.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, maxHeight: 500, overflowY: "auto" }}>
        {!hasContent ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📐</div>
            <p style={{ color: "#ccc", fontSize: 13 }}>Fill in the chart details to see your preview</p>
          </div>
        ) : (
          <>
            {/* Measurement inputs */}
            {hasInputs && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "12px 14px" }}>
                <p style={{ margin: "0 0 3px", fontWeight: 600, fontSize: 13 }}>📏 Enter your measurements</p>
                <p style={{ margin: "0 0 10px", fontSize: 11, color: "#6d7175" }}>Enter your measurements to find your perfect size.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {inputCols.map((col: any) => (
                    <div key={col.id}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
                        {col.inputLabel || col.name} <span style={{ fontWeight: 400, color: "#888" }}>({unit})</span>
                      </label>
                      <input type="number" placeholder="e.g. 92" value={vals[col.id] || ""}
                        onChange={e => setVals(v => ({ ...v, [col.id]: e.target.value }))}
                        style={{ width: "100%", padding: "6px 8px", border: "1px solid #c9cccf", borderRadius: 5, fontSize: 12, boxSizing: "border-box" } as React.CSSProperties} />
                    </div>
                  ))}
                </div>
                {matchedRowId && (
                  <div style={{ marginTop: 9, padding: "6px 10px", background: "#e8f4ff", borderRadius: 6, fontSize: 12, color: "#1a5fa8", fontWeight: 500 }}>
                    ✓ Your recommended size is highlighted below
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
                        <tr><td colSpan={chart.columns.length} style={{ padding: "14px", color: "#ccc", textAlign: "center" }}>No rows yet</td></tr>
                      ) : chart.rows.map((row: any, ri: number) => {
                        const isMatch = row.id === matchedRowId;
                        return (
                          <tr key={row.id} style={{ background: isMatch ? "#dbeeff" : ri % 2 === 0 ? "#fff" : "#fafafa" }}>
                            {chart.columns.map((col: any, ci: number) => {
                              const cell = row.cells?.find((c: any) => c.columnId === col.id);
                              return (
                                <td key={col.id} style={{ padding: "9px 11px", borderBottom: "1px solid #f0f0f0", fontWeight: ci === 0 ? 700 : 400, color: isMatch && ci === 0 ? "#1a5fa8" : "#1a1a1a" }}>
                                  {cell?.value || "—"}
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

            {!chart?.columns?.length && (
              <p style={{ color: "#ccc", fontSize: 12, textAlign: "center", padding: "8px 0" }}>Add columns to see the table</p>
            )}

            {/* Instructions */}
            {chart?.instructionsHtml && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 12, color: "#3d3d3d", lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: chart.instructionsHtml }} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const btnDanger: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: 12, padding: "18px 20px", marginBottom: 14 };
const lbl: React.CSSProperties = { display: "block", marginBottom: 4, fontWeight: 500, fontSize: 12, color: "#3d3d3d" };
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, boxSizing: "border-box" };
const sel: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, background: "#fff", boxSizing: "border-box" };

function bannerStyle(type: "error" | "success"): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13, background: type === "error" ? "#fff4f4" : "#f1faf1", color: type === "error" ? "#d72c0d" : "#1a6b1a", border: `1px solid ${type === "error" ? "#f9c0b9" : "#a8d5a8"}` };
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
