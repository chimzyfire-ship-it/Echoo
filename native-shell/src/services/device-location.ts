import * as Location from 'expo-location';

export class DeviceLocationError extends Error {
  constructor(message: string, public readonly code: 'permission' | 'services' | 'timeout' | 'invalid' | 'cancelled') {
    super(message);
    this.name = 'DeviceLocationError';
  }
}

// Bound permission, sensor and network waits even when a platform promise stalls.
export function bounded<T>(operation: Promise<T>, signal?: AbortSignal, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      callback();
    };
    const cancel = () => finish(() => reject(new DeviceLocationError('Location request cancelled.', 'cancelled')));
    const timer = setTimeout(() => finish(() => reject(new DeviceLocationError('Location took too long. Try again or choose a city.', 'timeout'))), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

export async function deviceLocation({ prompt = true, precise = false, signal }: { prompt?: boolean; precise?: boolean; signal?: AbortSignal } = {}) {
  let permission = await bounded(Location.getForegroundPermissionsAsync(), signal);
  if (!permission.granted && prompt && permission.canAskAgain) {
    permission = await bounded(Location.requestForegroundPermissionsAsync(), signal, 60000);
  }
  if (!permission.granted) {
    throw new DeviceLocationError('Location permission was not granted. Enable location for Echoo in Settings, or choose a city.', 'permission');
  }
  if (!await bounded(Location.hasServicesEnabledAsync(), signal)) {
    throw new DeviceLocationError('Device location services are off. Turn them on in Settings, then try again, or choose a city.', 'services');
  }
  // A removable foreground subscription gives us a cancellable one-shot fix on
  // both platforms. getCurrentPositionAsync cannot be cancelled on native.
  let subscription: Location.LocationSubscription | undefined;
  let finished = false;
  try {
    const fix = await bounded(new Promise<Location.LocationObject>((resolve, reject) => {
      Location.watchPositionAsync({
        accuracy: precise ? Location.Accuracy.High : Location.Accuracy.Balanced,
        distanceInterval: 0,
        mayShowUserSettingsDialog: prompt,
      }, resolve, reason => reject(new Error(reason))).then(value => {
        if (finished) value.remove();
        else subscription = value;
      }, reject);
    }), signal);
    const { latitude, longitude, accuracy } = fix.coords;
    const age = Date.now() - fix.timestamp;
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
        !Number.isFinite(age) || age < -15000 || age > (precise ? 120000 : 60000) ||
        (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))) {
      throw new DeviceLocationError('The device returned an outdated or invalid location. Try again or choose a city.', 'invalid');
    }
    if (precise && (accuracy === null || accuracy > 75)) {
      throw new DeviceLocationError('Arrival needs a more accurate location. Enable Precise Location and try again near the place. No points were added.', 'invalid');
    }
    return fix;
  } finally {
    finished = true;
    subscription?.remove();
  }
}
