import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
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
  const inFlight = useRef<{ id: string | null; promise: Promise<MobileAccess | null> } | null>(null);
  const [state, setState] = useState<{ userId: string | null; access: MobileAccess | null; ready: boolean; error: string | null }>({ userId: null, access: null, ready: false, error: null });
  const refresh = useCallback(() => {
    const id = current.current;
    if (inFlight.current?.id === id) return inFlight.current.promise;
    const request = ++generation.current;
    const promise = (async () => {
      if (!id) { setState({ userId: null, access: null, ready: true, error: null }); return null; }
      try {
        const access = await readMobileAccess();
        if (current.current === id && generation.current === request) setState({ userId: id, access, ready: true, error: null });
        return current.current === id ? access : null;
      } catch (error) {
        if (current.current === id && generation.current === request) setState(previous => {
          // A transient outage must not eject a member with a still-valid grant.
          // Access remains server-enforced; explicit 402s clear this state below.
          const valid = previous.userId === id && previous.access?.active &&
            (!previous.access.expiresAt || Date.parse(previous.access.expiresAt) > Date.now());
          return { userId: id, access: valid ? previous.access : null, ready: true, error: valid ? null : error instanceof Error ? error.message : 'Could not check access.' };
        });
        return null;
      }
    })();
    inFlight.current = { id, promise };
    void promise.finally(() => { if (inFlight.current?.promise === promise) inFlight.current = null; });
    return promise;
  }, []);
  useEffect(() => {
    client.clear();
    void refresh();
    return () => { generation.current++; inFlight.current = null; };
  }, [userId, refresh, client]);
  useEffect(() => {
    const stopOnline = onlineManager.subscribe(online => { if (online && AppState.currentState === 'active') void refresh(); });
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 60000);
    const stop = onSubscriptionRequired(() => {
      generation.current++;
      inFlight.current = null;
      setState({ userId: current.current, access: null, ready: true, error: null });
      client.clear();
      void refresh();
    });
    return () => { listener.remove(); clearInterval(timer); stop(); stopOnline(); };
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
