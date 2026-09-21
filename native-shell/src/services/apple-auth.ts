import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { supabase } from '@/src/services/supabase';

let pending = false;
export async function appleSignInAvailable() {
  return Platform.OS === 'ios' && await AppleAuthentication.isAvailableAsync().catch(() => false);
}

export async function signInWithApple(): Promise<'signed-in' | 'cancelled'> {
  if (pending) throw new Error('Apple sign-in is already in progress.');
  if (!await appleSignInAvailable()) throw new Error('Apple sign-in is unavailable on this device. Please use email.');
  pending = true;
  try {
    const bytes = await Crypto.getRandomBytesAsync(32);
    const nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new Error('Apple did not return a sign-in token. Please try again.');
    const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce });
    if (error) throw new Error('Could not finish Apple sign-in. Please try again.');
    if (!data.session) throw new Error('Could not establish your Echoo session.');
    // Apple sends the name only on first authorization. Never erase a saved name.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ').trim();
    if (name && !data.user?.user_metadata?.display_name) {
      await supabase.auth.updateUser({ data: { display_name: name } });
    }
    return 'signed-in';
  } catch (error) {
    if ((error as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return 'cancelled';
    throw error;
  } finally { pending = false; }
}

export async function appleDeletionCode(): Promise<string | null> {
  if (!await appleSignInAvailable()) throw new Error('Delete this Apple-linked account from Echoo on an iPhone with Apple sign-in available.');
  try {
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    if (!credential.authorizationCode) throw new Error('Apple could not confirm this request. Please try again.');
    return credential.authorizationCode;
  } catch (error) {
    if ((error as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return null;
    throw error;
  }
}
