import { disablePlanningNotifications, retryPushCleanup } from '@/src/services/planning-notifications';
import type { Session, User } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { assertRequestActive, runRequest } from '@/src/services/request';
import { revokePreviousSession, signOutOnDevice } from '@/src/services/local-signout';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import type { EchooProfile } from '@/src/models';
import { loadProfile } from '@/src/services/auth';
import { supabase } from '@/src/services/supabase';

type AuthContextValue = {
  ready: boolean;
  authFlow: boolean;
  beginAuthFlow: () => void;
  endAuthFlow: () => void;
  session: Session | null;
  user: User | null;
  profile: EchooProfile | null;
  profileError: string | null;
  refreshProfile: () => Promise<EchooProfile | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authFlow, setAuthFlow] = useState(false);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<EchooProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const activeUserId = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const failed = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const signingOut = useRef<Promise<void> | null>(null);

  async function hydrateProfile(nextSession: Session | null) {
    const request = ++generation.current;
    failed.current = false;
    const user = nextSession?.user ?? null;
    activeUserId.current = user?.id ?? null;
    if (!user) {
      setProfile(null);
      setProfileError(null);
      setReady(true);
      return null;
    }

    try {
      const nextProfile = await runRequest(signal => loadProfile(user, signal), { timeoutMs: 20000, message: 'Your profile is taking longer to load. Please check your connection and try again.' });
      if (mounted.current && generation.current === request) {
        setProfile(nextProfile);
        setProfileError(null);
      }
      if (!mounted.current || generation.current !== request) throw new Error('Authentication changed. Please try again.');
      return nextProfile;
    } catch (error) {
      if (mounted.current && generation.current === request) {
        failed.current = true;
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : 'Echoo could not load this profile.');
      }
      throw error;
    } finally {
      if (mounted.current && generation.current === request) setReady(true);
    }
  }

  async function refreshProfile() {
    // Always read the freshest session from Supabase: closures rendered before
    // a sign-in would otherwise hydrate against the pre-login (null) session
    // and wrongly route completed members back into onboarding.
    const request = generation.current;
    failed.current = false;
    try {
      const { data, error } = await runRequest(signal => supabase.auth.getSession().then(result => {
        assertRequestActive(signal);
        return result;
      }), { timeoutMs: 20000 });
      if (error) throw error;
      if (!mounted.current || generation.current !== request || signingOut.current) return null;
      sessionRef.current = data.session;
      setSession(data.session);
      return await hydrateProfile(data.session ?? null);
    } catch (error) {
      if (mounted.current && generation.current === request) {
        failed.current = true;
        setProfileError(error instanceof Error ? error.message : 'Could not restore your session. Please try again.');
        setReady(true);
      }
      throw error;
    }
  }

  function signOut() {
    if (signingOut.current) return signingOut.current;
    generation.current++;
    failed.current = false;
    const notificationCleanup = disablePlanningNotifications(sessionRef.current).catch(() => {});
    signingOut.current = signOutOnDevice().then(previous => {
      sessionRef.current = null;
      activeUserId.current = null;
      setSession(null);
      setProfile(null);
      setProfileError(null);
      setReady(true);
      // Neither remote cleanup nor an offline connection holds the user here.
      if (previous?.access_token) void notificationCleanup.then(() => revokePreviousSession(previous.access_token)).catch(() => {});
    }).finally(() => { signingOut.current = null; });
    return signingOut.current;
  }

  useEffect(() => {
    mounted.current = true;
    let initialized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startupTimer = setTimeout(() => {
      if (!mounted.current || initialized || generation.current > 0) return;
      failed.current = true;
      setProfileError('Could not restore your session yet. Please check your connection and try again.');
      setReady(true);
    }, 20000);
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted.current || signingOut.current) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
      clearTimeout(startupTimer);
      const userId = nextSession?.user.id ?? null;
      // Token refreshes must not blank the UI or re-run onboarding hydration.
      if (initialized && activeUserId.current === userId) return;
      initialized = true;
      activeUserId.current = userId;
      generation.current += 1;
      setProfile(null);
      setProfileError(null);
      setReady(false);
      clearTimeout(timer);
      const scheduledGeneration = generation.current;
      // Supabase holds its auth lock during callbacks. Defer authenticated I/O.
      timer = setTimeout(() => {
        if (generation.current !== scheduledGeneration) return;
        if (nextSession) void retryPushCleanup(nextSession).catch(() => {});
        void hydrateProfile(nextSession).catch(() => {});
      }, 0);
    });

    return () => {
      mounted.current = false;
      generation.current += 1;
      clearTimeout(timer);
      clearTimeout(startupTimer);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const recover = () => {
      if (sessionRef.current && onlineManager.isOnline() && AppState.currentState === 'active') void retryPushCleanup(sessionRef.current).catch(() => {});
      if (mounted.current && failed.current && !signingOut.current && AppState.currentState === 'active' && onlineManager.isOnline()) {
        void refreshProfile().catch(() => {});
      }
    };
    const stopOnline = onlineManager.subscribe(online => { if (online) recover(); });
    const stopFocus = focusManager.subscribe(focused => { if (focused) recover(); });
    return () => { stopOnline(); stopFocus(); };
  }, []);

  useEffect(() => {
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => {
      subscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ready,
        authFlow,
        beginAuthFlow: () => setAuthFlow(true),
        endAuthFlow: () => setAuthFlow(false),
        session,
        user: session?.user ?? null,
        profile,
        profileError,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
