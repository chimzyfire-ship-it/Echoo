import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

import { SurpriseOverlay } from '@/src/components/surprise/surprise-overlay';
import { useAuth } from '@/src/providers/auth-provider';
import { useCulture } from '@/src/providers/culture-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import { getDiscovery } from '@/src/services/api';
import { cultureQueryFor } from '@/src/services/culture';
import { cachePlace } from '@/src/services/place-cache';
import { pickSurprise, timeContext } from '@/src/services/surprise';
import { triggerHaptic } from '@/src/utils/haptics';

export type SurprisePhase = 'idle' | 'rolling' | 'matching' | 'settling' | 'closing';

type SurpriseContextValue = {
  phase: SurprisePhase;
  city: string;
  timeLabel: string;
  start: () => void;
  cancel: () => void;
  handleRollStart: () => void;
  handleRollEnd: () => void;
};

const SurpriseContext = createContext<SurpriseContextValue | null>(null);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function SurpriseProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, profile, profileError } = useAuth();
  const { active: culture } = useCulture();
  const { location } = useEchooLocation();

  const [phase, setPhase] = useState<SurprisePhase>('idle');
  const [city, setCity] = useState('Toronto');
  const [timeLabel, setTimeLabel] = useState('tonight');

  const generationRef = useRef(0);
  const activeRef = useRef(false);
  const readyResolveRef = useRef<(() => void) | null>(null);
  const rollResolveRef = useRef<(() => void) | null>(null);
  const latest = useRef({ user, profile, profileError, culture, location, router });
  latest.current = { user, profile, profileError, culture, location, router };

  const cancel = useCallback(() => {
    generationRef.current += 1;
    activeRef.current = false;
    readyResolveRef.current?.();
    readyResolveRef.current = null;
    rollResolveRef.current?.();
    rollResolveRef.current = null;
    setPhase('idle');
  }, []);

  const handleRollStart = useCallback(() => {
    readyResolveRef.current?.();
    readyResolveRef.current = null;
  }, []);

  const handleRollEnd = useCallback(() => {
    const resolve = rollResolveRef.current;
    if (!resolve) return;
    void triggerHaptic.medium();
    rollResolveRef.current = null;
    resolve?.();
  }, []);

  const start = useCallback(() => {
    const current = latest.current;
    if (activeRef.current) return;

    // Same guard rails as the root navigator: members only, onboarded members only.
    if (!current.user) {
      current.router.push('/auth');
      return;
    }
    if (!current.profile?.completedAt && !current.profileError) {
      current.router.push('/onboarding');
      return;
    }
    const memberProfile = current.profile;
    if (!memberProfile) return;

    const generation = ++generationRef.current;
    activeRef.current = true;
    const activeCulture = current.culture;
    const activeLocation = current.location;

    setCity(activeLocation.city);
    setTimeLabel(timeContext().label);
    setPhase('rolling');

    void (async () => {
      // Fetch in parallel, but give the visible die its own full roll time.
      const sceneReady = new Promise<void>((resolve) => {
        readyResolveRef.current = resolve;
      });
      const rollEnd = new Promise<void>((resolve) => {
        rollResolveRef.current = resolve;
      });
      const feedPromise = getDiscovery({
        intent: 'discover',
        query: cultureQueryFor('discover', activeCulture),
        location: activeLocation,
        cultureSlug: activeCulture?.slug,
      }).catch(() => null);

      await Promise.race([sceneReady, sleep(8000)]);
      if (generationRef.current !== generation) return;
      await sleep(3000);
      if (generationRef.current !== generation) return;
      setPhase('matching');

      const feed = await feedPromise;
      if (generationRef.current !== generation) return;

      const pool = feed
        ? [
            ...feed.nearby.items,
            ...feed.recommended.items,
            ...feed.all.items,
          ]
        : [];
      const choice = pool.length ? await pickSurprise(memberProfile, pool, activeLocation.city) : null;
      if (generationRef.current !== generation) return;

      if (choice) {
        cachePlace(choice);
        setPhase('settling');
        await Promise.race([rollEnd, sleep(1200)]);
        if (generationRef.current !== generation) return;
        setPhase('closing');
        triggerHaptic.success();
        await sleep(160); // Let the exit fade begin under the incoming modal.
        if (generationRef.current !== generation) return;
        activeRef.current = false;
        readyResolveRef.current = null;
        rollResolveRef.current = null;
        setPhase('idle');
        current.router.push({ pathname: '/place/[id]', params: { id: choice.canonicalId || choice.id } });
      } else {
        triggerHaptic.error();
        activeRef.current = false;
        readyResolveRef.current = null;
        rollResolveRef.current = null;
        setPhase('idle');
      }
    })();
  }, []);

  return (
    <SurpriseContext.Provider value={{ phase, city, timeLabel, start, cancel, handleRollStart, handleRollEnd }}>
      {children}
      <SurpriseOverlay />
    </SurpriseContext.Provider>
  );
}

export function useSurprise() {
  const value = useContext(SurpriseContext);
  if (!value) throw new Error('useSurprise must be used inside SurpriseProvider.');
  return value;
}
