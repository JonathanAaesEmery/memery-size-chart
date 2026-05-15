import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// ─── In-memory cache ──────────────────────────────────────────────────────────
// TTL: 2 hours. Size charts almost never change after being set up.
// Cache is per shop+product so each product always gets its own correct chart.

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface CacheEntry {
  data: { chart: any; settings: Record<string, string> };
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCacheKey(shop: string, productId: string | null, productHandle: string | null, tags: string | null, vendor: string | null, productType: string | null) {
  return `${shop}||${productId || ""}||${productHandle || ""}||${tags || ""}||${vendor || ""}||${productType || ""}`;
}

export function invalidateCache(shop: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(shop + "||")) cache.delete(key);
  }
}


// ─── English defaults (always the fallback) ───────────────────────────────────

const EN_DEFAULTS: Record<string, string> = {
  findYourSize: "Find your size",
  findSize: "Find size",
  findPerfectSize: "Find your perfect size.",
  yourSizeIs: "Your size is",
  yourRecommendedSizeIs: "Your recommended size is",
  noSizeMatch: "No size matches your measurements. Try a different value.",
  noExactMatch: "No exact size match. Try adjusting your measurements.",
  loading: "Loading...",
  couldNotLoad: "Could not load size guide.",
  measurementsMatched: "measurements matched",
};

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return new Response("Method not allowed", { status: 405, headers: CORS });
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const productHandle = url.searchParams.get("product_handle");
  const productIdParam = url.searchParams.get("product_id");
  const tagsParam = url.searchParams.get("tags");
  const vendor = url.searchParams.get("vendor");
  const productType = url.searchParams.get("product_type");

  if (!shop) {
    return Response.json({ error: "Missing shop parameter" }, { status: 400, headers: CORS });
  }

  // ── Debug mode ────────────────────────────────────────────────────────────
  if (url.searchParams.get("debug") === "1") {
    const [allMappings, allFallbacks, shopList] = await Promise.all([
      prisma.productMapping.findMany({ where: { shop }, select: { productHandle: true, productId: true, chartId: true } }),
      prisma.fallbackMapping.findMany({ where: { shop }, select: { mappingType: true, mappingValue: true, chartId: true } }),
      prisma.fallbackMapping.findMany({ distinct: ["shop"], select: { shop: true }, take: 20 }),
    ]);
    return Response.json({ shopQueried: shop, shopsInDB: shopList.map(s => s.shop), allMappings, allFallbacks, receivedTags: tagsParam, receivedVendor: vendor, receivedProductType: productType }, { headers: CORS });
  }

  // ── One-time shop migration ───────────────────────────────────────────────
  // Usage: /api/size-chart?migrate=1&from=OLD.myshopify.com&to=NEW.myshopify.com
  if (url.searchParams.get("migrate") === "1") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return Response.json({ error: "Missing from/to" }, { headers: CORS });
    const [charts, mappings, fallbacks, settings] = await Promise.all([
      prisma.sizeChart.updateMany({ where: { shop: from }, data: { shop: to } }),
      prisma.productMapping.updateMany({ where: { shop: from }, data: { shop: to } }),
      prisma.fallbackMapping.updateMany({ where: { shop: from }, data: { shop: to } }),
      prisma.globalSettings.updateMany({ where: { shop: from }, data: { shop: to } }),
    ]);
    return Response.json({ migrated: { charts: charts.count, mappings: mappings.count, fallbacks: fallbacks.count, settings: settings.count } }, { headers: CORS });
  }

  // ── Cache lookup ──────────────────────────────────────────────────────────
  const cacheKey = getCacheKey(shop, productIdParam, productHandle, tagsParam, vendor, productType);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.data, { headers: CORS });
  }

  // Normalize product ID to GID format
  const productId = productIdParam
    ? productIdParam.startsWith("gid://")
      ? productIdParam
      : `gid://shopify/Product/${productIdParam}`
    : null;

  // 1. Try direct product mapping by ID
  let mapping = null;
  if (productId) {
    mapping = await prisma.productMapping.findFirst({
      where: { shop, productId },
      include: { chart: true },
    });
    if (!mapping && productIdParam && !productIdParam.startsWith("gid://")) {
      mapping = await prisma.productMapping.findFirst({
        where: { shop, productId: productIdParam },
        include: { chart: true },
      });
    }
  }

  // 2. Try direct product mapping by handle
  if (!mapping && productHandle) {
    mapping = await prisma.productMapping.findFirst({
      where: { shop, productHandle },
      include: { chart: true },
    });
  }

  // 3. Try fallback mappings (tag, vendor, product_type)
  if (!mapping) {
    const candidates: { type: string; value: string }[] = [];

    if (tagsParam) {
      tagsParam.split(",").forEach((tag) => {
        const decoded = decodeURIComponent(tag.trim());
        if (decoded) candidates.push({ type: "tag", value: decoded });
      });
    }
    if (vendor) candidates.push({ type: "vendor", value: decodeURIComponent(vendor) });
    if (productType) candidates.push({ type: "product_type", value: decodeURIComponent(productType) });

    if (candidates.length > 0) {
      console.log(`[size-chart] shop=${shop} searching fallbacks, candidates=`, JSON.stringify(candidates));
      const fallback = await prisma.fallbackMapping.findFirst({
        where: {
          shop,
          OR: candidates.map((c) => ({
            mappingType: c.type,
            mappingValue: { equals: c.value, mode: "insensitive" },
          })),
        },
        include: { chart: true },
        orderBy: { priority: "desc" },
      });
      console.log(`[size-chart] fallback found=`, fallback ? `chartId=${fallback.chartId} type=${fallback.mappingType} value=${fallback.mappingValue}` : "none");
      if (fallback) mapping = fallback;
    }
  }

  if (!mapping) {
    console.log(`[size-chart] shop=${shop} no mapping found for product=${productId || productHandle}`);
    return Response.json({ chart: null }, { headers: CORS });
  }

  if (!mapping.chart.isActive) {
    console.log(`[size-chart] shop=${shop} chart ${mapping.chartId} is INACTIVE`);
    return Response.json({ chart: null }, { headers: CORS });
  }

  const chart = await prisma.sizeChart.findUnique({
    where: { id: mapping.chartId },
    include: {
      columns: { orderBy: { displayOrder: "asc" } },
      rows: {
        orderBy: { displayOrder: "asc" },
        include: { cells: true },
      },
      images: { orderBy: { displayOrder: "asc" } },
    },
  });

  const settingsRows = await prisma.globalSettings.findMany({ where: { shop } });
  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    if (row.settingValue) settings[row.settingKey] = row.settingValue;
  }

  // Build translations: start with English defaults, overlay custom translations from DB
  const lang = settings.language || "en";
  let translations = { ...EN_DEFAULTS };
  if (lang !== "en") {
    const customRow = await prisma.globalSettings.findUnique({
      where: { shop_settingKey: { shop: shop!, settingKey: `translations_${lang}` } },
    });
    if (customRow?.settingValue) {
      try {
        const custom = JSON.parse(customRow.settingValue);
        // Only override keys that have a non-empty value
        for (const key of Object.keys(custom)) {
          if (custom[key]?.trim()) translations[key] = custom[key].trim();
        }
      } catch { /* ignore malformed JSON */ }
    }
  }

  const result = { chart, settings, translations };

  // ── Store in cache ────────────────────────────────────────────────────────
  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

  return Response.json(result, { headers: CORS });
}
