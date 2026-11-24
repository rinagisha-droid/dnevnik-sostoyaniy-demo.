import { createClient } from "npm:@supabase/supabase-js@2.119.1";

/*
 * Staging of server-gated paid code delivery. NOT connected to public diary yet.
 * Migration of the actual diary application code out of public GitHub is required
 * before calling this a production paywall.
 */
const allowedOrigin = "https://rinagisha-droid.github.io";
const jsonHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Origin",
  "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : "",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
});
const reply = (req, data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders(req.headers.get("Origin")), ...extra } });

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const modern = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = modern.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw Error("Missing Supabase server credentials");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== allowedOrigin) return reply(req, { error: "origin_not_allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders(origin) });
  if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);
  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.length > 8192) return reply(req, { error: "authentication_required" }, 401);

  try {
    const admin = adminClient();
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (authError || !user?.id || !user?.email_confirmed_at) {
      return reply(req, { error: "verified_account_required" }, 401);
    }

    // The paid entitlement is checked fresh on the server on EVERY request.
    // Never trust a browser flag, client-supplied email or "payment success" URL.
    const now = new Date().toISOString();
    const { data: order, error: dbError } = await admin
      .from("diary_paid_orders")
      .select("starts_at,ends_at,tariff_months")
      .eq("owner_id", user.id)
      .eq("payment_status", "paid")
      .eq("is_demo", false)
      .lte("starts_at", now)
      .gt("ends_at", now)
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dbError) throw dbError;
    if (!order) return reply(req, { error: "paid_access_required" }, 403);

    // Proof of server-gated module delivery. Actual diary bundle MUST later
    // be removed from public HTML and loaded through a protected endpoint.
    // This staged module does not modify the existing free demo.
    const module = [
      "// Licensed feature delivery prototype (no personal diary data).",
      "export const diaryLicensedFeature = Object.freeze({",
      "  entitled: true,",
      "  expiresAt: " + JSON.stringify(order.ends_at) + ",",
      "  tariffMonths: " + Number(order.tariff_months),
      "});",
      ""
    ].join("\n");
    return new Response(module, {
      status: 200,
      headers: {
        ...jsonHeaders(origin),
        "Content-Type": "text/javascript; charset=utf-8"
      }
    });
  } catch (error) {
    console.error("protected module request failed", error instanceof Error ? error.name : "unknown");
    return reply(req, { error: "temporarily_unavailable" }, 503);
  }
});
