import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { EchooLocation } from '@/src/models';
import { DEFAULT_LOCATION, manualMunicipalityLocation } from '@/src/services/location';
import { resolveLocationContext } from '@/src/services/api';
import { bounded, deviceLocation, DeviceLocationError } from '@/src/services/device-location';

type LocationContextValue = {
  location: EchooLocation;
  isResolving: boolean;
  error: string | null;
  needsSettings: boolean;
  chooseMunicipality: (city: string) => boolean;
  useDeviceLocation: () => Promise<boolean>;
};
const STORAGE_KEY = 'echoo:location:city:v1';
const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<EchooLocation>(DEFAULT_LOCATION);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSettings, setNeedsSettings] = useState(false);
  const locationRequest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const fallback = useRef(DEFAULT_LOCATION);
  const wantsDevice = useRef(false);
  const lastAttempt = useRef(0);
  const writes = useRef(Promise.resolve());

  function saveCity(city: string) {
    // Serialize writes so a slow earlier save cannot replace the latest choice.
    writes.current = writes.current.then(() => AsyncStorage.setItem(STORAGE_KEY, city)).catch(() => {});
  }

  function cancel() {
    locationRequest.current += 1;
    controller.current?.abort();
    controller.current = null;
    setIsResolving(false);
  }

  function chooseMunicipality(city: string) {
    const nextLocation = manualMunicipalityLocation(city);
    if (!nextLocation) {
      setError('Choose a listed Ontario city or GTA municipality.');
      return false;
    }
    cancel();
    wantsDevice.current = false;
    fallback.current = nextLocation;
    setError(null);
    setNeedsSettings(false);
    setLocation(nextLocation);
    saveCity(nextLocation.city);
    return true;
  }

  async function useDeviceLocation(prompt = true) {
    cancel();
    const request = locationRequest.current;
    const abort = new AbortController();
    controller.current = abort;
    wantsDevice.current = true;
    lastAttempt.current = Date.now();
    setIsResolving(true);
    setError(null);
    setNeedsSettings(false);
    try {
      const position = await deviceLocation({ prompt, signal: abort.signal });
      if (request !== locationRequest.current) return false;
      const context = await bounded(resolveLocationContext({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? undefined,
      }, abort.signal), abort.signal);
      if (request !== locationRequest.current) return false;
      if (!context.supported) throw new Error(context.message || 'Choose a location in Ontario.');
      setLocation({
        mode: 'gps',
        city: context.municipality || 'Ontario',
        label: context.label || 'Near you in Ontario',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: context.accuracyMeters ?? position.coords.accuracy ?? undefined,
      });
      // Save only a verified selectable city, never device coordinates or GPS consent.
      const city = manualMunicipalityLocation(context.municipality || '');
      if (city) { fallback.current = city; saveCity(city.city); }
      return true;
    } catch (nextError) {
      if (request !== locationRequest.current) return false;
      setLocation(fallback.current);
      setNeedsSettings(nextError instanceof DeviceLocationError && ['permission', 'services'].includes(nextError.code));
      setError(nextError instanceof Error ? nextError.message : 'Could not find your location. Try again or choose a city.');
      return false;
    } finally {
      abort.abort();
      if (request === locationRequest.current) { controller.current = null; setIsResolving(false); }
    }
  }

  useEffect(() => {
    let mounted = true;
    const initialRequest = locationRequest.current;
    void AsyncStorage.getItem(STORAGE_KEY).then(city => {
      if (!mounted || locationRequest.current !== initialRequest || !city) return;
      const saved = manualMunicipalityLocation(city);
      if (saved) { fallback.current = saved; setLocation(saved); }
    }).catch(() => {});
    let wasBackground = AppState.currentState === 'background';
    const listener = AppState.addEventListener('change', state => {
      // iOS permission dialogs cause "inactive"; don't cancel the user's prompt.
      if (state === 'background') {
        wasBackground = true;
        cancel();
        setLocation(fallback.current);
      } else if (state === 'active' && wasBackground) {
        wasBackground = false;
        if (wantsDevice.current) void useDeviceLocation(false);
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && wantsDevice.current && !controller.current && Date.now() - lastAttempt.current >= 5 * 60000) {
        void useDeviceLocation(false);
      }
    }, 30000);
    return () => {
      mounted = false;
      locationRequest.current += 1;
      controller.current?.abort();
      listener.remove();
      clearInterval(timer);
    };
  }, []);

  return <LocationContext.Provider value={{ location, isResolving, error, needsSettings, chooseMunicipality, useDeviceLocation }}>{children}</LocationContext.Provider>;
}

export function useEchooLocation() {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useEchooLocation must be used inside LocationProvider.');
  return value;
}
