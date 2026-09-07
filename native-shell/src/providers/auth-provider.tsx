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

  async function hydrateProfile(nextSession: Session | null) {
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
      if (activeUserId.current === user.id) {
        setProfile(nextProfile);
        setProfileError(null);
      }
      return nextProfile;
    } catch (error) {
      if (activeUserId.current === user.id) {
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : 'Echoo could not load this profile.');
      }
      return null;
    } finally {
      if (activeUserId.current === user.id) setReady(true);
    }
  }

  async function refreshProfile() {
    // Always read the freshest session from Supabase: closures rendered before
    // a sign-in would otherwise hydrate against the pre-login (null) session
    // and wrongly route completed members back into onboarding.
    const { data } = await supabase.auth.getSession();
    return hydrateProfile(data.session ?? null);
  }

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' });
    setSession(null);
    setProfile(null);
    setProfileError(null);
  }

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      void hydrateProfile(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setReady(false);
      void hydrateProfile(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => subscription.remove();
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
