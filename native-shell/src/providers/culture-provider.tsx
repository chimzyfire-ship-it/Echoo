import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { CultureCountry } from '@/src/services/culture';
import { countryFor, readStoredCulture, writeStoredCulture } from '@/src/services/culture';
import { triggerHaptic } from '@/src/utils/haptics';

type CultureContextValue = {
  hydrated: boolean;
  active: CultureCountry | null;
  setActive: (slug: string) => CultureCountry | null;
  clear: () => void;
};

const CultureContext = createContext<CultureContextValue | null>(null);

export function CultureProvider({ children }: { children: React.ReactNode }) {
  const [active, setActiveCountry] = useState<CultureCountry | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    void readStoredCulture().then((country) => {
      if (!mounted) return;
      setActiveCountry(country);
      setHydrated(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setActive = useCallback((slug: string) => {
    const country = countryFor(slug.trim().toLowerCase());
    setActiveCountry(country);
    void writeStoredCulture(country);
    void triggerHaptic.selection();
    return country;
  }, []);

  const clear = useCallback(() => {
    setActiveCountry(null);
    void writeStoredCulture(null);
    void triggerHaptic.selection();
  }, []);

  return (
    <CultureContext.Provider value={{ hydrated, active, setActive, clear }}>
      {children}
    </CultureContext.Provider>
  );
}

export function useCulture() {
  const value = useContext(CultureContext);
  if (!value) throw new Error('useCulture must be used inside CultureProvider.');
  return value;
}
