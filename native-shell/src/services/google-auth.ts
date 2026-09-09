import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { echooConfig, supabase } from '@/src/services/supabase';

export const GOOGLE_REDIRECT_URL = 'echoo://auth';
export const googleSetupLimitation = Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ? 'Google sign-in needs an Echoo development or installed app; Expo Go cannot use its callback. Email sign-in works here.'
  : Platform.OS === 'web'
    ? 'Google sign-in here is configured for the Echoo mobile app. Use email on web.'
    : null;

let pending = false;

export async function signInWithGoogle(): Promise<'signed-in' | 'cancelled'> {
  if (googleSetupLimitation) throw new Error(googleSetupLimitation);
  if (pending) throw new Error('Google sign-in is already in progress.');
  pending = true;
  try {
    // Native crypto guarantees S256 even when Hermes has no Web Crypto subtle API.
    // The verifier lives only for this browser attempt, never in the redirect URL.
    const bytes = await Crypto.getRandomBytesAsync(32);
    const verifier = Array.from(bytes, (byte: number) => byte.toString(16).padStart(2, '0')).join('');
    const challenge = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const authorize = new URL(`${echooConfig.supabaseUrl}/auth/v1/authorize`);
    authorize.searchParams.set('provider', 'google');
    authorize.searchParams.set('redirect_to', GOOGLE_REDIRECT_URL);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 's256');
    const result = await WebBrowser.openAuthSessionAsync(authorize.toString(), GOOGLE_REDIRECT_URL);
    if (result.type === 'cancel' || result.type === 'dismiss') return 'cancelled';
    if (result.type !== 'success') throw new Error('Google sign-in could not open. Please try again.');
    const callback = new URL(result.url);
    if (`${callback.protocol}//${callback.host}${callback.pathname}` !== GOOGLE_REDIRECT_URL) {
      throw new Error('Unexpected Google callback. Check the Supabase redirect allowlist.');
    }
    const params = callback.searchParams;
    if (params.has('error')) throw new Error(params.get('error_description') || params.get('error')!);
    const code = params.get('code');
    if (!code) throw new Error('Google did not return an authorization code. Please try again.');
    const response = await fetch(`${echooConfig.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { apikey: echooConfig.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    const tokens = await response.json();
    if (!response.ok) throw new Error(tokens.msg || tokens.error_description || 'Google code exchange failed.');
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('Google did not establish a session.');
    const { data, error } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    if (error) throw error;
    if (!data.session) throw new Error('Could not establish your Echoo session.');
    return 'signed-in';
  } finally {
    pending = false;
  }
}
