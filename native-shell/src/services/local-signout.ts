import type { Session } from '@supabase/supabase-js';
import { processLock } from '@supabase/supabase-js';
import { sessionStorage } from './session-storage';
import { echooConfig, SESSION_STORAGE_KEY, supabase } from './supabase';
import { interruptSessionRefresh, runRequest } from './request';

let pending: Promise<Session | null> | null = null;
export function signOutOnDevice(): Promise<Session | null> {
  if (pending) return pending;
  pending = (async () => {
    const raw = await sessionStorage.getItem(SESSION_STORAGE_KEY);
    let previous: Session | null = null;
    try { previous = raw ? JSON.parse(raw) : null; } catch { /* A corrupt session can still be removed. */ }
    const resume = interruptSessionRefresh();
    try {
      await supabase.auth.stopAutoRefresh();
      // Use the same lock as the SDK: an old refresh must finish before removal,
      // and cannot write the previous session back after the user signs out.
      await processLock(`lock:${SESSION_STORAGE_KEY}`, 5000, async () => {
        await sessionStorage.removeItem(SESSION_STORAGE_KEY);
        await sessionStorage.removeItem(`${SESSION_STORAGE_KEY}-code-verifier`);
        await sessionStorage.removeItem(`${SESSION_STORAGE_KEY}-user`);
      });
      // With storage cleared, the SDK emits SIGNED_OUT without refreshing an
      // expired token or requiring a network call. No private SDK APIs are used.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      return previous;
    } finally { resume(); }
  })().finally(() => { pending = null; });
  return pending;
}

export async function revokePreviousSession(accessToken: string) {
  // Remote revocation is best effort; it never gates local sign-out and only
  // targets the captured old session, not a subsequent sign-in.
  await runRequest(signal => fetch(`${echooConfig.supabaseUrl}/auth/v1/logout?scope=local`, {
    method: 'POST', signal,
    headers: { apikey: echooConfig.supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
  }), { timeoutMs: 3000 });
}
