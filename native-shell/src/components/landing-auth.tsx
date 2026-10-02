import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { appleSignInAvailable, signInWithApple } from '@/src/services/apple-auth';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PrimaryButton } from '@/src/components/primary-button';
import { TextField } from '@/src/components/text-field';
import { useAuth } from '@/src/providers/auth-provider';
import { isValidUsername, normalizeUsername, resolveLoginEmail } from '@/src/services/auth';
import { supabase } from '@/src/services/supabase';
import { googleSetupLimitation, signInWithGoogle } from '@/src/services/google-auth';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';

type Mode = 'signin' | 'signup';

export function LandingAuth({ open, initialMode = 'signin', onOpen, onClose }: {
  open: boolean;
  initialMode?: Mode;
  onOpen: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { refreshProfile, beginAuthFlow, endAuthFlow } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [login, setLogin] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    let active = true;
    void appleSignInAvailable().then(available => { if (active) setAppleAvailable(available); });
    return () => { active = false; };
  }, []);

  async function appleSignIn() {
    if (pending.current) return;
    pending.current = true;
    resetFeedback();
    setBusy(true);
    setAppleBusy(true);
    beginAuthFlow();
    try {
      if (await signInWithApple() === 'cancelled') return;
      const nextProfile = await refreshProfile();
      router.replace(nextProfile?.completedAt ? '/(tabs)' : '/onboarding');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not sign in with Apple.');
    } finally {
      pending.current = false;
      setBusy(false);
      setAppleBusy(false);
      endAuthFlow();
    }
  }

  async function googleSignIn() {
    if (pending.current) return;
    pending.current = true;
    resetFeedback();
    setBusy(true);
    setGoogleBusy(true);
    try {
      const result = await signInWithGoogle();
      if (result === 'cancelled') {
        setMessage('Google sign-in cancelled. You can try again or use email.');
        return;
      }
      const nextProfile = await refreshProfile();
      router.replace(nextProfile?.completedAt ? '/(tabs)' : '/onboarding');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not sign in with Google.');
    } finally {
      pending.current = false;
      setBusy(false);
      setGoogleBusy(false);
    }
  }

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function signIn() {
    if (pending.current) return;
    resetFeedback();
    if (!login.trim() || !password) {
      setError('Enter your username or email and password.');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const signInEmail = await resolveLoginEmail(login);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password,
      });
      if (signInError) throw new Error('Invalid username or password.');
      const nextProfile = await refreshProfile();
      router.replace(nextProfile?.completedAt ? '/(tabs)' : '/onboarding');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not sign in.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function sendSignupCode() {
    if (pending.current) return;
    resetFeedback();
    const cleanUsername = normalizeUsername(username);
    if (!isValidUsername(cleanUsername) || cleanUsername !== username.trim()) {
      setError('Use 3-24 lowercase letters, numbers, or underscores for your username.');
      return;
    }
    if (!displayName.trim() || !email.trim()) {
      setError('Add your name and email to create an account.');
      return;
    }
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (!hasConsent) {
      setError('Agree to the Privacy Policy and Terms of Service to create an account.');
      return;
    }

    pending.current = true;
    setBusy(true);
    try {
      if (codeSent) {
        const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
        if (resendError) throw resendError;
        setMessage('A new verification code has been sent.');
        return;
      }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim(), username: cleanUsername },
        },
      });
      if (signUpError) throw signUpError;
      if (data.session) {
        const nextProfile = await refreshProfile();
        router.replace(nextProfile?.completedAt ? '/(tabs)' : '/onboarding');
        return;
      }
      setCodeSent(true);
      setMessage('Check your inbox for Echoo’s verification code and enter it here.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Echoo could not send a verification code.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (pending.current) return;
    resetFeedback();
    if (!code.trim()) {
      setError('Enter the verification code from your email.');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'signup',
      });
      if (verifyError) throw verifyError;
      const nextProfile = await refreshProfile();
      router.replace(nextProfile?.completedAt ? '/(tabs)' : '/onboarding');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'That code is invalid or expired.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

