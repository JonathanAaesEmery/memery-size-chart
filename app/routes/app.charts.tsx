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

// ─── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startTime = Date.now();
  const { session } = await authenticate.admin(request);

  const queryStart = Date.now();
  const charts = await prisma.sizeChart.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, isActive: true, createdAt: true, _count: { select: { productMappings: true } } },
  });
  const queryTime = Date.now() - queryStart;
  const totalTime = Date.now() - startTime;

  console.log(`[LOADER] Charts list: query=${queryTime}ms, total=${totalTime}ms (${charts.length} charts)`);
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

  if (intent === "duplicate-chart") {
    const id = formData.get("id") as string;
    const original = await prisma.sizeChart.findFirst({
      where: { id, shop: session.shop },
      include: {
        columns: { orderBy: { displayOrder: "asc" } },
        rows: { orderBy: { displayOrder: "asc" }, include: { cells: true } },
        images: { orderBy: { displayOrder: "asc" } },
      },
    });

    if (!original) return { error: "Chart not found" };

    // Create new chart using transaction for atomicity
    const newChart = await prisma.$transaction(async (tx) => {
      // 1. Create new chart
      const duplicated = await tx.sizeChart.create({
        data: {
          shop: session.shop,
          title: `${original.title} - Copy`,
          description: original.description,
          chartType: original.chartType,
          defaultUnit: original.defaultUnit,
          instructionsHtml: original.instructionsHtml,
          imageLayout: original.imageLayout,
          isActive: original.isActive,
        },
      });

      // 2. Create all columns at once with createMany
      const newColumns = original.columns.length > 0
        ? await tx.sizeChartColumn.createMany({
            data: original.columns.map(col => ({
              chartId: duplicated.id,
              name: col.name,
              columnType: col.columnType,
              displayOrder: col.displayOrder,
              isMatchingKey: col.isMatchingKey,
              customerInputEnabled: col.customerInputEnabled,
              apparelMeasurementType: col.apparelMeasurementType,
              inputLabel: col.inputLabel,
            })),
          })
        : { count: 0 };

      // Fetch the created columns to map old IDs to new IDs
      const createdColumns = await tx.sizeChartColumn.findMany({
        where: { chartId: duplicated.id },
        select: { id: true, name: true },
      });
      const columnMap = new Map<string, string>();
      original.columns.forEach((origCol, idx) => {
        if (createdColumns[idx]) {
          columnMap.set(origCol.id, createdColumns[idx].id);
        }
      });

      // 3. Create all rows at once
      const newRows = original.rows.length > 0
        ? await tx.sizeChartRow.createMany({
            data: original.rows.map(row => ({
              chartId: duplicated.id,
              displayOrder: row.displayOrder,
            })),
          })
        : { count: 0 };

      // Fetch the created rows to map old IDs to new IDs
      const createdRows = await tx.sizeChartRow.findMany({
        where: { chartId: duplicated.id },
        select: { id: true, _count: { select: { cells: true } } },
        orderBy: { displayOrder: "asc" },
      });
      const rowMap = new Map<string, string>();
      original.rows.forEach((origRow, idx) => {
        if (createdRows[idx]) {
          rowMap.set(origRow.id, createdRows[idx].id);
        }
      });

      // 4. Create all cells at once
      const allCells: any[] = [];
      original.rows.forEach(row => {
        row.cells.forEach(cell => {
          const newRowId = rowMap.get(row.id);
          const newColId = columnMap.get(cell.columnId);
          if (newRowId && newColId) {
            allCells.push({
              rowId: newRowId,
              columnId: newColId,
              value: cell.value,
              minValue: cell.minValue,
              maxValue: cell.maxValue,
            });
          }
        });
      });
      if (allCells.length > 0) {
        await tx.sizeChartCell.createMany({ data: allCells });
      }

      // 5. Copy images if they exist
      if (original.images.length > 0) {
        await tx.sizeChartImage.createMany({
          data: original.images.map(img => ({
            chartId: duplicated.id,
            url: img.url,
            altText: img.altText,
            displayOrder: img.displayOrder,
          })),
        });
      }

      return duplicated;
    });

    // Return new chart ID to trigger navigation
    return { newChartId: newChart.id };
  }

  return null;
};

