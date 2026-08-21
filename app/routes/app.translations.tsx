import React, { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import OpenAI from "openai";
import { invalidateCache } from "./api.size-chart";

// ─── All translatable strings with English defaults ───────────────────────────

export const TRANSLATION_KEYS: { key: string; label: string; description: string; default: string }[] = [
  { key: "findYourSize",          label: "Section heading",          description: "Title above the measurement input fields",             default: "Find your size" },
  { key: "findSize",              label: "Button label",             description: "The button that triggers the size recommendation",      default: "Find size" },
  { key: "findPerfectSize",       label: "Input subtitle",           description: "Small text below the section heading",                  default: "Find your perfect size." },
  { key: "yourSizeIs",            label: "Exact match result",       description: "Shown when an exact size match is found (footwear)",    default: "Your size is" },
  { key: "yourRecommendedSizeIs", label: "Recommended size result",  description: "Shown when a recommended size is found (apparel)",      default: "Your recommended size is" },
  { key: "noSizeMatch",           label: "No match message",         description: "Shown when no size matches the measurements",           default: "No size matches your measurements. Try a different value." },
  { key: "noExactMatch",          label: "No exact match message",   description: "Shown when no exact match exists (apparel)",            default: "No exact size match. Try adjusting your measurements." },
  { key: "loading",               label: "Loading text",             description: "Shown while the size chart is loading",                 default: "Loading..." },
  { key: "couldNotLoad",          label: "Error text",               description: "Shown if the size chart fails to load",                 default: "Could not load size guide." },
  { key: "measurementsMatched",   label: "Measurements matched",     description: "Appended to result when not all measurements matched",  default: "measurements matched" },
];

const LANGUAGES = [
  { code: "dk", label: "🇩🇰 Dansk" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "fr", label: "🇫🇷 Français" },
];

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const rows = await prisma.globalSettings.findMany({
    where: { shop, settingKey: { in: [...LANGUAGES.map((l) => `translations_${l.code}`), "language"] } },
  });

  const translations: Record<string, Record<string, string>> = {};
  for (const lang of LANGUAGES) {
    const row = rows.find((r) => r.settingKey === `translations_${lang.code}`);
    try {
      translations[lang.code] = row?.settingValue ? JSON.parse(row.settingValue) : {};
    } catch {
      translations[lang.code] = {};
    }
  }

  const activeLangSetting = rows.find((r) => r.settingKey === "language")?.settingValue || "en";

  const totalCharts = await prisma.sizeChart.count({ where: { shop } });

  let translatedCounts: Record<string, number> = {};
  try {
    const chartIds = (await prisma.sizeChart.findMany({ where: { shop }, select: { id: true } })).map((c) => c.id);
    const counts = await Promise.all(
      LANGUAGES.map(async (lang) => {
        const count = await prisma.sizeChartTranslation.count({
          where: { chartId: { in: chartIds }, language: lang.code },
        });
        return { lang: lang.code, count };
      })
    );
    for (const { lang, count } of counts) translatedCounts[lang] = count;
  } catch {
    // Table doesn't exist yet — migration pending
  }

  return { translations, activeLangSetting, totalCharts, translatedCounts };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "translate-all") {
    try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const charts = await prisma.sizeChart.findMany({
      where: { shop: session.shop },
      include: { columns: { orderBy: { displayOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });

    if (charts.length === 0) return { error: "No charts to translate." };

    const langCodes = LANGUAGES.map((l) => l.code).join(", ");

    // Translate in small batches — a single prompt covering every chart in every
    // language is unreliable at scale (GPT-4o-mini silently drops fields once the
    // JSON response gets large), so a handful of charts per call keeps output complete.
    const BATCH_SIZE = 5;
    const batches: (typeof charts)[] = [];
    for (let i = 0; i < charts.length; i += BATCH_SIZE) {
      batches.push(charts.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      const chartLines = batch.map((c, i) => {
        const cols = c.columns.map((col) => col.name).join(", ");
        const desc = c.description ? ` | Description: ${c.description}` : "";
        const instr = c.instructionsHtml
          ? ` | Instructions (HTML, keep tags): ${c.instructionsHtml.slice(0, 300)}`
          : "";
        return `[${i}] Title: ${c.title}${desc}${cols ? ` | Columns: ${cols}` : ""}${instr}`;
      });

      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a professional e-commerce translator. Translate size chart content into multiple languages. Keep translations natural and concise. For Instructions HTML: preserve all HTML tags, only translate text inside them. Reply ONLY with valid JSON in this exact structure — no extra keys, no markdown:
{
  "LANG_CODE": [
    { "title": "...", "description": "...", "columns": ["col1","col2",...], "instructions": "..." }
  ]
}
Every chart in the input MUST have a corresponding entry at the same array index in every language, even if it means repeating short text. Omit "description" key only if the original chart has no description at all. Omit "instructions" key only if the original chart has no instructions at all. Preserve array order. Languages to produce: ${langCodes}.`,
          },
          {
            role: "user",
            content: `Translate these size charts:\n\n${chartLines.join("\n")}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      let translated: Record<string, any[]>;
      try {
        translated = JSON.parse(response.choices[0].message.content ?? "{}");
      } catch {
        return { error: "Could not parse translation response from OpenAI." };
      }

      for (const lang of LANGUAGES) {
        const langData = translated[lang.code];
        if (!Array.isArray(langData)) continue;

        for (let i = 0; i < batch.length; i++) {
          const chart = batch[i];
          const t = langData[i];
          if (!t) continue;

          const columnNames: Record<string, string> = {};
          if (Array.isArray(t.columns)) {
            chart.columns.forEach((col, ci) => {
              if (t.columns[ci]?.trim()) columnNames[col.id] = t.columns[ci].trim();
            });
          }

          const title = typeof t.title === "string" && t.title.trim() ? t.title.trim() : null;
          const description = typeof t.description === "string" && t.description.trim() ? t.description.trim() : null;
          const instructionsHtml = typeof t.instructions === "string" && t.instructions.trim() ? t.instructions.trim() : null;

          await prisma.sizeChartTranslation.upsert({
            where: { chartId_language: { chartId: chart.id, language: lang.code } },
            update: {
              title,
              description,
              instructionsHtml,
              columnNames: Object.keys(columnNames).length ? JSON.stringify(columnNames) : null,
            },
            create: {
              chartId: chart.id,
              language: lang.code,
              title,
              description,
              instructionsHtml,
              columnNames: Object.keys(columnNames).length ? JSON.stringify(columnNames) : null,
            },
          });
        }
      }
    }

    try { invalidateCache(session.shop); } catch {}
    return { translatedAll: true, chartCount: charts.length, langCount: LANGUAGES.length };
    } catch (err: any) {
      console.error("[translate-all] error:", err);
      return { error: `Translation failed: ${err?.message ?? String(err)}` };
    }
  }

  if (intent === "save-language") {
    const language = formData.get("language") as string;
    await prisma.globalSettings.upsert({
      where: { shop_settingKey: { shop: session.shop, settingKey: "language" } },
      update: { settingValue: language },
      create: { shop: session.shop, settingKey: "language", settingValue: language },
    });
    return { success: true, intent };
  }

  if (intent === "auto-translate") {
    const lang = formData.get("lang") as string;
    const langLabel = LANGUAGES.find((l) => l.code === lang)?.label ?? lang;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const stringList = TRANSLATION_KEYS.map(
      ({ key, default: def }) => `${key}: ${def}`
    ).join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a professional UI translator. Translate the given strings into the requested language. Keep translations short and natural — these are UI labels, not full sentences where unnecessary. Reply ONLY with valid JSON: an object where each key maps to its translation. No markdown, no explanation.",
        },
        {
          role: "user",
          content: `Translate these UI strings into ${langLabel}:\n\n${stringList}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    let translated: Record<string, string> = {};
    try {
      translated = JSON.parse(response.choices[0].message.content ?? "{}");
    } catch {
      return { error: "Could not parse translation response." };
    }

    return { autoTranslated: translated, lang };
  }

  if (intent === "save-translations") {
    const lang = formData.get("lang") as string;
    const values: Record<string, string> = {};
    for (const { key } of TRANSLATION_KEYS) {
      const val = (formData.get(key) as string)?.trim();
      if (val) values[key] = val;
    }
    await prisma.globalSettings.upsert({
      where: { shop_settingKey: { shop: session.shop, settingKey: `translations_${lang}` } },
      update: { settingValue: JSON.stringify(values) },
      create: { shop: session.shop, settingKey: `translations_${lang}`, settingValue: JSON.stringify(values) },
    });
    return { success: true, intent, lang };
  }

  return null;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TranslationsPage() {
  const { translations, activeLangSetting, totalCharts, translatedCounts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const bulkFetcher = useFetcher<any>();
  const [activeLang, setActiveLang] = useState("dk");
  const [storeLanguage, setStoreLanguage] = useState(activeLangSetting);
  const [savedLang, setSavedLang] = useState(false);
  const [savedTranslations, setSavedTranslations] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, string>>>(translations);

  const handleSaveLanguage = (lang: string) => {
    setStoreLanguage(lang);
    fetcher.submit({ intent: "save-language", language: lang }, { method: "post" });
    setSavedLang(true);
    setTimeout(() => setSavedLang(false), 3000);
  };

  const handleSaveTranslations = () => {
    const formData = new FormData();
    formData.set("intent", "save-translations");
    formData.set("lang", activeLang);
    for (const { key } of TRANSLATION_KEYS) {
      formData.set(key, values[activeLang]?.[key] || "");
    }
    fetcher.submit(formData, { method: "post" });
    setSavedTranslations(activeLang);
    setTimeout(() => setSavedTranslations(null), 3000);
  };

  const currentValues = values[activeLang] || {};

  const updateValue = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [activeLang]: { ...prev[activeLang], [key]: val } }));
  };

  const handleAutoTranslate = () => {
    fetcher.submit({ intent: "auto-translate", lang: activeLang }, { method: "post" });
  };

  // When auto-translate comes back, merge into local state
  React.useEffect(() => {
    if (fetcher.data && "autoTranslated" in fetcher.data && fetcher.data.lang === activeLang) {
      const translated = fetcher.data.autoTranslated as Record<string, string>;
      setValues((prev) => ({ ...prev, [activeLang]: { ...prev[activeLang], ...translated } }));
    }
  }, [fetcher.data]); // eslint-disable-line

  const isTranslating = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "auto-translate";

  const allLanguages = [{ code: "en", label: "🇬🇧 English" }, ...LANGUAGES];

  return (
    <s-page heading="Translations">
      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          English is always the source language and cannot be changed.
        </s-paragraph>
        <s-paragraph>
          Set your store language, then fill in translations for that language. Leave a field blank to fall back to English.
        </s-paragraph>
      </s-section>

      {/* ── Bulk chart translation ── */}
      <s-section heading="Translate all size charts">
        <p style={{ fontSize: 13, color: "#6d7175", marginTop: 0, marginBottom: 16 }}>
          Automatically translates every chart's title, description, column names and instructions into all languages at once using AI.
        </p>

        {/* Status per language */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {LANGUAGES.map((lang) => {
            const count = translatedCounts[lang.code] ?? 0;
            const done = totalCharts > 0 && count >= totalCharts;
            return (
              <div key={lang.code} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, background: done ? "#d4edda" : "#f6f6f7", border: `1px solid ${done ? "#a8d5a8" : "#e1e3e5"}`, fontSize: 13 }}>
                <span>{lang.label}</span>
                <span style={{ color: done ? "#155724" : "#6d7175", fontWeight: 600 }}>
                  {count}/{totalCharts} {done ? "✓" : ""}
                </span>
              </div>
            );
          })}
        </div>

        {bulkFetcher.data && "translatedAll" in bulkFetcher.data && (
          <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13, background: "#f1faf1", color: "#1a6b1a", border: "1px solid #a8d5a8" }}>
            ✓ Translated {bulkFetcher.data.chartCount} charts into {bulkFetcher.data.langCount} languages.
          </div>
        )}
        {bulkFetcher.data && "error" in bulkFetcher.data && (
          <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13, background: "#fff4f4", color: "#d72c0d", border: "1px solid #f9c0b9" }}>
            {bulkFetcher.data.error}
          </div>
        )}

        <button
          type="button"
          disabled={bulkFetcher.state !== "idle" || totalCharts === 0}
          onClick={() => bulkFetcher.submit({ intent: "translate-all" }, { method: "post" })}
          style={{ ...btnPrimary, opacity: totalCharts === 0 ? 0.5 : 1 }}
        >
          {bulkFetcher.state !== "idle" ? "Translating… (may take ~10 sec)" : `✨ Translate all ${totalCharts} charts to all languages`}
        </button>
        {totalCharts === 0 && (
          <p style={{ marginTop: 8, fontSize: 12, color: "#6d7175" }}>Create some size charts first.</p>
        )}
      </s-section>

      {/* ── Store language ── */}
      <s-section heading="Store language">
        <p style={{ fontSize: 13, color: "#6d7175", marginBottom: 16, marginTop: 0 }}>
          The language shown to customers in the size chart modal.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {allLanguages.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => handleSaveLanguage(lang.code)}
              style={{
                padding: "8px 18px",
                borderRadius: 6,
                border: `1.5px solid ${storeLanguage === lang.code ? "#1a1a1a" : "#c9cccf"}`,
                background: storeLanguage === lang.code ? "#1a1a1a" : "#fff",
                color: storeLanguage === lang.code ? "#fff" : "#1a1a1a",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {lang.label}
              {storeLanguage === lang.code && <span style={{ marginLeft: 6, opacity: 0.7 }}>✓</span>}
            </button>
          ))}
          {savedLang && <span style={{ fontSize: 13, color: "#2d6a2d", fontWeight: 500 }}>✓ Saved</span>}
        </div>
      </s-section>

      {/* ── Translation editor ── */}
      <s-section heading="Edit translations">
        {/* Language tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => setActiveLang(lang.code)}
              style={{
                padding: "8px 18px",
                borderRadius: 6,
                border: `1.5px solid ${activeLang === lang.code ? "#1a1a1a" : "#c9cccf"}`,
                background: activeLang === lang.code ? "#1a1a1a" : "#fff",
                color: activeLang === lang.code ? "#fff" : "#1a1a1a",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Translation table */}
        <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#f6f6f7", padding: "10px 16px", borderBottom: "1px solid #e1e3e5" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🇬🇧 English (source)
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {LANGUAGES.find((l) => l.code === activeLang)?.label} translation
            </span>
          </div>

          {/* Rows */}
          {TRANSLATION_KEYS.map(({ key, label, description, default: defaultVal }, i) => (
            <div
              key={key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 0,
                borderBottom: i < TRANSLATION_KEYS.length - 1 ? "1px solid #e1e3e5" : "none",
              }}
            >
              {/* English source */}
              <div style={{ padding: "14px 16px", borderRight: "1px solid #e1e3e5", background: "#fafafa" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#3d3d3d", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 11, color: "#9c9da0", marginBottom: 8 }}>{description}</div>
                <div style={{ fontSize: 13, color: "#1a1a1a", background: "#f0f0f0", padding: "6px 10px", borderRadius: 4, fontStyle: "italic" }}>
                  {defaultVal}
                </div>
              </div>

              {/* Translation input */}
              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#3d3d3d", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 11, color: "#9c9da0", marginBottom: 8 }}>Leave blank to use English</div>
                <input
                  value={currentValues[key] || ""}
                  onChange={(e) => updateValue(key, e.target.value)}
                  placeholder={defaultVal}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    border: "1px solid #c9cccf",
                    borderRadius: 4,
                    fontSize: 13,
                    boxSizing: "border-box",
                    outline: "none",
                    background: currentValues[key] ? "#fff" : "#fafafa",
                  } as React.CSSProperties}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Save */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <button onClick={handleAutoTranslate} disabled={isTranslating} style={btnSecondary}>
            {isTranslating ? "Translating…" : `✨ Auto-translate to ${LANGUAGES.find((l) => l.code === activeLang)?.label}`}
          </button>
          <button onClick={handleSaveTranslations} style={btnPrimary}>
            Save {LANGUAGES.find((l) => l.code === activeLang)?.label} translations
          </button>
          {fetcher.data && "error" in fetcher.data && (
            <span style={{ fontSize: 13, color: "#d72c0d" }}>{fetcher.data.error as string}</span>
          )}
          {savedTranslations === activeLang && (
            <span style={{ fontSize: 13, color: "#2d6a2d", fontWeight: 500 }}>✓ Saved</span>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { background: "#fff", color: "#1a1a1a", border: "1px solid #c9cccf", borderRadius: 6, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" };

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
