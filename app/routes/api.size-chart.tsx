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

// ─── Translations ─────────────────────────────────────────────────────────────

const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    findYourSize: "Find your size",
    findSize: "Find size",
    enterMeasurements: "Enter your measurements",
    findPerfectSize: "Find your perfect size.",
    yourSizeIs: "Your size is",
    yourRecommendedSizeIs: "Your recommended size is",
    noSizeMatch: "No size matches your measurements. Try a different value.",
    noExactMatch: "No exact size match. Try adjusting your measurements.",
    loading: "Loading...",
    couldNotLoad: "Could not load size guide.",
    measurementsMatched: "measurements matched",
  },
  dk: {
    findYourSize: "Find din størrelse",
    findSize: "Find størrelse",
    enterMeasurements: "Indtast dine mål",
    findPerfectSize: "Find din perfekte størrelse.",
    yourSizeIs: "Din størrelse er",
    yourRecommendedSizeIs: "Din anbefalede størrelse er",
    noSizeMatch: "Ingen størrelse matcher dine mål. Prøv en anden værdi.",
    noExactMatch: "Ingen nøjagtig størrelse. Prøv at justere dine mål.",
    loading: "Indlæser...",
    couldNotLoad: "Kunne ikke indlæse størrelsesguiden.",
    measurementsMatched: "mål matchede",
  },
  de: {
    findYourSize: "Finden Sie Ihre Größe",
    findSize: "Größe finden",
    enterMeasurements: "Geben Sie Ihre Maße ein",
    findPerfectSize: "Finden Sie Ihre perfekte Größe.",
    yourSizeIs: "Ihre Größe ist",
    yourRecommendedSizeIs: "Ihre empfohlene Größe ist",
    noSizeMatch: "Keine Größe passt zu Ihren Maßen. Bitte einen anderen Wert versuchen.",
    noExactMatch: "Keine genaue Größe gefunden. Bitte Maße anpassen.",
    loading: "Laden...",
    couldNotLoad: "Größentabelle konnte nicht geladen werden.",
    measurementsMatched: "Maße stimmten überein",
  },
  fr: {
    findYourSize: "Trouvez votre taille",
    findSize: "Trouver la taille",
    enterMeasurements: "Entrez vos mesures",
    findPerfectSize: "Trouvez votre taille parfaite.",
    yourSizeIs: "Votre taille est",
    yourRecommendedSizeIs: "Votre taille recommandée est",
    noSizeMatch: "Aucune taille ne correspond à vos mesures. Essayez une autre valeur.",
    noExactMatch: "Pas de correspondance exacte. Essayez d'ajuster vos mesures.",
    loading: "Chargement...",
    couldNotLoad: "Impossible de charger le guide des tailles.",
    measurementsMatched: "mesures correspondaient",
  },
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
        candidates.push({ type: "tag", value: tag.trim().toLowerCase() });
      });
    }
    if (vendor) candidates.push({ type: "vendor", value: vendor });
    if (productType) candidates.push({ type: "product_type", value: productType });

    if (candidates.length > 0) {
      const fallback = await prisma.fallbackMapping.findFirst({
        where: {
          shop,
          OR: candidates.map((c) => ({ mappingType: c.type, mappingValue: c.value })),
        },
        include: { chart: true },
        orderBy: { priority: "desc" },
      });
      if (fallback) mapping = fallback;
    }
  }

  if (!mapping || !mapping.chart.isActive) {
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

  const lang = settings.language || "en";
  const translations = TRANSLATIONS[lang] || TRANSLATIONS.en;

  const result = { chart, settings, translations };

  // ── Store in cache ────────────────────────────────────────────────────────
  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

  return Response.json(result, { headers: CORS });
}