// ─── ChartsPage ───────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const { charts } = useLoaderData<typeof loader>();
  const mutFetcher = useFetcher();
  const [editingId, setEditingId] = React.useState<null | "new" | string>(null);

  // Navigate to duplicated chart when duplication completes
  React.useEffect(() => {
    if (mutFetcher.data?.newChartId) {
      setEditingId(mutFetcher.data.newChartId as string);
    }
  }, [mutFetcher.data?.newChartId]); // eslint-disable-line

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
                  <button onClick={() => mutFetcher.submit({ intent: "duplicate-chart", id: chart.id }, { method: "post" })} style={btnSecondary}>Duplicate</button>
                  <button onClick={() => mutFetcher.submit({ intent: "toggle", id: chart.id }, { method: "post" })} style={btnSecondary}>
                    {chart.isActive ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => { if (confirm(`Delete "${chart.title}"?`)) mutFetcher.submit({ intent: "delete", id: chart.id }, { method: "post" }); }} style={btnDanger}>Delete</button>
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
  const [chart, setChart] = React.useState<any>(null);

  const actionUrl = editingId === "new" ? "/app/charts/new" : `/app/charts/${editingId}`;
  const isNew = !chart;
  const busy = editorFetcher.state !== "idle";
  const detailsRef = React.useRef<HTMLFormElement>(null);
  const [showInstructions, setShowInstructions] = React.useState(false);

  React.useEffect(() => { dataFetcher.load(actionUrl); }, []); // eslint-disable-line

  // Sync chart state when dataFetcher loads initial data
  React.useEffect(() => {
    if (dataFetcher.data?.chart) {
      setChart(dataFetcher.data.chart);
    }
  }, [dataFetcher.data?.chart?.id]); // Update when chart ID changes (new chart loaded)

  const prevState = React.useRef("idle");
  React.useEffect(() => {
    const prev = prevState.current;
    prevState.current = editorFetcher.state;
    if (prev !== "idle" && editorFetcher.state === "idle" && editorFetcher.data) {
      if (editorFetcher.data.newChartId) {
        const newId = editorFetcher.data.newChartId as string;
        onEditingIdChange(newId);
        dataFetcher.load(`/app/charts/${newId}`);
      } else if (editorFetcher.data.chart) {
        // Use chart data from action response instead of reloading
        setChart(editorFetcher.data.chart);
      } else {
        dataFetcher.load(actionUrl);
      }
    }
  }, [editorFetcher.state]); // eslint-disable-line

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: "12px", alignItems: "start", paddingBottom: 40, width: "100vw", marginLeft: "calc(-50vw + 50%)", paddingLeft: 16, paddingRight: 16 }}>

        {/* ── LEFT ── */}
        <div>
          {editorFetcher.data && "error" in editorFetcher.data && <div style={bannerStyle("error")}>{editorFetcher.data.error}</div>}
          {editorFetcher.data && "success" in editorFetcher.data && <div style={bannerStyle("success")}>{editorFetcher.data.success}</div>}

          {/* Details */}
          <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
            <form ref={detailsRef}>
              <input type="hidden" name="intent" value="save-details" />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 3, minWidth: 160 }}>
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
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={lbl}>Description <span style={{ fontWeight: 400, color: "#888" }}>(shown above the table)</span></label>
                  <input name="description" defaultValue={chart?.description || ""} style={inp} placeholder="e.g. Size guide for knitwear" />
                </div>
              </div>
              <input type="hidden" name="instructionsHtml" value={chart?.instructionsHtml || ""} />
            </form>
            {isNew && <p style={{ marginTop: 8, fontSize: 12, color: "#888" }}>Save the title first, then you can build your size table.</p>}
          </div>

          {/* Spreadsheet */}
          {!isNew && (
            <SizeTable chart={chart} actionUrl={actionUrl} editorFetcher={editorFetcher} />
          )}

          {/* Images & Instructions */}
          {!isNew && (
            <ImagesSection chart={chart} actionUrl={actionUrl} editorFetcher={editorFetcher} />
          )}
        </div>

        {/* ── RIGHT: Preview ── */}
        <div style={{ position: "sticky", top: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#aaa", letterSpacing: "0.1em", margin: "0 0 6px", textTransform: "uppercase" }}>Customer preview</p>
          <ChartPreview chart={chart} />
        </div>
      </div>
    </s-page>
  );
}

// ─── SizeTable — Excel-like spreadsheet ──────────────────────────────────────

