import React, { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";

const EN_DEFAULTS: Record<string, string> = {
  findYourSize: "Find your size",
  findSize: "Find size",
  findPerfectSize: "Find your perfect size.",
  yourSizeIs: "Your size is",
  yourRecommendedSizeIs: "Your recommended size is",
  noSizeMatch: "No size matches your measurements. Try a different value.",
  noExactMatch: "No exact size match. Try adjusting your measurements.",
  measurementsMatched: "measurements matched",
};

const CM_TO_IN = 0.393701;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const chartId = url.searchParams.get("id");

  if (!chartId) {
    return { chart: null, settings: {} as Record<string, string>, translations: EN_DEFAULTS, error: "Missing chart id" };
  }

  const chart = await prisma.sizeChart.findUnique({
    where: { id: chartId },
    include: {
      columns: { orderBy: { displayOrder: "asc" } },
      rows: { orderBy: { displayOrder: "asc" }, include: { cells: true } },
      images: { orderBy: { displayOrder: "asc" } },
    },
  });

  if (!chart || !chart.isActive) {
    return { chart: null, settings: {} as Record<string, string>, translations: EN_DEFAULTS, error: null };
  }

  const settingsRows = await prisma.globalSettings.findMany({ where: { shop: chart.shop } });
  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    if (row.settingValue) settings[row.settingKey] = row.settingValue;
  }

  const lang = settings.language || "en";
  let translations = { ...EN_DEFAULTS };
  if (lang !== "en") {
    const customRow = await prisma.globalSettings.findUnique({
      where: { shop_settingKey: { shop: chart.shop, settingKey: `translations_${lang}` } },
    });
    if (customRow?.settingValue) {
      try {
        const custom = JSON.parse(customRow.settingValue);
        for (const key of Object.keys(custom)) {
          if (custom[key]?.trim()) translations[key] = custom[key].trim();
        }
      } catch {}
    }
  }

  return { chart, settings, translations, error: null };
}

