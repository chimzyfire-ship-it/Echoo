import * as ExpoLocation from 'expo-location';
import React, { createContext, useContext, useState } from 'react';

import type { EchooLocation } from '@/src/models';
import { DEFAULT_LOCATION } from '@/src/services/location';
import { resolveLocationContext } from '@/src/services/api';

type LocationContextValue = {
  location: EchooLocation;
  isResolving: boolean;
  error: string | null;
  chooseMunicipality: (city: string) => void;
  useDeviceLocation: () => Promise<void>;
};

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<EchooLocation>(DEFAULT_LOCATION);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseMunicipality(city: string) {
    setError(null);
    setLocation({ mode: 'manual', city, label: city });
  }

  async function useDeviceLocation() {
    setIsResolving(true);
    setError(null);
    try {
      const existing = await ExpoLocation.getForegroundPermissionsAsync();
      const permission = existing.granted
        ? existing
        : await ExpoLocation.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Location is off. Pick a GTA municipality instead.');
      }

      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const context = await resolveLocationContext({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? undefined,
      });
      if (!context.supported) {
        throw new Error(context.message || 'Echoo is currently live across the Greater Toronto Area.');
      }

      setLocation({
        mode: 'gps',
        city: context.municipality || 'Greater Toronto Area',
        label: context.label || 'Near you in the GTA',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: context.accuracyMeters ?? position.coords.accuracy ?? undefined,
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Echoo could not resolve your location.';
      setError(message);
      throw nextError;
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <LocationContext.Provider
      value={{ location, isResolving, error, chooseMunicipality, useDeviceLocation }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useEchooLocation() {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useEchooLocation must be used inside LocationProvider.');
  return value;
}
