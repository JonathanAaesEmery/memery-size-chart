import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const keep = ["shop", "hmac", "host", "locale", "session", "timestamp", "embedded", "id_token"];
  const params = new URLSearchParams();
  keep.forEach((k) => {
    const v = url.searchParams.get(k);
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return redirect("/app/charts" + (qs ? "?" + qs : ""));
};
