import { createClient } from "npm:@supabase/supabase-js@2.119.1";

// Prodamus callback: public endpoint, but accepts events ONLY with a valid HMAC-SHA256.
// No secret -> HTTP 503. Demo payments NEVER activate entitlements.
const utf8 = new TextEncoder();
const reply = (message, status = 200) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const asText = (value) => value === undefined || value === null ? "" : String(value);
const cleanEmail = (value) => asText(value).trim().toLowerCase();
const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
function normalizeForSignature(value) {
  if (Array.isArray(value)) return value.map(normalizeForSignature);
  if (isRecord(value)) {
    const obj = {};
    for (const key of Object.keys(value).sort()) obj[key] = normalizeForSignature(value[key]);
    return obj;
  }
  return asText(value);
}
async function validSignature(data, secret, submitted) {
  if (!/^[a-f0-9]{64}$/i.test(submitted)) return false;
  const canonical = JSON.stringify(normalizeForSignature(data)).replace(/\//g, "\\/");
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(canonical)));
  const expected = new Uint8Array(submitted.match(/../g).map((n) => parseInt(n, 16)));
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
function putBracketPath(root, rawKey, value) {
  const tokens = rawKey.match(/[^\[\]]+/g) || [];
  if (!tokens.length || tokens.length > 7) throw Error("Invalid form key");
  let target = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const part = tokens[i], next = tokens[i + 1];
    if (!Object.prototype.hasOwnProperty.call(target, part)) target[part] = /^\d+$/.test(next) ? [] : {};
    target = target[part];
    if (!target || typeof target !== "object") throw Error("Invalid nested form");
  }
  target[tokens[tokens.length - 1]] = asText(value);
}
async function readPayload(req) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await req.json();
    if (!isRecord(body)) throw Error("Expected JSON object");
    const payload = isRecord(body.submit) ? body.submit : typeof body.submit === "string" ? JSON.parse(body.submit) : body;
    return { payload, sign: req.headers.get("Sign") || body.sign || body.Sign || "" };
  }
  const data = type.includes("multipart/form-data") ? await req.formData() : new URLSearchParams(await req.text());
  const fields = {};
  for (const [name, value] of data.entries()) {
    if (typeof value !== "string") throw Error("File field not accepted");
    putBracketPath(fields, name, value);
  }
  const candidate = fields.submit;
  const payload = typeof candidate === "string" ? JSON.parse(candidate) : isRecord(candidate) ? candidate : fields;
  const sign = req.headers.get("Sign") || fields.sign || fields.Sign || "";
  if (payload === fields) { delete payload.sign; delete payload.Sign; }
  return { payload, sign };
}
function money(value) {
  const s = asText(value).trim().replace(",", ".");
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
function moscowStart() { return new Date("2027-01-01T00:00:00+03:00"); }
function addMonthsUtc(from, months) {
  const date = new Date(from);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}
function parseDate(raw) {
  const s = asText(raw).trim();
  if (!s) return null;
  // Prodamus sends local date/time in Moscow. Require a valid timestamp,
  // do not silently switch pre-sale prices around midnight.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(s)
    ? s.replace(" ", "T") + "+03:00"
    : s;
  const d = new Date(normalized);
  return Number.isNaN(+d) ? null : d;
}
function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const modern = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = modern.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw Error("Server admin credentials missing");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return reply("Method not allowed", 405);
  const secret = Deno.env.get("PRODAMUS_DIARY_SECRET");
  if (!secret) return reply("Webhook not configured", 503);
  try {
    const { payload, sign } = await readPayload(req);
    if (!isRecord(payload) || !(await validSignature(payload, secret, asText(sign)))) { console.warn("diary_webhook_signature_rejected"); return reply("Invalid signature", 401); }
    const status = asText(payload.payment_status).toLowerCase();
    if (status !== "success") { console.info("diary_webhook_non_payment_event"); return reply("success"); }
    if (asText(payload.demo_mode) === "1" || asText(payload.demo_mode).toLowerCase() === "true") {
      console.info("diary_webhook_verified_demo_ignored");
      return reply("success"); // explicit exclusion of demo transactions
    }
    const products = Array.isArray(payload.products) ? payload.products : [];
    if (products.length !== 1 || !isRecord(products[0])) return reply("success"); // other products not part of the diary
    const name = asText(products[0].name);
    const six = name.includes("Дневнику состояний и настроений") && /на 6 месяцев/.test(name);
    const twelve = name.includes("Дневнику состояний и настроений") && /на 12 месяцев/.test(name);
    if (!six && !twelve) return reply("success");
    const months = six ? 6 : 12;
    const email = cleanEmail(payload.customer_email);
    const order = asText(payload.order_id || payload.order_num).trim();
    const kopecks = money(payload.sum);
    const paidAt = parseDate(payload.date);
    const startPresale = Date.parse("2026-12-15T00:00:00+03:00");
    const endPresale = Date.parse("2027-01-01T00:00:00+03:00");
    const presale = paidAt !== null && +paidAt >= startPresale && +paidAt < endPresale;
    const regular = paidAt !== null && +paidAt >= endPresale;
    const expected = presale ? (six ? 49000 : 89000) : regular ? (six ? 99000 : 149000) : null;
    if (!order || order.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || kopecks !== expected) {
      return reply("Diary payment requires manual review", 422);
    }
    const start = presale ? moscowStart() : paidAt;
    const end = presale ? new Date(six ? "2027-07-01T00:00:00+03:00" : "2028-01-01T00:00:00+03:00") : addMonthsUtc(start, months);
    const admin = adminClient();
    const { data: existing, error: lookupError } = await admin.from("diary_paid_orders").select("order_number,customer_email,amount_rub,tariff_months").eq("order_number", order).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      if (existing.customer_email !== email || existing.amount_rub !== kopecks / 100 || existing.tariff_months !== months) {
        return reply("Conflicting duplicate order", 409);
      }
      return reply("success"); // idempotent, never extends an already credited order
    }
    const { error } = await admin.from("diary_paid_orders").insert({
      order_number: order, customer_email: email, tariff_months: months, amount_rub: kopecks / 100,
      payment_status: "paid", is_demo: false, paid_at: paidAt.toISOString(),
      starts_at: start.toISOString(), ends_at: end.toISOString()
    });
    if (error) {
      if (error.code === "23505") return reply("success");
      throw error;
    }
    return reply("success");
  } catch (error) {
    console.error("Diary webhook failed", error instanceof Error ? error.name : "unknown");
    return reply("Processing failed", 500);
  }
});
