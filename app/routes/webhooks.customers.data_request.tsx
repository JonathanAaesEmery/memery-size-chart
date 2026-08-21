/**
 * webhooks.customers.data_request.tsx
 *
 * GDPR mandatory webhook — fires when a customer requests a copy of the data
 * we hold about them (art. 15).
 *
 * This app stores no personal data about a shop's customers (see
 * webhooks.customers.redact.tsx for the full model list), so there is nothing
 * to hand over. We acknowledge with a 200; the merchant answers the request
 * from the Shopify admin.
 *
 * Configure this URL in the Partner Dashboard → App Setup → Compliance webhooks:
 *   https://memery-size-chart-production.up.railway.app/webhooks/customers/data_request
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  // Customer identifiers from the payload are intentionally not logged.
  console.log(`[GDPR] ${topic} for shop=${shop} — no customer data stored, nothing to export`);

  return new Response(null, { status: 200 });
};
