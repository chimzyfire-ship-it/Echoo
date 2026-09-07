import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://dlezregdjpdqmooubwvl.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH';

const sessionValues = new Map<string, string>();

// Echoo intentionally keeps credentials scoped to the current app process.
// This mirrors the web client's sessionStorage-backed auth behavior.
const sessionStorage = {
  getItem: async (key: string) => sessionValues.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    sessionValues.set(key, value);
  },
  removeItem: async (key: string) => {
    sessionValues.delete(key);
  },
};

export const echooConfig = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: sessionStorage,
    storageKey: 'echoo.auth.session',
  },
});
