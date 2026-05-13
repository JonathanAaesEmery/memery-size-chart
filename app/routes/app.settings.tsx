import React, { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

async function getSetting(shop: string, key: string, fallback = "") {
  const row = await prisma.globalSettings.findUnique({ where: { shop_settingKey: { shop, settingKey: key } } });
  return row?.settingValue ?? fallback;
}

async function setSetting(shop: string, key: string, value: string) {
  await prisma.globalSettings.upsert({
    where: { shop_settingKey: { shop, settingKey: key } },
    update: { settingValue: value },
    create: { shop, settingKey: key, settingValue: value },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [defaultUnit, accentColor, buttonStyle, buttonText, language] = await Promise.all([
    getSetting(shop, "default_unit", "cm"),
    getSetting(shop, "accent_color", "#1a1a1a"),
    getSetting(shop, "button_style", "underline"),
    getSetting(shop, "button_text", "Size Guide"),
    getSetting(shop, "language", "en"),
  ]);
  return { defaultUnit, accentColor, buttonStyle, buttonText, language };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const shop = session.shop;
  await Promise.all([
    setSetting(shop, "default_unit", (formData.get("defaultUnit") as string) || "cm"),
    setSetting(shop, "accent_color", (formData.get("accentColor") as string) || "#1a1a1a"),
    setSetting(shop, "button_style", (formData.get("buttonStyle") as string) || "underline"),
    setSetting(shop, "button_text", (formData.get("buttonText") as string) || "Size Guide"),
    setSetting(shop, "language", (formData.get("language") as string) || "en"),
  ]);
  return { success: true };
};

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: 12, padding: 24, marginBottom: 20 };
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: "0 0 4px" };
const sectionSub: React.CSSProperties = { fontSize: 13, color: "#6d7175", margin: "0 0 20px" };
const lbl: React.CSSProperties = { display: "block", marginBottom: 5, fontWeight: 500, fontSize: 13 };
const inp: React.CSSProperties = { padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: 6, fontSize: 14, background: "#fff", width: "100%", boxSizing: "border-box" };
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 };

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [saved, setSaved] = useState(false);

  const unitRef = useRef<HTMLSelectElement>(null);
  const accentRef = useRef<HTMLInputElement>(null);
  const accentHexRef = useRef<HTMLInputElement>(null);
  const buttonStyleRef = useRef<HTMLSelectElement>(null);
  const buttonTextRef = useRef<HTMLInputElement>(null);
  const languageRef = useRef<HTMLSelectElement>(null);

  const [previewAccent, setPreviewAccent] = useState(data.accentColor);
  const [previewStyle, setPreviewStyle] = useState(data.buttonStyle);
  const [previewBtnText, setPreviewBtnText] = useState(data.buttonText);

  const handleSave = () => {
    fetcher.submit({
      defaultUnit: unitRef.current?.value || "cm",
      accentColor: accentRef.current?.value || "#1a1a1a",
      buttonStyle: buttonStyleRef.current?.value || "underline",
      buttonText: buttonTextRef.current?.value || "Size Guide",
      language: languageRef.current?.value || "en",
    }, { method: "post" });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const triggerStyle: React.CSSProperties = previewStyle === "filled"
    ? { background: previewAccent, color: "#fff", border: "none", borderRadius: 4, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit" }
    : previewStyle === "outline"
    ? { background: "transparent", color: previewAccent, border: `2px solid ${previewAccent}`, borderRadius: 4, padding: "9px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit" }
    : { background: "none", border: "none", padding: 0, fontSize: 14, textDecoration: "underline", textUnderlineOffset: 3, color: previewAccent, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit" };

  return (
    <s-page heading="Settings">

      {/* ── Button ── */}
      <div style={card}>
        <h2 style={sectionTitle}>Button</h2>
        <p style={sectionSub}>The "Size Guide" button shown on product pages</p>
        <div style={row}>
          <div>
            <label style={lbl}>Button text</label>
            <input ref={buttonTextRef} defaultValue={data.buttonText} style={inp} placeholder="Size Guide"
              onChange={e => setPreviewBtnText(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Button style</label>
            <select ref={buttonStyleRef} defaultValue={data.buttonStyle} style={inp}
              onChange={e => setPreviewStyle(e.target.value)}>
              <option value="underline">Underline link</option>
              <option value="outline">Outline button</option>
              <option value="filled">Filled button</option>
            </select>
          </div>
        </div>
        <div>
          <label style={lbl}>Preview</label>
          <div style={{ padding: "16px 20px", background: "#f9f9f9", borderRadius: 8, border: "1px solid #e1e3e5", display: "inline-block" }}>
            <button style={triggerStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.3 8.7 8.7 21.3c-.6.6-1.5.6-2.1 0L3.7 18.4c-.6-.6-.6-1.5 0-2.1L16.3 3.7c.6-.6 1.5-.6 2.1 0l2.9 2.9c.6.6.6 1.5 0 2.1z"/>
                <path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>
              </svg>
              {previewBtnText || "Size Guide"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Brand color ── */}
      <div style={card}>
        <h2 style={sectionTitle}>Brand color</h2>
        <p style={sectionSub}>Applied to the size table header and the CM/IN toggle</p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 24 }}>
          <input ref={accentRef} type="color" defaultValue={data.accentColor}
            onChange={e => { setPreviewAccent(e.target.value); if (accentHexRef.current) accentHexRef.current.value = e.target.value; }}
            style={{ width: 48, height: 40, padding: 2, border: "1px solid #c9cccf", borderRadius: 6, cursor: "pointer" }} />
          <input ref={accentHexRef} defaultValue={data.accentColor} placeholder="#1a1a1a"
            onChange={e => { const v = e.target.value; if (/^#[0-9a-fA-F]{6}$/.test(v)) { setPreviewAccent(v); if (accentRef.current) accentRef.current.value = v; } }}
            style={{ ...inp, width: 110, fontFamily: "monospace" }} />
        </div>

        {/* Preview */}
        <label style={lbl}>Preview</label>
        <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, overflow: "hidden", maxWidth: 460 }}>
          {/* Table header preview */}
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: previewAccent }}>
                {["EU", "UK", "US", "FOOT LENGTH", "LENGTH INSIDE"].map(col => (
                  <th key={col} style={{ padding: "9px 12px", color: "#fff", fontWeight: 700, textAlign: "left", fontSize: 11, letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[["38", "5", "7", "24.1–24.7", "25.2"], ["39", "6", "8", "24.8–25.3", "25.8"]].map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  {r.map((v, j) => <td key={j} style={{ padding: "9px 12px", borderBottom: "1px solid #f0f0f0", fontWeight: j === 0 ? 700 : 400 }}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>

          {/* CM/IN toggle preview */}
          <div style={{ padding: "12px 16px", background: "#fff", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#6d7175" }}>Unit toggle:</span>
            <div style={{ background: "#f1f1f1", borderRadius: 20, padding: 2, display: "flex" }}>
              <span style={{ background: previewAccent, color: "#fff", borderRadius: 18, padding: "4px 12px", fontSize: 12, fontWeight: 600 }}>CM</span>
              <span style={{ color: "#555", borderRadius: 18, padding: "4px 12px", fontSize: 12, fontWeight: 600 }}>IN</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── General ── */}
      <div style={card}>
        <h2 style={sectionTitle}>General</h2>
        <p style={sectionSub}>Default settings for all size charts</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 500 }}>
          <div>
            <label style={lbl}>Default measurement unit</label>
            <select ref={unitRef} defaultValue={data.defaultUnit} style={inp}>
              <option value="cm">Centimeters (cm)</option>
              <option value="inch">Inches (in)</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Language</label>
            <select ref={languageRef} defaultValue={data.language} style={inp}>
              <option value="en">🇬🇧 English</option>
              <option value="dk">🇩🇰 Dansk</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="fr">🇫🇷 Français</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Save ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 40 }}>
        <button onClick={handleSave} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Save settings
        </button>
        {saved && <span style={{ fontSize: 13, color: "#2d6a2d", fontWeight: 500 }}>✓ Settings saved</span>}
      </div>

    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