export default function ShareSizeChart() {
  const { chart, settings, translations: T, error } = useLoaderData<typeof loader>();

  const accent = settings.accent_color || "#1a1a1a";
  const initialUnit = settings.default_unit === "inch" ? "in" : (settings.default_unit || "cm");

  const [unit, setUnit] = useState<"cm" | "in">(initialUnit as "cm" | "in");
  const [inputVals, setInputVals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ message: string; rowId: string | null } | null>(null);

  function toDisplay(val: number | null | undefined): string {
    if (val == null) return "";
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num)) return String(val);
    const v = unit === "in" ? num * CM_TO_IN : num;
    return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
  }

  function fromInput(val: string): number | null {
    const num = parseFloat(val);
    if (isNaN(num)) return null;
    return unit === "in" ? num / CM_TO_IN : num;
  }

  function getPlaceholder(col: any): string {
    const mins: number[] = [], maxs: number[] = [];
    (chart?.rows || []).forEach((row: any) => {
      const cell = row.cells?.find((c: any) => c.columnId === col.id);
      if (cell?.minValue != null) mins.push(cell.minValue);
      if (cell?.maxValue != null) maxs.push(cell.maxValue);
    });
    if (mins.length && maxs.length) {
      const mid = (Math.min(...mins) + Math.max(...maxs)) / 2;
      const v = unit === "in" ? mid * CM_TO_IN : mid;
      return "e.g. " + (v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1));
    }
    return unit === "in" ? "e.g. 9.7" : "e.g. 25";
  }

  function runRecommendation() {
    if (!chart) return;
    const inputCols = chart.columns.filter((c: any) => c.customerInputEnabled);
    const inputs: Record<string, number> = {};
    inputCols.forEach((col: any) => {
      const v = fromInput(inputVals[col.id] || "");
      if (v != null) inputs[col.id] = v;
    });
    if (Object.keys(inputs).length === 0) return;

    const matchingKeyCols = chart.columns.filter((c: any) => c.isMatchingKey);

    if (chart.chartType === "footwear") {
      const firstId = Object.keys(inputs)[0];
      const val = inputs[firstId];
      let bestRow: any = null;
      for (const row of chart.rows) {
        const cell = row.cells?.find((c: any) => c.columnId === firstId);
        if (cell && cell.minValue != null && cell.maxValue != null && val >= cell.minValue && val <= cell.maxValue) {
          bestRow = row; break;
        }
      }
      if (bestRow) {
        const sizeCols = matchingKeyCols.length > 0 ? matchingKeyCols : [chart.columns[0]];
        const labels = sizeCols.map((col: any) => {
          const cell = bestRow.cells?.find((c: any) => c.columnId === col.id);
          return `${col.name}: ${cell?.value || "–"}`;
        });
        setResult({ message: T.yourSizeIs + " " + labels.join(", "), rowId: bestRow.id });
      } else {
        setResult({ message: T.noSizeMatch, rowId: null });
      }
    } else {
      const scores = chart.rows.map((row: any) => {
        let score = 0;
        Object.entries(inputs).forEach(([colId, val]) => {
          const cell = row.cells?.find((c: any) => c.columnId === colId);
          if (cell && cell.minValue != null && cell.maxValue != null && val >= cell.minValue && val <= cell.maxValue) score++;
        });
        return { row, score };
      });
      const maxScore = Math.max(...scores.map((s: any) => s.score));
      if (maxScore === 0) {
        setResult({ message: T.noExactMatch, rowId: null });
      } else {
        const best = scores.filter((s: any) => s.score === maxScore).pop()!;
        const sizeCols = matchingKeyCols.length > 0 ? matchingKeyCols : [chart.columns[0]];
        const labels = sizeCols.map((col: any) => {
          const cell = best.row.cells?.find((c: any) => c.columnId === col.id);
          return `${col.name}: ${cell?.value || "–"}`;
        });
        const matchCount = Object.keys(inputs).length;
        const note = best.score < matchCount ? ` (${best.score}/${matchCount} ${T.measurementsMatched})` : "";
        setResult({ message: T.yourRecommendedSizeIs + " " + labels.join(", ") + note, rowId: best.row.id });
      }
    }
  }

  if (error || !chart) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f6f7", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", color: "#6d7175" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📐</div>
          <p style={{ fontSize: 16 }}>No size chart found for this product.</p>
        </div>
      </div>
    );
  }

  const inputCols = chart.columns.filter((c: any) => c.customerInputEnabled);
  const hasMeasurements = chart.columns.some((c: any) => c.columnType === "measurement");

  return (
    <div style={{ minHeight: "100vh", background: "#f6f6f7", fontFamily: "system-ui, -apple-system, sans-serif", padding: "40px 16px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e1e3e5", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.2 }}>{chart.title}</h1>
            {chart.description && <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6d7175" }}>{chart.description}</p>}
          </div>
          {hasMeasurements && (
            <div style={{ background: "#f1f1f1", borderRadius: 20, padding: 2, display: "flex", flexShrink: 0 }}>
              {(["cm", "in"] as const).map((u) => (
                <button key={u} type="button" onClick={() => { setUnit(u); setResult(null); }}
                  style={{ border: "none", cursor: "pointer", borderRadius: 18, padding: "5px 14px", fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                    background: unit === u ? accent : "transparent", color: unit === u ? "#fff" : "#555" }}>
                  {u}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "20px 24px" }}>
          {/* Size finder */}
          {inputCols.length > 0 && (
            <div style={{ background: "#f9f9f9", border: "1px solid #e1e3e5", borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <p style={{ margin: "0 0 12px", fontWeight: 600, fontSize: 14 }}>{T.findYourSize}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                {inputCols.map((col: any) => (
                  <div key={col.id} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
                    <label style={{ fontSize: 12, color: "#6d7175" }}>{col.inputLabel || col.name} ({unit})</label>
                    <input
                      type="number" min="0" step="0.1"
                      placeholder={getPlaceholder(col)}
                      value={inputVals[col.id] || ""}
                      onChange={(e) => setInputVals(v => ({ ...v, [col.id]: e.target.value }))}
                      style={{ border: "1px solid #ccc", borderRadius: 4, padding: "7px 10px", fontSize: 14, width: "100%", boxSizing: "border-box" } as React.CSSProperties}
                    />
                  </div>
                ))}
                <button onClick={runRecommendation}
                  style={{ background: accent, color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontSize: 14, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", alignSelf: "flex-end" }}>
                  {T.findSize}
                </button>
              </div>
              {result && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: `${accent}14`, border: `1px solid ${accent}44`, borderRadius: 6, fontSize: 14, color: accent }}>
                  {result.message}
                </div>
              )}
            </div>
          )}

          {/* Table */}
          {chart.columns.length > 0 && chart.rows.length > 0 && (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    {chart.columns.map((col: any) => (
                      <th key={col.id} style={{ padding: "10px 14px", background: accent, color: "#fff", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap", fontSize: 12, letterSpacing: "0.05em" }}>
                        {col.name.toUpperCase()}
                        {col.columnType === "measurement" && (
                          <span style={{ display: "block", fontWeight: 400, fontSize: 11, opacity: 0.7 }}>({unit})</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chart.rows.map((row: any, ri: number) => {
                    const isHighlight = result?.rowId === row.id;
                    return (
                      <tr key={row.id} style={{ background: isHighlight ? `${accent}18` : ri % 2 === 0 ? "#fff" : "#fafafa", outline: isHighlight ? `2px solid ${accent}` : "none", outlineOffset: -1 }}>
                        {chart.columns.map((col: any, ci: number) => {
                          const cell = row.cells?.find((c: any) => c.columnId === col.id);
                          let display = "";
                          if (col.columnType === "measurement" && cell) {
                            if (cell.minValue != null && cell.maxValue != null) {
                              display = toDisplay(cell.minValue) + "–" + toDisplay(cell.maxValue);
                            } else if (cell.value) display = toDisplay(parseFloat(cell.value));
                          } else if (cell?.value) display = cell.value;
                          return (
                            <td key={col.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f0f0f0", fontWeight: ci === 0 ? 700 : 400, color: isHighlight && ci === 0 ? accent : "#1a1a1a" }}>
                              {display}
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

          {/* Images */}
          {chart.images?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              {chart.images.map((img: any) => (
                <img key={img.id} src={img.url} alt={img.altText || ""} style={{ maxWidth: 240, width: "100%", borderRadius: 6 }} />
              ))}
            </div>
          )}

          {/* Instructions */}
          {chart.instructionsHtml && (
            <div style={{ fontSize: 14, color: "#3d3d3d", lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: chart.instructionsHtml }} />
          )}
        </div>
      </div>
    </div>
  );
}