function AppleLogo({ size = 19, color = '#000000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 170 170">
      <Path
        fill={color}
        d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.6-7.71-11.71-14.02-6.53-10.01-11.75-20.93-15.66-32.76-3.92-11.83-5.88-23.01-5.88-33.53 0-14.15 3.7-25.79 11.11-34.92 7.4-9.13 16.75-13.8 28.04-14.01 4.57 0 9.79 1.19 15.67 3.59 5.88 2.4 9.9 3.69 12.06 3.89 1.74-.2 5.99-1.58 12.74-4.13 6.74-2.55 12.18-3.7 16.31-3.47 12.62.65 22.84 5.33 30.67 14.02-11.09 6.74-16.53 16.1-16.31 28.06.22 9.57 3.81 17.51 10.77 23.82 6.96 6.31 15.23 9.9 24.8 10.77-2.17 6.74-4.89 13.71-8.16 20.91zM119.22 31.95c0-6.96 2.5-13.38 7.51-19.25 5.01-5.88 11.21-9.69 18.6-11.42 0 .87.05 1.74.05 2.61 0 6.74-2.61 13.27-7.83 19.58-5.22 6.31-11.42 9.9-18.6 10.77-.11-.76-.23-1.52-.23-2.29z"
      />
    </Svg>
  );
}

  return (
    <View style={styles.content}>
      {appleAvailable ? (
        <View
          style={styles.appleButtonWrap}
          pointerEvents={busy ? 'none' : 'auto'}
          accessibilityState={{ busy, disabled: busy }}
        >
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={28}
            style={styles.appleButton}
            onPress={() => { void appleSignIn(); }}
          />
          {appleBusy ? (
            <View style={styles.appleLoadingOverlay} pointerEvents="none">
              <ActivityIndicator size="small" color="#000000" />
              <Text style={styles.appleLoadingText}>Connecting to Apple...</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with Apple"
          onPress={() => { void appleSignIn(); }}
          style={({ pressed }) => [
            styles.customAppleButton,
            pressed && styles.actionPressed,
            busy && styles.buttonDisabled,
          ]}
          disabled={busy}
        >
          {appleBusy ? (
            <View style={styles.appleButtonInner}>
              <ActivityIndicator size="small" color="#000000" />
              <Text style={styles.customAppleButtonText}>Connecting to Apple...</Text>
            </View>
          ) : (
            <View style={styles.appleButtonInner}>
              <AppleLogo size={19} color="#000000" />
              <Text style={styles.customAppleButtonText}>Continue with Apple</Text>
            </View>
          )}
        </Pressable>
      )}
      <PrimaryButton
        label={googleBusy ? 'Connecting to Google...' : 'Continue with Google'}
        onPress={googleSignIn}
        variant="secondary"
        size="lg"
        loading={googleBusy}
        disabled={busy || Boolean(googleSetupLimitation)}
      />
      {!open ? (
        <PrimaryButton label="Sign in with email" onPress={onOpen} variant="quiet" disabled={busy} />
      ) : <>
      <View style={styles.switcher}>
        {(['signin', 'signup'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === option }}
            disabled={busy}
            onPress={() => {
              setMode(option);
              setCodeSent(false);
              resetFeedback();
            }}
            style={[styles.tab, mode === option && styles.tabActive]}
          >
            <Text style={[styles.tabText, mode === option && styles.tabTextActive]}>
              {option === 'signin' ? 'Sign in' : 'Create account'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.form} pointerEvents={busy ? 'none' : 'auto'}>
        {mode === 'signin' ? (
          <>
            <TextField
              label="Username or email"
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="yourname or you@email.com"
              returnKeyType="next"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="Your password"
              returnKeyType="go"
              onSubmitEditing={signIn}
            />
            <PrimaryButton label="Sign in" onPress={signIn} loading={busy} />
          </>
        ) : (
          <>
            <TextField
              label="Name"
              editable={!codeSent}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="How should Echoo call you?"
              autoCapitalize="words"
            />
            <TextField
              label="Username"
              editable={!codeSent}
              value={username}
              onChangeText={(value) => setUsername(normalizeUsername(value))}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="lowercase only"
              hint="3-24 lowercase letters, numbers, or underscores"
            />
            <TextField
              label="Email"
              editable={!codeSent}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@email.com"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="At least 8 characters"
              editable={!codeSent}
              hint="Use a password with at least 8 characters."
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: hasConsent }}
              onPress={() => setHasConsent((current) => !current)}
              style={styles.consent}
            >
              <View style={[styles.checkbox, hasConsent && styles.checkboxChecked]}>
                {hasConsent ? <Text style={styles.check}>✓</Text> : null}
              </View>
              <Text style={styles.consentText}>I agree to Echoo’s Privacy Policy and Terms of Service.</Text>
            </Pressable>
            {codeSent ? (
              <>
                <TextField
                  label="Verification code"
                  value={code}
                  autoComplete="one-time-code"
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  placeholder="Code from your email"
                />
                <PrimaryButton label="Verify and continue" onPress={verifyCode} loading={busy} />
                <PrimaryButton label="Send a new code" onPress={sendSignupCode} variant="quiet" disabled={busy} />
              </>
            ) : (
              <PrimaryButton label="Send verification code" onPress={sendSignupCode} loading={busy} />
            )}
          </>
        )}
      </View>
      <PrimaryButton label="Close email sign-in" onPress={onClose} variant="quiet" disabled={busy} />
      </>}
      {googleSetupLimitation ? <Text style={styles.subtle}>{googleSetupLimitation}</Text> : null}
      {error ? <Text selectable accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {message ? <Text selectable accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.md,
  },
  subtle: {
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  switcher: {
    flexDirection: 'row',
    gap: 5,
    borderRadius: 14,
    borderCurve: 'continuous',
    padding: 4,
    backgroundColor: 'rgba(24, 22, 20, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: Colors.surfaceElevated,
  },
  tabText: {
    color: Colors.textMuted,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: Colors.ink,
  },
  form: {
    gap: Spacing.md,
  },
  consent: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.18)',
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: Colors.cardAccent,
    borderColor: Colors.cardAccentBorder,
  },
  check: {
    color: Colors.inkDark,
    fontWeight: '900',
    fontSize: 14,
  },
  consentText: {
    flex: 1,
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  message: {
    color: Colors.peachLight,
    fontFamily: Fonts.ui,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.peachSubtle,
    padding: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  appleButtonWrap: {
    position: 'relative',
    width: '100%',
    height: 56,
  },
  appleButton: {
    width: '100%',
    height: 56,
  },
  appleLoadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  appleLoadingText: {
    color: '#000000',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
  },
  customAppleButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  customAppleButtonText: {
    color: '#000000',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  actionPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
