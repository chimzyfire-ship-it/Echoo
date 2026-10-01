import 'react-native-url-polyfill/auto';

import { createClient, processLock } from '@supabase/supabase-js';
import { fetchWithDeadline } from '@/src/services/request';
import { sessionStorage } from '@/src/services/session-storage';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://dlezregdjpdqmooubwvl.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH';

export const echooConfig = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
};

export const SESSION_STORAGE_KEY = 'echoo.auth.session';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: fetchWithDeadline },
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: sessionStorage,
    storageKey: SESSION_STORAGE_KEY,
    lock: processLock,
  },
});
