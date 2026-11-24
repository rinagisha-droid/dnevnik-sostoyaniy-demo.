import { createClient } from "npm:@supabase/supabase-js@2.119.1";

// Redeem only invoices sent by a verified Prodamus webhook.
// The account identity comes ONLY from Supabase Auth, never from request body.
const allowedOrigin = "https://rinagisha-droid.github.io";
function headers(req) {
 const origin = req.headers.get("Origin");
 return {
   "Content-Type": "application/json; charset=utf-8",
   "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
   "Access-Control-Allow-Methods": "POST, OPTIONS",
   "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
   "Vary": "Origin",
   "Cache-Control": "no-store"
 };
}
function respond(req, value, status=200) {return new Response(JSON.stringify(value), { status, headers: headers(req) });}
function adminClient() {
 const url = Deno.env.get("SUPABASE_URL");
 const modern = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
 const key = modern.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if (!url || !key) throw Error("Server admin credentials missing");
 return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
Deno.serve(async (req) => {
 if (req.method === "OPTIONS") return new Response(null, {status:204, headers: headers(req)});
 if (req.method !== "POST") return respond(req, {error:"method_not_allowed"},405);
 const bearer = req.headers.get("Authorization") || "";
 const token = bearer.match(/^Bearer (\S+)$/i)?.[1];
 if (!token) return respond(req,{error:"login_required"},401);
 try {
   const admin = adminClient();
   const {data:userData,error:userError} = await admin.auth.getUser(token);
   const user=userData?.user;
   if(userError || !user?.id || !user.email_confirmed_at || !user.email) {
     return respond(req,{error:"verified_account_required"},401);
   }
   const email=user.email.trim().toLowerCase();
   const {data:orders,error:findError}=await admin.from("diary_paid_orders")
     .select("order_number").eq("customer_email",email).eq("payment_status","paid")
     .eq("is_demo",false).is("owner_id",null).limit(25);
   if(findError) throw findError;
   let claimed=0;
   for(const order of orders || []) {
     const {data:changed,error:updateError}=await admin.from("diary_paid_orders")
       .update({owner_id:user.id})
       .eq("order_number",order.order_number).is("owner_id",null)
       .eq("customer_email",email).select("order_number");
     if(updateError) throw updateError;
     claimed += changed?.length || 0;
   }
   const {data:current,error:readError}=await admin.from("diary_paid_orders")
     .select("tariff_months,starts_at,ends_at")
     .eq("owner_id",user.id).eq("payment_status","paid").eq("is_demo",false)
     .order("ends_at",{ascending:false});
   if(readError) throw readError;
   const access=(current||[]).map(item=>({
     months:item.tariff_months, starts_at:item.starts_at, ends_at:item.ends_at,
     active:Date.now()>=Date.parse(item.starts_at) && Date.now()<Date.parse(item.ends_at)
   }));
   return respond(req,{claimed,access});
 }catch(error){
   console.error("Diary access claim failed",error instanceof Error?error.name:"unknown");
   return respond(req,{error:"temporarily_unavailable"},503);
 }
});
