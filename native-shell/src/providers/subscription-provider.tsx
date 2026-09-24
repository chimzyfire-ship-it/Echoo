import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth-provider';
import { readMobileAccess, type MobileAccess } from '../services/subscriptions';
import { onSubscriptionRequired } from '../services/subscription-events';

type Value = { access: MobileAccess | null; ready: boolean; error: string | null; refresh: () => Promise<MobileAccess | null> };
const Context = createContext<Value | null>(null);
export function SubscriptionProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const client = useQueryClient();
  const userId = user?.id ?? null;
  const current = useRef(userId); current.current = userId;
  const generation = useRef(0);
  const [state, setState] = useState<{ userId: string | null; access: MobileAccess | null; ready: boolean; error: string | null }>({ userId: null, access: null, ready: false, error: null });
  const refresh = useCallback(async () => {
    const id = current.current, request = ++generation.current;
    if (!id) { setState({ userId: null, access: null, ready: true, error: null }); return null; }
    try {
      const access = await readMobileAccess();
      if (current.current === id && generation.current === request) setState({ userId: id, access, ready: true, error: null });
      return current.current === id ? access : null;
    } catch (error) {
      if (current.current === id && generation.current === request) setState({ userId: id, access: null, ready: true, error: error instanceof Error ? error.message : 'Could not check access.' });
      return null;
    }
  }, []);
  useEffect(() => {
    client.clear();
    void refresh();
    return () => { generation.current++; };
  }, [userId, refresh, client]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 60000);
    const stop = onSubscriptionRequired(() => {
      generation.current++;
      setState({ userId: current.current, access: null, ready: true, error: null });
      client.clear();
      void refresh();
    });
    return () => { listener.remove(); clearInterval(timer); stop(); };
  }, [refresh, client]);
  const sameUser = state.userId === userId;
  // Evaluate expiry at render time too; never rely on a persisted client flag.
  const access = sameUser && state.access ? { ...state.access, active: state.access.active && (!state.access.expiresAt || Date.parse(state.access.expiresAt) > Date.now()) } : null;
  return <Context.Provider value={{ access, ready: sameUser && state.ready, error: sameUser ? state.error : null, refresh }}>{children}</Context.Provider>;
}
export function useSubscription() {
  const context = useContext(Context);
  if (!context) throw new Error('SubscriptionProvider is missing.');
  return context;
}
