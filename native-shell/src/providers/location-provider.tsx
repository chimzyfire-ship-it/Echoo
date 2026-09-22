import * as ExpoLocation from 'expo-location';
import React, { createContext, useContext, useRef, useState } from 'react';

import type { EchooLocation } from '@/src/models';
import { DEFAULT_LOCATION, manualMunicipalityLocation } from '@/src/services/location';
import { resolveLocationContext } from '@/src/services/api';

type LocationContextValue = {
  location: EchooLocation;
  isResolving: boolean;
  error: string | null;
  chooseMunicipality: (city: string) => boolean;
  useDeviceLocation: () => Promise<boolean>;
};

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<EchooLocation>(DEFAULT_LOCATION);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locationRequest = useRef(0);

  function chooseMunicipality(city: string) {
    const nextLocation = manualMunicipalityLocation(city);
    if (!nextLocation) {
      setError('Choose a listed Ontario city or GTA municipality.');
      return false;
    }
    // A late GPS response must not replace a newer manual selection.
    locationRequest.current += 1;
    setIsResolving(false);
    setError(null);
    setLocation(nextLocation);
    return true;
  }

  async function useDeviceLocation() {
    const request = ++locationRequest.current;
    setIsResolving(true);
    setError(null);
    try {
      const existing = await ExpoLocation.getForegroundPermissionsAsync();
      const permission = existing.granted
        ? existing
        : await ExpoLocation.requestForegroundPermissionsAsync();
      if (request !== locationRequest.current) return false;
      if (!permission.granted) {
        throw new Error('Location is off. Pick a city or municipality instead.');
      }

      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      if (request !== locationRequest.current) return false;
      const context = await resolveLocationContext({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? undefined,
      });
      if (request !== locationRequest.current) return false;
      if (!context.supported) {
        throw new Error(context.message || 'Choose a location in Ontario.');
      }

      setLocation({
        mode: 'gps',
        city: context.municipality || 'Ontario',
        label: context.label || 'Near you in Ontario',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: context.accuracyMeters ?? position.coords.accuracy ?? undefined,
      });
      return true;
    } catch (nextError) {
      if (request !== locationRequest.current) return false;
      const message = nextError instanceof Error ? nextError.message : 'Echoo could not resolve your location.';
      setError(message);
      throw nextError;
    } finally {
      if (request === locationRequest.current) setIsResolving(false);
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
