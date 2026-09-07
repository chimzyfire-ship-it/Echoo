import type { Session, User } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import type { EchooProfile } from '@/src/models';
import { loadProfile } from '@/src/services/auth';
import { supabase } from '@/src/services/supabase';

type AuthContextValue = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  profile: EchooProfile | null;
  profileError: string | null;
  refreshProfile: () => Promise<EchooProfile | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<EchooProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const activeUserId = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  async function hydrateProfile(nextSession: Session | null) {
    const request = ++generation.current;
    const user = nextSession?.user ?? null;
    activeUserId.current = user?.id ?? null;
    if (!user) {
      setProfile(null);
      setProfileError(null);
      setReady(true);
      return null;
    }

    try {
      const nextProfile = await loadProfile(user);
      if (mounted.current && generation.current === request) {
        setProfile(nextProfile);
        setProfileError(null);
      }
      if (!mounted.current || generation.current !== request) throw new Error('Authentication changed. Please try again.');
      return nextProfile;
    } catch (error) {
      if (mounted.current && generation.current === request) {
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
    const userId = activeUserId.current;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!mounted.current || activeUserId.current !== userId || !data.session || data.session.user.id !== userId) {
      throw new Error('Authentication changed. Please try again.');
    }
    setSession(data.session);
    return hydrateProfile(data.session ?? null);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    generation.current += 1;
    activeUserId.current = null;
    setSession(null);
    setProfile(null);
    setProfileError(null);
    setReady(true);
  }

  useEffect(() => {
    mounted.current = true;
    let initialized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted.current) return;
      setSession(nextSession);
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
        void hydrateProfile(nextSession).catch(() => {});
      }, 0);
    });

    return () => {
      mounted.current = false;
      generation.current += 1;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
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
