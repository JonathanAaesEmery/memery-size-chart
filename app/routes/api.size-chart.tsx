import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
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

  return Response.json({ chart, settings }, { headers: CORS });
}
