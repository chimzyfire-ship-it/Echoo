import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

// Publish a manifest only after every chunk is durable. ASCII encoding keeps
// even Unicode user metadata below SecureStore's per-value byte limit.
export function createSessionStorage(store = SecureStore) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function manifest(key: string): Promise<{ id: string; count: number } | null> {
    const value = await store.getItemAsync(key);
    return value ? JSON.parse(value) : null;
  }
  async function clear(key: string, value: Awaited<ReturnType<typeof manifest>>) {
    if (!value) return;
    for (let i = 0; i < value.count; i++) {
      await store.deleteItemAsync(`${key}.${value.id}.${i}`);
    }
  }
  return {
    getItem: (key: string) => serial(async () => {
      const value = await manifest(key);
      if (!value) return null;
      let encoded = '';
      for (let i = 0; i < value.count; i++) {
        const chunk = await store.getItemAsync(`${key}.${value.id}.${i}`);
        if (chunk === null) throw new Error('Stored session is incomplete. Please sign in again.');
        encoded += chunk;
      }
      return JSON.parse(encoded) as string;
    }),
    setItem: (key: string, value: string) => serial(async () => {
      const previous = await manifest(key);
      const encoded = JSON.stringify(value).replace(/[\u007f-\uffff]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
      const next = { id: randomUUID(), count: Math.ceil(encoded.length / 1800) };
      try {
        for (let i = 0; i < next.count; i++) {
          await store.setItemAsync(`${key}.${next.id}.${i}`, encoded.slice(i * 1800, (i + 1) * 1800), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
        }
        await store.setItemAsync(key, JSON.stringify(next), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      } catch (error) {
        await clear(key, next).catch(() => {});
        throw error;
      }
      await clear(key, previous);
    }),
    removeItem: (key: string) => serial(async () => {
      const previous = await manifest(key);
      await store.deleteItemAsync(key);
      await clear(key, previous);
    }),
  };
}

// Web keeps its existing process-scoped behavior; never fall back to plaintext
// native storage if the device's secure storage is unavailable.
const webValues = new Map<string, string>();
export const sessionStorage = Platform.OS === 'web' ? {
  getItem: async (key: string) => webValues.get(key) ?? null,
  setItem: async (key: string, value: string) => { webValues.set(key, value); },
  removeItem: async (key: string) => { webValues.delete(key); },
} : createSessionStorage();
