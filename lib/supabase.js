import { loadLS } from "./storage.js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// `prefer` defaults to "return=representation" (ask PostgREST to hand back the
// row). For tables that are insert-only for anon with no SELECT policy (like
// "ideas" -- intentionally unreadable by the public key), RETURNING also gets
// checked against the SELECT policy, so it fails RLS even though the INSERT
// itself is allowed. Pass "return=minimal" for those.
export async function sb(endpoint, method = "GET", body = null, prefer = "return=representation") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}`, "Content-Type":"application/json", Prefer:prefer },
    ...(body ? { body:JSON.stringify(body) } : {}),
  });
  if (!res.ok) return [];
  try { return await res.json(); } catch { return []; }
}

// Admin writes go through the "admin" Edge Function, which checks the pincode
// server-side and uses the service-role key — the anon key alone can no longer
// write to events/bardienst (see RLS policies), so a stolen anon key is useless.
export async function adminApi(body) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
      method: "POST",
      headers: { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok:false, status:0, data:{ error:"Netwerkfout" } };
  }
}

export function getStoredSession() {
  const s = loadLS("hhc09_admin_session", null);
  if (s && s.token && s.role && s.expires_at && new Date(s.expires_at) > new Date()) return s;
  return null;
}
