import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const mobileHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
export const mobileJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...mobileHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export const mobileDb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
export async function mobileUser(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await mobileDb().auth.getUser(token);
  return error ? null : data.user;
}

// Always fetch RevenueCat's current state. Never trust a client receipt/status
// or apply webhook deltas in arrival order (renewals/refunds can arrive late).
export async function syncMobileSubscription(userId: string) {
  const key = Deno.env.get('REVENUECAT_SECRET_KEY');
  if (!key) throw new Error('Subscription verification is not configured yet.');
  const verifiedAt = new Date().toISOString();
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('The store could not be verified. Please try again.');
  const { subscriber } = await response.json();
  if (!subscriber || typeof subscriber.entitlements !== 'object') throw new Error('Invalid subscription verification response.');
  let plan: string | null = null, expires: string | null = null, store: string | null = null;
  for (const id of ['city_all_access', 'city_pass']) {
    const entitlement = subscriber.entitlements[id];
    const subscription = subscriber.subscriptions?.[entitlement?.product_identifier];
    // Only mobile store purchases qualify, including Apple's sandbox for review.
    if (!entitlement || !['app_store', 'play_store'].includes(subscription?.store)) continue;
    // Respect store-approved billing grace periods, not arbitrary client grace.
    const expiry = Date.parse(subscription.grace_period_expires_date || '') > Date.parse(entitlement.expires_date || '')
      ? subscription.grace_period_expires_date : entitlement.expires_date;
    if (!expiry || Date.parse(expiry) <= Date.now()) continue;
    plan = id; expires = expiry; store = subscription.store; break;
  }
  const { error } = await mobileDb().rpc('sync_mobile_subscription', { p_user: userId, p_plan: plan, p_expires: expires, p_store: store, p_verified: verifiedAt });
  if (error) throw error;
}

export async function requireMobileAccess(req: Request): Promise<Response | null> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: mobileHeaders });
  const user = await mobileUser(req);
  if (!user) return mobileJson({ error: 'Sign in to continue.', code: 'authentication_required' }, 401);
  const db = mobileDb();
  let { data: access, error } = await db.rpc('mobile_access_for', { p_user: user.id });
  if (error) return mobileJson({ error: 'Access verification is temporarily unavailable.' }, 503);
  // Reconcile active subscriptions at least every 15 minutes, in addition to webhooks.
  if (access?.active && access.source === 'subscription' && Date.now() - Date.parse(access.verifiedAt) > 900000) {
    try { await syncMobileSubscription(user.id); } catch { return mobileJson({ error: 'Could not verify your subscription. Try again shortly.' }, 503); }
    ({ data: access, error } = await db.rpc('mobile_access_for', { p_user: user.id }));
    if (error) return mobileJson({ error: 'Access verification is temporarily unavailable.' }, 503);
  }
  if (!access?.active) return mobileJson({ error: 'A subscription is required to use Echoocity.', code: 'subscription_required' }, 402);
  const { data: allowed, error: quotaError } = await db.rpc('reserve_mobile_usage', { p_user: user.id, p_bucket: 'requests' });
  if (quotaError) return mobileJson({ error: 'Usage verification is temporarily unavailable.' }, 503);
  return allowed ? null : mobileJson({ error: 'Please slow down and try again in a minute.', code: 'rate_limited' }, 429);
}

export function withMobileAccess(handler: (req: Request) => Response | Promise<Response>, bucket?: 'routes' | 'concierge') {
  return async (req: Request) => {
    try {
      const blocked = await requireMobileAccess(req);
      if (blocked) return blocked;
      const user = await mobileUser(req);
      const db = mobileDb();
      let reserved = false;
      const period = new Date().toISOString().slice(0, 7);
      let consumes = Boolean(bucket && req.method === 'POST');
      if (consumes && bucket === 'concierge') {
        const body = await req.clone().json().catch(() => null);
        if (body?.action === 'reset') consumes = false;
      }
      if (consumes) {
        const { data, error } = await db.rpc('reserve_mobile_usage', { p_user: user!.id, p_bucket: bucket });
        if (error) throw error;
        if (!data) return mobileJson({ error: 'Your monthly allowance has been used. It resets on the first of next month (UTC).', code: 'usage_limit' }, 429);
        reserved = true;
      }
      try {
        const response = await handler(req);
        if (reserved && !response.ok) await db.rpc('release_mobile_usage', { p_user: user!.id, p_bucket: bucket, p_period: period });
        return response;
      } catch (error) {
        if (reserved) await db.rpc('release_mobile_usage', { p_user: user!.id, p_bucket: bucket, p_period: period });
        throw error;
      }
    } catch (error) {
      console.error('mobile-access', error instanceof Error ? error.message : 'Verification failed');
      return mobileJson({ error: 'Echoocity could not verify this request. Please try again.' }, 503);
    }
  };
}
