import React, { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  return { translations, activeLangSetting };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save-language") {
    const language = formData.get("language") as string;
    await prisma.globalSettings.upsert({
      where: { shop_settingKey: { shop: session.shop, settingKey: "language" } },
      update: { settingValue: language },
      create: { shop: session.shop, settingKey: "language", settingValue: language },
    });
    return { success: true, intent };
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
  const { translations, activeLangSetting } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
          <button onClick={handleSaveTranslations} style={btnPrimary}>
            Save {LANGUAGES.find((l) => l.code === activeLang)?.label} translations
          </button>
          {savedTranslations === activeLang && (
            <span style={{ fontSize: 13, color: "#2d6a2d", fontWeight: 500 }}>✓ Saved</span>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

const btnPrimary: React.CSSProperties = { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" };

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
