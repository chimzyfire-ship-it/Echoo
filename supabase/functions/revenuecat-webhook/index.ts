import { mobileDb, mobileJson, syncMobileSubscription } from '../_shared/mobile-access.ts';
Deno.serve(async (req) => {
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return mobileJson({ error: 'Unauthorized' }, 401);
  if (req.method !== 'POST') return mobileJson({ error: 'Method not allowed' }, 405);
  try {
    const { event } = await req.json();
    if (!event?.id || !event?.type) return mobileJson({ error: 'Invalid event' }, 400);
    if (event.type === 'TEST') return mobileJson({ received: true });
    const ids = [...new Set([event.app_user_id, event.original_app_user_id, ...(event.aliases || []), ...(event.transferred_from || []), ...(event.transferred_to || [])])]
      .filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    for (const id of ids) {
      const { data, error } = await mobileDb().auth.admin.getUserById(id);
      if (error && error.status !== 404) throw error;
      if (data.user) await syncMobileSubscription(id);
    }
    return mobileJson({ received: true });
  } catch {
    // Non-2xx makes RevenueCat retry; never acknowledge a failed reconciliation.
    return mobileJson({ error: 'Reconciliation failed; retry required.' }, 503);
  }
});
