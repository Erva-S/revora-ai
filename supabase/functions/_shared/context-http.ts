import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { ContextError, safeError } from './context-utils.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
export function errorResponse(error: unknown): Response {
  const message = safeError(error);
  console.error(`[Context] ${message}`);
  return json({ success: false, error: message }, error instanceof ContextError ? error.status : 500);
}
export async function readBody(req: Request): Promise<Record<string, any>> {
  let body;
  try { body = await req.json(); } catch { throw new ContextError('Request body must be valid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ContextError('Expected a JSON object.', 400);
  return body;
}
export async function authenticate(req: Request, allowService = false) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key || !anonKey) throw new ContextError('Context authorization is not configured.');
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) throw new ContextError('Authentication required.', 401);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, key, options);
  // Compare to the actual secret, never trust an unverified JWT's role claim.
  if (allowService && bearer === key) return { admin, user: null, userId: null, isAdmin: false, isService: true };
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) throw new ContextError('Invalid user session.', 401);
  const { data: profile, error: roleError } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (roleError) throw new ContextError('Unable to verify account role.');
  const user = createClient(url, anonKey, { ...options, global: { headers: { Authorization: `Bearer ${bearer}` } } });
  return { admin, user, userId: data.user.id, isAdmin: profile?.role === 'admin', isService: false };
}
