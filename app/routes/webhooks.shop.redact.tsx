/**
 * webhooks.shop.redact.tsx
 *
 * GDPR mandatory webhook — fires 48 hours after a shop uninstalls the app.
 * Everything we hold for this shop must be permanently deleted at this point
 * (GDPR art. 17, and art. 5(1)(e) storage limitation).
 *
 * SizeChart cascades to its columns, rows, cells, images, translations and
 * mappings, but mappings and settings are deleted by shop explicitly too so
 * that any row that ever got orphaned still goes.
 *
 * Configure this URL in the Partner Dashboard → App Setup → Compliance webhooks:
 *   https://memery-size-chart-production.up.railway.app/webhooks/shop/redact
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`[GDPR] ${topic} — permanently deleting all data for shop=${shop}`);

  // Children before parents. SizeChart's cascade covers columns/rows/cells/
  // images/translations; deleting the mappings first just avoids relying on it.
  const settings = await db.globalSettings.deleteMany({ where: { shop } });
  const productMappings = await db.productMapping.deleteMany({ where: { shop } });
  const fallbackMappings = await db.fallbackMapping.deleteMany({ where: { shop } });
  const charts = await db.sizeChart.deleteMany({ where: { shop } });
  const sessions = await db.session.deleteMany({ where: { shop } });

  console.log(
    `[GDPR] shop/redact complete for ${shop}: ` +
      `${charts.count} charts, ` +
      `${productMappings.count} product mappings, ` +
      `${fallbackMappings.count} fallback mappings, ` +
      `${settings.count} settings, ` +
      `${sessions.count} sessions deleted`
  );

  return new Response(null, { status: 200 });
};
