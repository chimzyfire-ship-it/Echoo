import type { User } from '@supabase/supabase-js';

import type { EchooProfile, OnboardingDraft } from '@/src/models';
import { supabase } from '@/src/services/supabase';

type ProfileRow = Record<string, unknown>;

export type PickedImage = {
  uri: string;
  mimeType?: string | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

const budget = (value: unknown): EchooProfile['budget'] =>
  value === '$$' || value === '$$$' ? value : '$';

const energy = (value: unknown): EchooProfile['energy'] =>
  value === 'hype' || value === 'curious' ? value : 'chill';

const tone = (value: unknown): EchooProfile['tone'] =>
  value === 'detailed' ? 'detailed' : 'direct';

export const normalizeUsername = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, 24);

export const isValidUsername = (value: string) =>
  /^[a-z0-9_]{3,24}$/.test(value) && value === normalizeUsername(value);

export async function resolveLoginEmail(login: string) {
  const value = login.trim();
  if (value.includes('@')) return value;
  const username = normalizeUsername(value);
  if (!username) throw new Error('Enter your username or email.');
  const { data, error } = await supabase.rpc('lookup_email_by_username', {
    p_username: username,
  });
  if (error) throw new Error('Invalid username or password.');
  if (typeof data !== 'string' || !data.trim()) throw new Error('Invalid username or password.');
  return data.trim();
}

export const mapProfile = (row: ProfileRow, user: User): EchooProfile => ({
  userId: text(row.user_id) || user.id,
  username: text(row.username),
  displayName:
    text(row.display_name) || text(user.user_metadata.display_name) || user.email?.split('@')[0] || 'Member',
  email: text(row.email) || user.email || '',
  bio: text(row.bio),
  photoUrl: text(row.profile_photo_url) || null,
  homeCity: text(row.home_city) || 'Greater Toronto Area',
  interests: strings(row.interests),
  eventStyles: strings(row.event_styles),
  audiences: strings(row.audiences),
  motivations: strings(row.motivations),
  budget: budget(row.budget),
  energy: energy(row.energy),
  tone: tone(row.tone),
  gender: text(row.gender) || 'Prefer not to say',
  dob: /^\d{4}-\d{2}-\d{2}$/.test(text(row.date_of_birth)) ? text(row.date_of_birth) : null,
  nationalities: strings(row.nationalities),
  completedAt: text(row.completed_at) || null,
  linkUpStatus: text(row.linkup_status) || null,
});

export const defaultOnboardingDraft = (user: User, profile?: EchooProfile | null): OnboardingDraft => ({
  displayName: profile?.displayName || text(user.user_metadata.display_name) || user.email?.split('@')[0] || '',
  username: profile?.username || normalizeUsername(user.email?.split('@')[0] || ''),
  bio: profile?.bio || '',
  city: profile?.homeCity || 'Toronto',
  interests: profile?.interests || [],
  eventStyles: profile?.eventStyles || [],
  audiences: profile?.audiences || [],
  motivations: profile?.motivations || [],
  budget: profile?.budget || '$$',
  energy: profile?.energy || 'curious',
  tone: profile?.tone || 'direct',
  gender: profile?.gender || 'Prefer not to say',
  dob: profile?.dob || '',
  nationalities: profile?.nationalities || [],
  hasPipedaConsent: false,
  cityIntelConsent: null,
  caslPushConsent: null,
});

export async function loadProfile(user: User): Promise<EchooProfile | null> {
  const { data, error } = await supabase
    .from('user_onboarding_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapProfile(data, user) : null;
}

export async function uploadProfilePhoto(image: PickedImage, userId: string): Promise<string> {
  const mimeType = image.mimeType || 'image/jpeg';
  const extension =
    mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const file = await fetch(image.uri);
  if (!file.ok) throw new Error('Echoo could not read that photo. Choose another image and try again.');

  const { error } = await supabase.storage
    .from('profile-photos')
    .upload(`${userId}/avatar.${extension}`, await file.arrayBuffer(), {
      upsert: true,
      contentType: mimeType,
    });
  if (error) throw error;

  const { data } = supabase.storage.from('profile-photos').getPublicUrl(`${userId}/avatar.${extension}`);
  if (!data.publicUrl) throw new Error('Echoo could not publish that profile photo.');
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function saveOnboardingProfile(
  user: User,
  draft: OnboardingDraft,
  photoUrl: string
): Promise<EchooProfile> {
  const username = normalizeUsername(draft.username);
  if (!isValidUsername(username)) {
    throw new Error('Choose a username with 3-24 lowercase letters, numbers, or underscores.');
  }
  if (!draft.displayName.trim() || !draft.bio.trim() || !photoUrl || !draft.hasPipedaConsent) {
    throw new Error('Add your name, a photo, a short bio, and consent to finish your profile.');
  }
  if (draft.bio.trim().length > 50) {
    throw new Error('Keep your one-liner bio to 50 characters.');
  }
  if (draft.cityIntelConsent === null || draft.caslPushConsent === null) {
    throw new Error('Answer both consent questions to finish your profile.');
  }

  const now = new Date().toISOString();
  const payload = {
    user_id: user.id,
    username,
    display_name: draft.displayName.trim(),
    email: user.email || '',
    interests: draft.interests,
    event_styles: draft.eventStyles,
    audiences: draft.audiences,
    motivations: draft.motivations,
    budget: draft.budget,
    energy: draft.energy,
    home_city: draft.city,
    tone: draft.tone,
    gender: draft.gender || 'Prefer not to say',
    nationalities: draft.nationalities.slice(0, 8),
    nationality_disclosed_at: draft.nationalities.length > 0 ? now : null,
    date_of_birth: /^\d{4}-\d{2}-\d{2}$/.test(draft.dob) ? draft.dob : null,
    profile_photo_url: photoUrl,
    bio: draft.bio.trim(),
    profile_version: 1,
    completed_at: now,
    personality_signals: {
      interests: draft.interests,
      eventStyles: draft.eventStyles,
      audiences: draft.audiences,
      motivations: draft.motivations,
      budget: draft.budget,
      energy: draft.energy,
      tone: draft.tone,
      nationalities: draft.nationalities,
    },
    metadata: {
      source: 'native_onboarding',
      pipeda_consent_at: now,
      city_intel_consent_at: draft.cityIntelConsent === 'yes' ? now : null,
      casl_push_consent_at: draft.caslPushConsent === 'yes' ? now : null,
    },
  };

  const { data, error } = await supabase
    .from('user_onboarding_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return mapProfile(data, user);
}
