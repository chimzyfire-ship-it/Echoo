import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import type { QuickPlan } from '@/src/models';
import { getQuickPlan, type QuickPlanBudgetStyle, type QuickPlanProfileInput } from '@/src/services/api';
import { supabase } from '@/src/services/supabase';

export type OutingChoices = { stopCount: 2 | 3; budgetStyle: QuickPlanBudgetStyle; mood: 'chill' | 'curious' | 'hype'; anchorPosition: number };
export type OutingProgress = { status: 'arrived' | 'completed' | 'skipped'; visitId?: string; at: string };
export type ActiveOuting = { id: string; source?: 'companion'; ownerId?: string; plan: QuickPlan; choices: OutingChoices; profile?: QuickPlanProfileInput; recentPlaceIds?: string[]; progress: Partial<Record<string, OutingProgress>> };
export const defaultOutingChoices: OutingChoices = { stopCount: 2, budgetStyle: 'value', mood: 'chill', anchorPosition: 1 };
const activeKey = (userId: string) => `echoo:outing:v1:${userId}`;

async function requireUser(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId) throw new Error('Sign in again to continue this outing.');
}

export async function loadActiveOuting(userId: string): Promise<ActiveOuting | null> {
  await requireUser(userId);
  const raw = await AsyncStorage.getItem(activeKey(userId));
  if (!raw) return null;
  const value = JSON.parse(raw) as ActiveOuting;
  if (value.ownerId !== userId || !value.id || !value.choices || !value.progress || !Array.isArray(value.plan?.stops) || !value.plan.stops.some((place) => place.id === value.plan.anchorId)) return null;
  // Recover an arrival if the server committed but the app closed before saving.
  // Failure to connect must not destroy the locally saved route or its progress.
  if (value.plan.generatedAt) {
    try {
      const { data } = await supabase.from('outing_verified_visits').select('id,place_id,arrived_at')
        .eq('user_id', userId).in('place_id', value.plan.stops.map((place) => place.id)).gte('arrived_at', value.plan.generatedAt);
      for (const visit of data || []) {
        if (!value.progress[visit.place_id]) value.progress[visit.place_id] = { status: 'arrived', visitId: visit.id, at: visit.arrived_at };
      }
    } catch { /* Keep saved progress when verification is unavailable. */ }
  }
  return value;
}

export async function saveActiveOuting(userId: string, outing: ActiveOuting) {
  await requireUser(userId);
  if (outing.ownerId !== userId) throw new Error('This outing belongs to another account.');
  await AsyncStorage.setItem(activeKey(userId), JSON.stringify(outing));
}

export async function generateOuting(input: Parameters<typeof getQuickPlan>[0], choices: OutingChoices, userId?: string): Promise<ActiveOuting> {
  const anchorId = input.anchor.canonicalId || input.anchor.id;
  const historyKey = `echoo:outing-history:v1:${userId}:${anchorId}`;
  if (userId) await requireUser(userId);
  const stored: unknown = userId ? JSON.parse(await AsyncStorage.getItem(historyKey) || '[]') : [];
  const history = [...new Set([...(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []), ...(input.recentPlaceIds || [])])].filter((id) => id !== anchorId).slice(-30);
  const id = Crypto.randomUUID();
  const plan = await getQuickPlan({ ...input, ...choices, rotationKey: id, recentPlaceIds: history });
  const recentPlaceIds = [...new Set([...history, ...plan.stops.filter((place) => place.id !== plan.anchorId).map((place) => place.id)])].slice(-30);
  const outing: ActiveOuting = { id, ownerId: userId, plan, choices, profile: input.profile, recentPlaceIds, progress: {} };
  if (userId) {
    await requireUser(userId);
    await AsyncStorage.setItem(historyKey, JSON.stringify(recentPlaceIds));
    await saveActiveOuting(userId, outing);
  }
  return outing;
}

export async function verifyArrival(userId: string, placeId: string) {
  await requireUser(userId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(placeId)) throw new Error('This place cannot be verified in Echoo inventory yet.');
  // Called only by the explicit arrival button. No background tracking.
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Location permission was not granted. Your place remains planned and no points were added.');
  const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  await requireUser(userId);
  const { data, error } = await supabase.rpc('verify_outing_arrival', {
    p_place_id: placeId, p_latitude: fix.coords.latitude, p_longitude: fix.coords.longitude,
    p_accuracy: fix.coords.accuracy, p_observed_at: new Date(fix.timestamp).toISOString(),
  });
  if (error) throw new Error(error.code === 'PGRST202' ? 'Visit verification is not available on this server yet. No points were added.' : error.message);
  return data as { visitId: string; arrivedAt: string; awardedPoints: number; city: string };
}

export type CityScore = { city_key: string; city_name: string; points: number; visit_count: number; badge_count: number };
export type CityBadge = { id: string; city_name: string; milestone: number; earned_at: string };
export async function getCityScores(userId: string) {
  await requireUser(userId);
  const [scores, badges] = await Promise.all([
    supabase.from('outing_city_scores').select('city_key,city_name,points,visit_count,badge_count').eq('user_id', userId).order('visit_count', { ascending: false }).order('city_key'),
    supabase.from('outing_city_badges').select('id,city_name,milestone,earned_at').eq('user_id', userId).order('earned_at', { ascending: false }),
  ]);
  if (scores.error || badges.error) throw new Error('City scores are unavailable. Server setup may still be required, or the connection failed. No offline rewards are issued.');
  return { scores: scores.data as CityScore[], badges: badges.data as CityBadge[] };
}

export async function claimCityBadge(userId: string, score: CityScore) {
  await requireUser(userId);
  const { data, error } = await supabase.rpc('claim_outing_city_badge', { p_city_key: score.city_key, p_milestone: score.badge_count + 1 });
  if (error) throw new Error(error.code === 'PGRST202' ? 'City badges are not available on this server yet. Server setup is required; no badge was issued.' : error.message);
  return data as CityBadge;
}
