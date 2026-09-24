import { mobileDb, mobileHeaders, mobileJson, mobileUser, syncMobileSubscription } from '../_shared/mobile-access.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: mobileHeaders });
  if (req.method !== 'POST') return mobileJson({ error: 'Method not allowed' }, 405);
  const user = await mobileUser(req);
  if (!user) return mobileJson({ error: 'Sign in to continue.' }, 401);
  try {
    const db = mobileDb();
    const { data: access, error } = await db.rpc('mobile_access_for', { p_user: user.id });
    if (error) throw error;
    if (access.active && access.source !== 'subscription') return mobileJson(access);
    const { data: allowed, error: rateError } = await db.rpc('reserve_mobile_sync', { p_user: user.id });
    if (rateError) throw rateError;
    if (!allowed) return mobileJson({ error: 'Please wait a minute before checking your subscription again.' }, 429);
    await syncMobileSubscription(user.id);
    const result = await db.rpc('mobile_access_for', { p_user: user.id });
    if (result.error) throw result.error;
    return mobileJson(result.data);
  } catch (error) {
    return mobileJson({ error: error instanceof Error ? error.message : 'Could not verify subscription.' }, 503);
  }
});
