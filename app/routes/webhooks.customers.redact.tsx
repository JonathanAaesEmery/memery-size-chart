/**
 * webhooks.customers.redact.tsx
 *
 * GDPR mandatory webhook — fires when a customer exercises their right to
 * erasure (art. 17).
 *
 * This app stores no personal data about a shop's customers. Its models are
 * SizeChart (+ columns/rows/cells/images/translations), ProductMapping,
 * FallbackMapping and GlobalSettings — all merchant-authored configuration
 * keyed by shop and product, never by customer. The size recommender runs
 * entirely in the shopper's browser; the measurements a shopper types in are
 * never sent to us or stored.
 *
 * There is therefore nothing to erase, and we acknowledge with a 200. If this
 * app ever starts storing shopper-level data, the deletion must be added here.
 *
 * Configure this URL in the Partner Dashboard → App Setup → Compliance webhooks:
 *   https://memery-size-chart-production.up.railway.app/webhooks/customers/redact
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  // Deliberately not logging the customer id or email from the payload — writing
  // the identifier of someone exercising their right to erasure into the app
  // logs is exactly the copy the request is meant to remove.
  console.log(`[GDPR] ${topic} for shop=${shop} — no customer data stored, nothing to erase`);

  return new Response(null, { status: 200 });
};