function SizeTable({ chart, actionUrl, editorFetcher }: { chart: any; actionUrl: string; editorFetcher: any }) {
  const [hoveredRow, setHoveredRow] = React.useState<string | null>(null);
  const [editColId, setEditColId] = React.useState<string | null>(null);
  const [editColName, setEditColName] = React.useState("");
  const [showAddCol, setShowAddCol] = React.useState(false);
  const [newColName, setNewColName] = React.useState("");
  const [newColMatching, setNewColMatching] = React.useState(false);
  const tableRef = React.useRef<HTMLTableElement>(null);

  const cols: any[] = chart?.columns || [];
  const rows: any[] = chart?.rows || [];
  const hasMatchingCols = cols.some((c: any) => c.customerInputEnabled);

  const sub = (data: Record<string, string>) => editorFetcher.submit(data, { method: "post", action: actionUrl });

  // ── Column actions ──

  const commitColName = (col: any) => {
    const name = editColName.trim();
    setEditColId(null);
    if (name && name !== col.name) {
      sub({ intent: "update-column", columnId: col.id, name, customerInputEnabled: String(col.customerInputEnabled), isMatchingKey: String(col.isMatchingKey), inputLabel: name, apparelMeasurementType: col.apparelMeasurementType || "" });
    }
  };

  const toggleMatching = (col: any) => {
    sub({ intent: "update-column", columnId: col.id, name: col.name, customerInputEnabled: String(!col.customerInputEnabled), isMatchingKey: String(col.isMatchingKey), inputLabel: col.name, apparelMeasurementType: col.apparelMeasurementType || "" });
  };

  const deleteCol = (col: any) => {
    if (confirm(`Remove column "${col.name}" and all its data?`)) sub({ intent: "delete-column", columnId: col.id });
  };

  const addCol = () => {
    if (!newColName.trim()) return;
    sub({ intent: "add-column", columnName: newColName.trim(), columnType: newColMatching ? "measurement" : "size_label", customerInputEnabled: String(newColMatching), isMatchingKey: "false" });
    setNewColName(""); setNewColMatching(false); setShowAddCol(false);
  };

  // ── Row actions ──

  const addRow = () => sub({ intent: "add-row" });

  const deleteRow = (rowId: string) => {
    if (confirm("Remove this row?")) sub({ intent: "delete-row", rowId });
  };

  // ── Save all cells ──

  const saveCells = () => {
    if (!tableRef.current) return;
    const fd = new FormData();
    fd.set("intent", "save-cells");
    tableRef.current.querySelectorAll<HTMLInputElement>("input[data-c]").forEach(el => {
      fd.set(el.name, el.value);
    });
    editorFetcher.submit(fd, { method: "post", action: actionUrl });
  };

  // ── Cell focus highlight (direct DOM, avoids resetting uncontrolled inputs) ──

  const focusCell = (e: React.FocusEvent<HTMLInputElement>) => {
    const td = e.target.closest("td") as HTMLElement | null;
    if (td) td.style.boxShadow = "inset 0 0 0 2px #1a73e8";
  };
  const blurCell = (e: React.FocusEvent<HTMLInputElement>) => {
    const td = e.target.closest("td") as HTMLElement | null;
    if (td) td.style.boxShadow = "none";
  };

  // ─────────────────────────────────────────────────────────────────────────

  const HEADER_BG = "#f0f0f0";
  const HEADER_MATCH_BG = "#ede8ff";
  const BORDER = "1px solid #c8c8c8";
  const INNER_BORDER = "1px solid #e0e0e0";
  const ROW_NUM_W = 44;

  return (
    <div style={{ border: BORDER, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      <div style={{ overflowX: "auto" }}>
        <table ref={tableRef} style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", tableLayout: "auto" }}>

          {/* ── HEADER ROW ── */}
          <thead>
            <tr>
              {/* Corner */}
              <th style={{ width: ROW_NUM_W, background: HEADER_BG, border: BORDER, borderLeft: "none", borderTop: "none" }} />

              {/* Column headers */}
              {cols.map((col: any) => (
                <th key={col.id} style={{ background: col.customerInputEnabled ? HEADER_MATCH_BG : HEADER_BG, border: BORDER, borderTop: "none", padding: 0, verticalAlign: "top", textAlign: "left", minWidth: col.customerInputEnabled ? 150 : 110 }}>
                  {/* Name row + delete */}
                  <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #d8d8d8" }}>
                    <input
                      value={editColId === col.id ? editColName : col.name}
                      onFocus={() => { setEditColId(col.id); setEditColName(col.name); }}
                      onChange={e => setEditColName(e.target.value)}
                      onBlur={() => commitColName(col)}
                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditColId(null); }}
                      title="Click to rename"
                      style={{ flex: 1, border: "none", background: "transparent", fontWeight: 700, fontSize: 12, padding: "8px 8px", outline: "none", cursor: "text", color: "#1a1a1a", minWidth: 0 }}
                    />
                    <button type="button" onClick={() => deleteCol(col)} title="Remove column"
                      style={{ border: "none", background: "none", cursor: "pointer", color: "#c0c0c0", padding: "5px 9px", fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                  {/* Matching toggle */}
                  <button type="button" onClick={() => toggleMatching(col)} title={col.customerInputEnabled ? "Click to make label column" : "Click to enable size recommendation"}
                    style={{ width: "auto", margin: "0 auto", display: "block", border: `1.5px solid ${col.customerInputEnabled ? "#7c3aed" : "#ddd"}`, background: col.customerInputEnabled ? "#f0ebff" : "#fafafa", cursor: "pointer", padding: "5px 12px", fontSize: 11, fontWeight: 600, color: col.customerInputEnabled ? "#7c3aed" : "#666", borderRadius: 6, transition: "all 0.15s", letterSpacing: "0.02em" }}>
                    {col.customerInputEnabled ? "📏 Matching" : "Label"}
                  </button>
                </th>
              ))}

              {/* Add column */}
              <th style={{ background: "#f8f8f8", border: "1px dashed #c8c8c8", borderTop: "none", borderRight: "none", padding: "8px 12px", verticalAlign: "top", textAlign: "left" }}>
                {showAddCol ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 160 }}>
                    <input
                      autoFocus
                      value={newColName}
                      onChange={e => setNewColName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addCol(); if (e.key === "Escape") { setShowAddCol(false); setNewColName(""); } }}
                      placeholder="Column name"
                      style={{ border: "1px solid #c0c0c0", borderRadius: 4, padding: "5px 8px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" } as React.CSSProperties}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer", color: "#444" }}>
                      <input type="checkbox" checked={newColMatching} onChange={e => setNewColMatching(e.target.checked)} />
                      Matching column (has min/max range)
                    </label>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button type="button" onClick={addCol}
                        style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>Add</button>
                      <button type="button" onClick={() => { setShowAddCol(false); setNewColName(""); }}
                        style={{ background: "none", border: "1px solid #c0c0c0", borderRadius: 4, padding: "5px 9px", fontSize: 12, cursor: "pointer" }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowAddCol(true)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 13, padding: 0, fontWeight: 600, whiteSpace: "nowrap" }}>
                    + Column
                  </button>
                )}
              </th>
            </tr>
          </thead>

          {/* ── BODY ── */}
          <tbody>
            {/* Empty state */}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} style={{ padding: "30px 20px", textAlign: "center", color: "#bbb", border: INNER_BORDER, borderLeft: "none", borderRight: "none", fontSize: 13 }}>
                  {cols.length === 0 ? 'Add a column first (click "+ Column" above), then add rows' : 'Click "+ Add row" below to add your first size'}
                </td>
              </tr>
            )}

            {/* Data rows */}
            {rows.map((row: any, ri: number) => (
              <tr key={row.id}
                onMouseEnter={() => setHoveredRow(row.id)}
                onMouseLeave={() => setHoveredRow(null)}>

                {/* Row number / delete */}
                <td style={{ background: HEADER_BG, border: INNER_BORDER, borderLeft: "none", width: ROW_NUM_W, textAlign: "center", padding: 0, userSelect: "none", verticalAlign: "middle", height: 42, display: "flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties}>
                  {hoveredRow === row.id
                    ? <button type="button" onClick={() => deleteRow(row.id)} title="Remove row"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#d72c0d", fontSize: 18, padding: 0, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", lineHeight: 1 }}>×</button>
                    : <span style={{ fontSize: 11, color: "#999", fontWeight: 600, lineHeight: 1 }}>{ri + 1}</span>}
                </td>

                {/* Cells */}
                {cols.map((col: any) => {
                  const cell = row.cells?.find((c: any) => c.columnId === col.id);
                  return (
                    <td key={col.id} style={{ border: INNER_BORDER, padding: 0, background: col.customerInputEnabled ? "#fdfbff" : "#fff", verticalAlign: "top" }}>
                      <input
                        data-c="1"
                        name={`val-${row.id}-${col.id}`}
                        defaultValue={cell?.value || ""}
                        placeholder="—"
                        onFocus={focusCell}
                        onBlur={blurCell}
                        style={{ width: "100%", border: "none", padding: "8px 10px", fontSize: 13, background: "transparent", outline: "none", boxSizing: "border-box", display: "block" } as React.CSSProperties}
                      />
                      {col.customerInputEnabled && (
                        <div style={{ display: "flex", gap: 4, padding: "0 8px 7px" }}>
                          <input data-c="1" name={`min-${row.id}-${col.id}`} defaultValue={cell?.minValue ?? ""} type="number" step="0.1" placeholder="min"
                            onFocus={focusCell} onBlur={blurCell}
                            style={{ width: "50%", border: "1px solid #ddd8ff", borderRadius: 4, fontSize: 11, padding: "3px 6px", color: "#7c3aed", background: "#faf7ff", outline: "none" } as React.CSSProperties} />
                          <input data-c="1" name={`max-${row.id}-${col.id}`} defaultValue={cell?.maxValue ?? ""} type="number" step="0.1" placeholder="max"
                            onFocus={focusCell} onBlur={blurCell}
                            style={{ width: "50%", border: "1px solid #ddd8ff", borderRadius: 4, fontSize: 11, padding: "3px 6px", color: "#7c3aed", background: "#faf7ff", outline: "none" } as React.CSSProperties} />
                        </div>
                      )}
                    </td>
                  );
                })}

                {/* Spacer under add-column */}
                <td style={{ border: "1px dashed #ebebeb", borderRight: "none", background: "#fafafa" }} />
              </tr>
            ))}

            {/* Add row */}
            <tr>
              <td colSpan={cols.length + 2} style={{ border: "1px solid #ebebeb", borderLeft: "none", borderRight: "none", borderBottom: "none", padding: 0 }}>
                <button type="button" onClick={addRow}
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "9px 14px", fontSize: 13, color: "#888", fontWeight: 500, display: "block" }}>
                  + Add row
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Toolbar */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid #e8e8e8", background: "#fafafa", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        {hasMatchingCols
          ? <span style={{ fontSize: 11, color: "#999" }}><span style={{ color: "#7c3aed" }}>📏</span> Matching columns: display value shown to customer + min/max range for size recommendation</span>
          : <span style={{ fontSize: 11, color: "#bbb" }}>Click a column name to rename · toggle "Label / 📏 Matching" to enable size recommendation</span>}
        {rows.length > 0 && cols.length > 0 && (
          <button type="button" onClick={saveCells} style={{ ...btnPrimary, flexShrink: 0 }}>Save table</button>
        )}
      </div>
    </div>
  );
}

