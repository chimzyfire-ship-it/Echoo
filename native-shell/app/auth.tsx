import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { PrimaryButton } from '@/src/components/primary-button';
import { TextField } from '@/src/components/text-field';
import { useAuth } from '@/src/providers/auth-provider';
import { isValidUsername, normalizeUsername, resolveLoginEmail } from '@/src/services/auth';
import { supabase } from '@/src/services/supabase';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';

type Mode = 'signin' | 'signup';

export default function AuthScreen() {
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [login, setLogin] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && profile?.completedAt) router.replace('/(tabs)');
  }, [profile?.completedAt, router, user]);

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function signIn() {
    resetFeedback();
    if (!login.trim() || !password) {
      setError('Enter your username or email and password.');
      return;
    }
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
      setBusy(false);
    }
  }

  async function sendSignupCode() {
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

    setBusy(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim(), username: cleanUsername },
          emailRedirectTo: Linking.createURL('/auth'),
        },
      });
      if (signUpError) throw signUpError;
      setCodeSent(true);
      setMessage('Check your inbox for Echoo’s verification code or confirmation link.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Echoo could not send a verification code.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    resetFeedback();
    if (!code.trim()) {
      setError('Enter the verification code from your email.');
      return;
    }
    setBusy(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'signup',
      });
      if (verifyError) throw verifyError;
      await refreshProfile();
      router.replace('/onboarding');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'That code is invalid or expired.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <BrandMark />
      <View style={styles.heading}>
        <Text style={styles.kicker}>{mode === 'signin' ? 'WELCOME BACK' : 'MAKE IT YOURS'}</Text>
        <Text style={styles.title}>{mode === 'signin' ? 'Your next good night is waiting.' : 'Start with a better way to go out.'}</Text>
        <Text style={styles.subtle}>
          {mode === 'signin'
            ? 'Sign in to pick up your plans, passes, and saved places.'
            : 'Create an Echoo account, verify your email, then set your taste.'}
        </Text>
      </View>

      <View style={styles.switcher}>
        {(['signin', 'signup'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === option }}
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

      <View style={styles.form}>
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
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="How should Echoo call you?"
              autoCapitalize="words"
            />
            <TextField
              label="Username"
              value={username}
              onChangeText={(value) => setUsername(normalizeUsername(value))}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="lowercase only"
              hint="3-24 lowercase letters, numbers, or underscores"
            />
            <TextField
              label="Email"
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

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: 44,
    gap: Spacing['2xl'],
  },
  heading: {
    gap: 6,
  },
  kicker: {
    color: 'rgba(248, 245, 239, 0.45)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 35,
    letterSpacing: -0.8,
  },
  subtle: {
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 15,
    lineHeight: 22,
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
});