// ─── ChartPreview ─────────────────────────────────────────────────────────────

function ChartPreview({ chart }: { chart: any }) {
  const [unit, setUnit] = React.useState("cm");
  const [vals, setVals] = React.useState<Record<string, string>>({});

  const inputCols: any[] = chart?.columns?.filter((c: any) => c.customerInputEnabled) || [];

  const matchedRowId = React.useMemo(() => {
    if (!inputCols.length || !chart?.rows?.length) return null;
    for (const row of chart.rows) {
      const allMatch = inputCols.every((col: any) => {
        const m = parseFloat(vals[col.id]);
        if (isNaN(m)) return false;
        const cell = row.cells?.find((c: any) => c.columnId === col.id);
        if (!cell || cell.minValue == null || cell.maxValue == null) return false;
        return m >= cell.minValue && m <= cell.maxValue;
      });
      if (allMatch) return row.id;
    }
    return null;
  }, [vals, chart, inputCols]);

  const hasContent = chart?.title || chart?.columns?.length;

  return (
    <div style={{ border: "1px solid #d0d0d0", borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.09)", background: "#f6f6f7", fontSize: 13 }}>
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
                style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: unit === u ? "#1a1a1a" : "#fff", color: unit === u ? "#fff" : "#1a1a1a" }}>
                {u.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, maxHeight: 500, overflowY: "auto" }}>
        {!hasContent ? (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📐</div>
            <p style={{ color: "#ccc", fontSize: 13 }}>Fill in chart details to see a preview</p>
          </div>
        ) : (
          <>
            {inputCols.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 8, padding: "12px 14px" }}>
                <p style={{ margin: "0 0 3px", fontWeight: 600, fontSize: 13 }}>📏 Enter your measurements</p>
                <p style={{ margin: "0 0 10px", fontSize: 11, color: "#6d7175" }}>Find your perfect size.</p>
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
                {matchedRowId && <div style={{ marginTop: 9, padding: "6px 10px", background: "#e8f4ff", borderRadius: 6, fontSize: 12, color: "#1a5fa8", fontWeight: 500 }}>✓ Your recommended size is highlighted below</div>}
              </div>
            )}

            {chart?.columns?.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden" }}>
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
                    {!chart?.rows?.length
                      ? <tr><td colSpan={chart.columns.length} style={{ padding: "14px", color: "#ccc", textAlign: "center" }}>No rows yet</td></tr>
                      : chart.rows.map((row: any, ri: number) => {
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
            )}

            {!chart?.columns?.length && <p style={{ color: "#ccc", fontSize: 12, textAlign: "center" }}>Add columns to see the table</p>}

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

// ─── RichTextEditor ───────────────────────────────────────────────────────────

function RichTextEditor({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = React.useState(false);

  React.useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, []);

  const applyFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const formatBtn = (cmd: string, label: string, shortTitle?: string): React.CSSProperties => ({
    background: "#f0f0f0",
    border: "1px solid #c9cccf",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    color: "#1a1a1a",
    transition: "background 0.2s",
    minWidth: 32,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => applyFormat("bold")}
          title="Bold (Ctrl+B)"
          style={formatBtn("bold", "B")}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          onClick={() => applyFormat("italic")}
          title="Italic (Ctrl+I)"
          style={formatBtn("italic", "I")}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          onClick={() => applyFormat("underline")}
          title="Underline (Ctrl+U)"
          style={formatBtn("underline", "U")}
        >
          <u>U</u>
        </button>
        <div style={{ width: 1, background: "#e0e0e0", margin: "0 4px" }} />
        <button
          type="button"
          onClick={() => applyFormat("insertUnorderedList")}
          title="Bullet list"
          style={formatBtn("insertUnorderedList", "•")}
        >
          •
        </button>
        <button
          type="button"
          onClick={() => applyFormat("insertOrderedList")}
          title="Numbered list"
          style={formatBtn("insertOrderedList", "1.")}
        >
          1.
        </button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          border: isFocused ? "2px solid #1a73e8" : "1px solid #c9cccf",
          borderRadius: 6,
          padding: "10px 12px",
          minHeight: 120,
          fontSize: 13,
          lineHeight: 1.5,
          color: "#1a1a1a",
          background: "#fff",
          outline: "none",
          transition: "border-color 0.2s",
        }}
      />
    </div>
  );
}

// ─── ImagesSection ────────────────────────────────────────────────────────────

function ImagesSection({ chart, actionUrl, editorFetcher }: { chart: any; actionUrl: string; editorFetcher: any }) {
  const [altText, setAltText] = React.useState("");
  const [showAddImage, setShowAddImage] = React.useState(false);
  const [showInstructions, setShowInstructions] = React.useState(false);
  const [instructionsText, setInstructionsText] = React.useState(chart?.instructionsHtml || "");
  const [savedInstructions, setSavedInstructions] = React.useState(chart?.instructionsHtml || "");
  const [uploadError, setUploadError] = React.useState("");
  const [isUploading, setIsUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const images: any[] = chart?.images || [];

  const sub = (data: FormData | Record<string, string>) => {
    editorFetcher.submit(data, { method: "post", action: actionUrl });
  };

  // Hide form when image is successfully added
  React.useEffect(() => {
    if (isUploading && editorFetcher.state === "idle") {
      setIsUploading(false);
      if (editorFetcher.data?.success?.includes("Image added")) {
        setShowAddImage(false);
      }
    }
  }, [editorFetcher.state, isUploading]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setIsUploading(true);
    console.log(`[UI] Selected file: ${file.name}, size: ${file.size}`);

    // Convert file to base64
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const base64 = reader.result as string;
        console.log(`[UI] File converted to base64, length: ${base64.length}`);

        const formData = new FormData();
        formData.set("intent", "add-image");
        formData.set("imageUrl", base64);
        formData.set("altText", altText.trim());

        console.log(`[UI] Submitting image upload...`);
        sub(formData);

        // Clear form after submission (but don't hide until success is detected)
        setAltText("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (err) {
        setUploadError("Failed to upload image");
        setIsUploading(false);
        console.error("Image upload error:", err);
      }
    };
    reader.onerror = () => {
      setUploadError("Failed to read file");
      setIsUploading(false);
      console.error("FileReader error:", reader.error);
    };
    reader.readAsDataURL(file);
  };

  const deleteImage = (imageId: string) => {
    if (confirm("Remove this image?")) {
      sub({ intent: "delete-image", imageId });
    }
  };

  const saveInstructions = () => {
    sub({ intent: "save-details", title: chart.title, description: chart.description || "", chartType: chart.chartType, defaultUnit: chart.defaultUnit, instructionsHtml: instructionsText });
    setSavedInstructions(instructionsText);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
      {/* Images */}
      <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        {editorFetcher.data && "error" in editorFetcher.data && <div style={bannerStyle("error")}>{editorFetcher.data.error}</div>}
        {editorFetcher.data && "success" in editorFetcher.data && editorFetcher.data.success?.includes?.("Image") && <div style={bannerStyle("success")}>{editorFetcher.data.success}</div>}
        <button
          type="button"
          onClick={() => setShowAddImage(!showAddImage)}
          style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "12px 14px", fontSize: 13, fontWeight: 500, color: "#1a1a1a", borderBottom: showAddImage || images.length > 0 ? "1px solid #e1e3e5" : "none", display: "flex", alignItems: "center", gap: 6 }}
        >
          {showAddImage ? "▼" : "▶"} Images
        </button>

        {images.length > 0 && (
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {images.map((img: any) => (
              <div key={img.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px", background: "#fafafa", borderRadius: 6 }}>
                <img src={img.url} alt={img.altText} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {img.altText && <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "#1a1a1a" }}>{img.altText}</p>}
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.url}</p>
                </div>
                <button type="button" onClick={() => deleteImage(img.id)} style={{ ...btnDanger, flexShrink: 0, padding: "6px 10px", fontSize: 12 }}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {showAddImage && (
          <div style={{ padding: "12px 14px", borderTop: "1px solid #e1e3e5", display: "flex", flexDirection: "column", gap: 10 }}>
            {uploadError && <div style={bannerStyle("error")}>{uploadError}</div>}
            {isUploading && <div style={bannerStyle("success")}>Uploading image...</div>}
            <div>
              <label style={lbl}>Image file *</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={isUploading}
                style={{ ...inp, padding: "8px" }}
              />
            </div>
            <div>
              <label style={lbl}>Alt text (optional)</label>
              <input
                type="text"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Description of the image"
                disabled={isUploading}
                style={inp}
              />
            </div>
            <button type="button" onClick={() => { setShowAddImage(false); setUploadError(""); }} disabled={isUploading} style={btnSecondary}>Cancel</button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        <button
          type="button"
          onClick={() => setShowInstructions(!showInstructions)}
          style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "12px 14px", fontSize: 13, fontWeight: 500, color: "#1a1a1a", borderBottom: showInstructions ? "1px solid #e1e3e5" : "none", display: "flex", alignItems: "center", gap: 6 }}
        >
          {showInstructions ? "▼" : "▶"} Measurement instructions
        </button>

        {showInstructions && (
          <div style={{ padding: "12px 14px", borderTop: "1px solid #e1e3e5", display: "flex", flexDirection: "column", gap: 8 }}>
            <RichTextEditor value={instructionsText} onChange={setInstructionsText} />
            {instructionsText !== savedInstructions && (
              <button type="button" onClick={saveInstructions} style={btnPrimary}>Save instructions</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const btnDanger: React.CSSProperties = { background: "#fff", color: "#d72c0d", border: "1px solid #ffa8a0", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" };
const lbl: React.CSSProperties = { display: "block", marginBottom: 4, fontWeight: 500, fontSize: 12, color: "#3d3d3d" };
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, boxSizing: "border-box" };
const sel: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 13, background: "#fff", boxSizing: "border-box" };

function bannerStyle(type: "error" | "success"): React.CSSProperties {
  return { padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13, background: type === "error" ? "#fff4f4" : "#f1faf1", color: type === "error" ? "#d72c0d" : "#1a6b1a", border: `1px solid ${type === "error" ? "#f9c0b9" : "#a8d5a8"}` };
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
