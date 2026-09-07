import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Camera, Check, ChevronLeft, ChevronRight, ImagePlus, LogOut } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { ChoiceChip } from '@/src/components/choice-chip';
import { PrimaryButton } from '@/src/components/primary-button';
import { TextField } from '@/src/components/text-field';
import type { ConsentChoice, OnboardingDraft } from '@/src/models';
import { useAuth } from '@/src/providers/auth-provider';
import {
  defaultOnboardingDraft,
  isValidUsername,
  normalizeUsername,
  saveOnboardingProfile,
  type PickedImage,
  uploadProfilePhoto,
} from '@/src/services/auth';
import { GTA_MUNICIPALITIES } from '@/src/services/location';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';

const toggle = (values: string[], value: string) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

const INTEREST_SECTIONS: Array<{ title: string; options: string[] }> = [
  {
    title: 'Tourism & local discovery',
    options: [
      'Art',
      'Creativity',
      'Artists',
      'Performing Arts',
      'Collaboration Between Creative Minds',
      'Theater',
      'Painting',
      'Local Attractions',
      'Museum',
    ],
  },
  {
    title: 'Career & Business',
    options: [
      'Entrepreneurship',
      'Professional Networking',
      'Startup Businesses',
      'Business Strategy',
      'Professional Development',
      'Investing',
      'Leadership',
      'Innovation',
      'Online Marketing',
      'Professional Women',
      'Young Professionals',
      'Musicians',
      'Fashion Design',
    ],
  },
  {
    title: 'Community & Environment',
    options: ['Community Building', 'Community Service', 'Sustainability'],
  },
  {
    title: 'Dancing',
    options: ['Dancing', 'Social Dancing', 'Dance Lessons', 'Latin Dance', 'Salsa'],
  },
  {
    title: 'Games',
    options: ['Game Night', 'Board Games', 'Games', 'Gaming', 'Card Games', 'Video Games'],
  },
  {
    title: 'Health & Wellbeing',
    options: [
      'Wellness',
      'Meditation',
      'Healthy Living',
      'Energy Healing',
      'Yoga',
      'Alternative Medicine',
      'Nutrition',
      'Healthy Eating',
    ],
  },
  {
    title: 'More Signals',
    options: [
      'Hobbies & Passions',
      'Identity & Language',
      'Music',
      'Parents & Family',
      'Pets & Animals',
      'Religion & Spirituality',
      'Science & Education',
      'Social Activities',
      'Sports & Fitness',
    ],
  },
];

type Step =
  | { type: 'profile'; title: string; sub: string; btn: string }
  | { type: 'interest-map'; title: string; sub: string; btn: string }
  | { type: 'multi'; key: 'eventStyles' | 'audiences' | 'motivations'; title: string; sub: string; btn: string; options: string[]; customLabel: string }
  | { type: 'cards'; key: 'budget' | 'energy' | 'tone'; title: string; sub: string; btn: string; options: Array<{ value: string; name: string; desc: string }> }
  | { type: 'city'; title: string; sub: string; btn: string }
  | { type: 'identity'; title: string; sub: string; btn: string }
  | { type: 'consent'; key: 'cityIntelConsent' | 'caslPushConsent'; title: string; sub: string; btn: string; options: Array<{ value: string; name: string; desc: string }> };

const OB_STEPS: Step[] = [
  { type: 'profile', title: 'Show up.', sub: 'A photo and a one-liner so people know who\u2019s linking up.', btn: 'Continue' },
  { type: 'interest-map', title: 'Build your interest map.', sub: 'Choose the signals Echoo should use when it reads the city for you.', btn: 'Continue' },
  {
    type: 'multi',
    key: 'eventStyles',
    title: 'How do you like to hang out?',
    sub: 'Pick the types of events you would actually say yes to.',
    btn: 'Continue',
    options: [
      'Small gatherings',
      'Big events',
      'Casual hangouts',
      'Sport activities',
      'Quiet events',
      'Thoughtful & deep',
      'Food & drinks',
      'Talks',
      'Tourism & local attractions',
    ],
    customLabel: 'Or type an event style',
  },
  {
    type: 'multi',
    key: 'audiences',
    title: 'Who do you want to meet?',
    sub: 'This helps Echoo shape the people, groups, and rooms it surfaces.',
    btn: 'Continue',
    options: [
      'People my age',
      'Students',
      'Professionals',
      'Other parents',
      'Other expats',
      'Tech folks',
      'No preference',
      'Same-minded people',
    ],
    customLabel: 'Or type a group',
  },
  {
    type: 'multi',
    key: 'motivations',
    title: 'What\u2019s bringing you to Echoo?',
    sub: 'Tell the engine what kind of outcome matters most right now.',
    btn: 'Continue',
    options: [
      'Meet new people',
      'Try new things',
      'Find a date',
      'Create community',
      'Grow my network',
      'Get more active',
      'Discover new hobbies',
      'Just looking',
      'Learn something new',
    ],
    customLabel: 'Or type a reason',
  },
  {
    type: 'cards',
    key: 'budget',
    title: 'Set your spending comfort.',
    sub: 'Echoo will keep recommendations within the range that feels right.',
    btn: 'Continue',
    options: [
      { value: '$', name: 'Low-key and accessible', desc: 'Free events, casual hangs, street food, local community rooms.' },
      { value: '$$', name: 'Curated but reasonable', desc: 'Independent shows, coffee dates, special dinners, strong everyday picks.' },
      { value: '$$$', name: 'Premium when it is worth it', desc: 'High-touch rooms, destination nights, intimate performances, fine dining.' },
    ],
  },
  {
    type: 'cards',
    key: 'energy',
    title: 'Choose the pace.',
    sub: 'The same city can feel calm, electric, or exploratory.',
    btn: 'Continue',
    options: [
      { value: 'chill', name: 'Chill and intimate', desc: 'Quiet rooms, lower friction, time to talk, softer transitions.' },
      { value: 'hype', name: 'Active and social', desc: 'Crowds, movement, games, live performance, big-room energy.' },
      { value: 'curious', name: 'Open-ended and mixed', desc: 'A little structure, a little surprise, and room for discovery.' },
    ],
  },
  { type: 'city', title: 'Where in the GTA should Echoo start?', sub: 'Choose one of the 25 GTA municipalities. Current location can refine this later.', btn: 'Continue' },
  { type: 'identity', title: 'Optional personal context.', sub: 'Age, gender, and nationality are private and optional. They never control where you can explore.', btn: 'Continue' },
  {
    type: 'cards',
    key: 'tone',
    title: 'How should Echoo talk to you?',
    sub: 'Pick the recommendation style your AI guide should use.',
    btn: 'Continue',
    options: [
      { value: 'direct', name: 'Direct and decisive', desc: 'Short answers, clear tradeoffs, fewer words.' },
      { value: 'detailed', name: 'Curated and contextual', desc: 'Why it fits, alternate routes, and fuller planning context.' },
    ],
  },
  {
    type: 'consent',
    key: 'cityIntelConsent',
    title: 'Help shape GTA spaces.',
    sub: 'Echoo compiles anonymised check-in and activity data to produce city intelligence reports for urban planners. Individual users are never identifiable.',
    btn: 'Continue',
    options: [
      { value: 'yes', name: 'Yes, contribute anonymised data', desc: 'Allow my aggregate, anonymised check-ins to support city development reports.' },
      { value: 'no', name: 'No, keep my check-ins private', desc: 'Do not include my activity data in any aggregated urban intelligence reports.' },
    ],
  },
  {
    type: 'consent',
    key: 'caslPushConsent',
    title: 'Personalised plans, every Thursday.',
    sub: 'Would you like Echoo to send you a personalised weekend plan every Thursday at 6:00 PM?',
    btn: 'Let\u2019s go',
    options: [
      { value: 'yes', name: 'Yes, send me plans', desc: 'Receive curated routes and weekend suggestions weekly. Unsubscribe anytime.' },
      { value: 'no', name: 'No, thanks', desc: 'I will discover routes manually inside the Echoo planner when I choose.' },
    ],
  },
];

const GENDERS = ['Prefer not to say', 'Female', 'Male', 'Nonbinary', 'Not Listed'];

export default function OnboardingScreen() {
  const router = useRouter();
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citySearch, setCitySearch] = useState('');

  useEffect(() => {
    if (!user) {
      router.replace('/auth');
      return;
    }
    setDraft((current) => current ?? defaultOnboardingDraft(user, profile));
  }, [profile, router, user]);

  async function pickPhoto() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access to add the photo required for your Echoo profile.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
    });
    if (!result.canceled && result.assets[0]) {
      setPhoto({ uri: result.assets[0].uri, mimeType: result.assets[0].mimeType });
    }
  }

  function validateStep(index: number): string | null {
    if (!draft) return 'Loading your profile.';
    const current = OB_STEPS[index];
    if (current.type === 'profile') {
      if (!draft.displayName.trim()) return 'Add your name before continuing.';
      if (!isValidUsername(draft.username)) return 'Choose a username with 3-24 lowercase letters, numbers, or underscores.';
      if (!draft.bio.trim()) return 'Add a one-line bio so people know who\u2019s linking up.';
      if (draft.bio.trim().length > 50) return 'Keep your one-liner bio to 50 characters.';
      if (!photo && !profile?.photoUrl) return 'Add a photo. Every Echoo profile has a face.';
    }
    if (current.type === 'city' && !draft.city.trim()) return 'Choose where Echoo should start.';
    if (current.type === 'identity' && draft.dob && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dob)) {
      return 'Enter your date of birth as YYYY-MM-DD, or leave it empty.';
    }
    return null;
  }

  function nextStep() {
    const validation = validateStep(step);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, OB_STEPS.length - 1));
  }

  async function completeProfile() {
    if (!user || !draft) return;
    const validation = validateStep(0);
    if (validation) {
      setError(validation);
      setStep(0);
      return;
    }
    if (!draft.hasPipedaConsent) {
      setError('Agree to the Privacy Policy and Terms of Service to finish your profile.');
      return;
    }
    if (draft.cityIntelConsent === null || draft.caslPushConsent === null) {
      setError('Answer both consent questions to finish your profile.');
      return;
    }
    setBusy(true);
    try {
      const photoUrl = photo ? await uploadProfilePhoto(photo, user.id) : profile?.photoUrl;
      if (!photoUrl) throw new Error('Add a profile photo before finishing.');
      await saveOnboardingProfile(user, draft, photoUrl);
      await refreshProfile();
      router.replace('/(tabs)');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Echoo could not finish your profile.');
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return null;
  const photoUri = photo?.uri || profile?.photoUrl || null;
  const current = OB_STEPS[step];
  const isLast = step === OB_STEPS.length - 1;
  const filteredCities = GTA_MUNICIPALITIES.filter((city) =>
    city.name.toLowerCase().includes(citySearch.trim().toLowerCase())
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topBar}>
        <BrandMark />
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={signOut} style={styles.signOut}>
          <LogOut size={17} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.progress} accessibilityLabel={`Step ${step + 1} of ${OB_STEPS.length}`}>
        {OB_STEPS.map((_, index) => (
          <View key={index} style={[styles.progressBar, index <= step && styles.progressBarActive]} />
        ))}
      </View>

      <View style={styles.heading}>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.sub}>{current.sub}</Text>
      </View>

      {current.type === 'profile' ? (
        <View style={styles.section}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose profile photo" onPress={pickPhoto} style={styles.photoButton}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={{ width: 92, height: 92, borderRadius: 46 }} />
            ) : (
              <Camera size={27} color={Colors.peach} />
            )}
            <View style={styles.photoBadge}>
              <ImagePlus size={13} color={Colors.background} />
            </View>
          </Pressable>

          <TextField
            label="Name"
            value={draft.displayName}
            onChangeText={(value) => setDraft({ ...draft, displayName: value })}
            autoCapitalize="words"
            placeholder="How should Echoo call you?"
          />
          <TextField
            label="Username"
            value={draft.username}
            onChangeText={(value) => setDraft({ ...draft, username: normalizeUsername(value) })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="lowercase only"
          />
          <TextField
            label="One line about you"
            value={draft.bio}
            onChangeText={(value) => setDraft({ ...draft, bio: value })}
            maxLength={50}
            placeholder="Photographer, usually at jazz shows."
            hint={`Shown when Echoo suggests a link-up. Keep it to 50 characters. ${draft.bio.length}/50`}
          />
        </View>
      ) : null}

      {current.type === 'interest-map' ? (
        <View style={styles.section}>
          <ScrollView nestedScrollEnabled>
            {INTEREST_SECTIONS.map((section) => (
              <View key={section.title} style={styles.interestSection}>
                <Text style={styles.interestSectionTitle}>{section.title}</Text>
                <View style={styles.chips}>
                  {section.options.map((option) => (
                    <ChoiceChip
                      key={option}
                      label={option}
                      selected={draft.interests.includes(option)}
                      onPress={() => setDraft({ ...draft, interests: toggle(draft.interests, option) })}
                    />
                  ))}
                </View>
              </View>
            ))}
            <AddCustomInput label="Add another interest" onAdd={(value) => setDraft({ ...draft, interests: toggle(draft.interests, value) })} />
          </ScrollView>
        </View>
      ) : null}

      {current.type === 'multi' ? (
        <View style={styles.section}>
          <View style={styles.chips}>
            {current.options.map((option) => (
              <ChoiceChip
                key={option}
                label={option}
                selected={draft[current.key].includes(option)}
                onPress={() => setDraft({ ...draft, [current.key]: toggle(draft[current.key], option) } as OnboardingDraft)}
              />
            ))}
          </View>
          <AddCustomInput
            label={current.customLabel}
            onAdd={(value) => setDraft({ ...draft, [current.key]: toggle(draft[current.key], value) } as OnboardingDraft)}
          />
        </View>
      ) : null}

      {current.type === 'cards' ? (
        <View style={styles.cardGrid}>
          {current.options.map((option) => {
            const selected =
              current.key === 'budget'
                ? draft.budget === option.value
                : current.key === 'energy'
                  ? draft.energy === option.value
                  : draft.tone === option.value;
            return (
              <SelectCard
                key={option.value}
                name={option.name}
                desc={option.desc}
                selected={selected}
                onPress={() =>
                  setDraft({
                    ...draft,
                    [current.key]: option.value,
                  } as unknown as OnboardingDraft)
                }
              />
            );
          })}
        </View>
      ) : null}

      {current.type === 'city' ? (
        <View style={styles.section}>
          <TextField
            label="Your GTA municipality"
            value={citySearch}
            onChangeText={setCitySearch}
            placeholder="Search your GTA municipality"
            autoCapitalize="words"
          />
          <View style={styles.chips}>
            {filteredCities.map((city) => (
              <ChoiceChip
                key={city.name}
                label={city.name}
                selected={draft.city === city.name}
                onPress={() => setDraft({ ...draft, city: city.name })}
              />
            ))}
          </View>
          {draft.city ? <Text style={styles.hint}>Starting in {draft.city}.</Text> : null}
        </View>
      ) : null}

      {current.type === 'identity' ? (
        <View style={styles.section}>
          <Text style={styles.hint}>Use this only for personalization. Avoiding the question is always valid.</Text>
          <View style={styles.cardGrid}>
            {GENDERS.map((option) => (
              <SelectCard
                key={option}
                name={option}
                desc=""
                selected={draft.gender === option}
                onPress={() => setDraft({ ...draft, gender: option })}
              />
            ))}
          </View>
          <TextField
            label="Date of birth"
            value={draft.dob}
            onChangeText={(value) => setDraft({ ...draft, dob: value })}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            hint="Optional. Used for age-compatible Link Up matching."
          />
          <TextField
            label="Nationality or cultural background"
            value={draft.nationalities.join(', ')}
            onChangeText={(value) =>
              setDraft({
                ...draft,
                nationalities: value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
                  .slice(0, 8),
              })
            }
            placeholder="Optional — for example, Canadian"
            autoCapitalize="words"
            hint="Optional. This is never used to restrict places, prices, or access."
          />
        </View>
      ) : null}

      {current.type === 'consent' ? (
        <View style={styles.cardGrid}>
          {current.options.map((option) => {
            const selected = draft[current.key] === option.value;
            return (
              <SelectCard
                key={option.value}
                name={option.name}
                desc={option.desc}
                selected={selected}
                onPress={() =>
                  setDraft({
                    ...draft,
                    [current.key]: option.value as ConsentChoice,
                  } as OnboardingDraft)
                }
              />
            );
          })}
        </View>
      ) : null}

      {current.type === 'consent' && current.key === 'cityIntelConsent' ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.hasPipedaConsent }}
          onPress={() => setDraft({ ...draft, hasPipedaConsent: !draft.hasPipedaConsent })}
          style={styles.consent}
        >
          <View style={[styles.checkbox, draft.hasPipedaConsent && styles.checkboxChecked]}>
            {draft.hasPipedaConsent ? <Check size={14} color={Colors.background} /> : null}
          </View>
          <Text style={styles.consentCopy}>
            I agree to Echoo’s Privacy Policy and Terms of Service. Echoo uses these profile signals to personalize discovery.
          </Text>
        </Pressable>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {step > 0 ? (
          <PrimaryButton
            label="Back"
            variant="secondary"
            fullWidth={false}
            onPress={() => {
              setError(null);
              setStep((currentStep) => currentStep - 1);
            }}
            icon={<ChevronLeft size={18} color={Colors.ink} />}
          />
        ) : null}
        <View style={styles.primaryAction}>
          <PrimaryButton
            label={isLast ? 'Finish profile' : current.btn}
            onPress={isLast ? completeProfile : nextStep}
            loading={busy}
            icon={
              isLast ? (
                <Check size={18} color={Colors.background} />
              ) : (
                <ChevronRight size={18} color={Colors.background} />
              )
            }
          />
        </View>
      </View>
    </ScrollView>
  );
}

function AddCustomInput({ label, onAdd }: { label: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <View style={styles.customField}>
      <Text style={styles.customLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Type here"
        placeholderTextColor={Colors.textMuted}
        style={styles.customInput}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (value.trim()) onAdd(value.trim());
          setValue('');
        }}
      />
      {value.trim() ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add custom entry"
          onPress={() => {
            onAdd(value.trim());
            setValue('');
          }}
          style={styles.customAdd}
        >
          <Text style={styles.customAddText}>Add</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SelectCard({
  name,
  desc,
  selected,
  onPress,
}: {
  name: string;
  desc: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.selectCard, selected && styles.selectCardSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.selectCardName, selected && styles.selectCardNameSelected]}>{name}</Text>
      {desc ? <Text style={styles.selectCardDesc}>{desc}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: 44,
    gap: Spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signOut: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  progress: {
    flexDirection: 'row',
    gap: 3,
  },
  progressBar: {
    flex: 1,
    height: 3,
    borderRadius: 99,
    backgroundColor: Colors.surfaceElevated,
  },
  progressBarActive: {
    backgroundColor: Colors.peach,
  },
  heading: {
    gap: 6,
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.7,
    lineHeight: 33,
  },
  sub: {
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 330,
  },
  section: {
    gap: Spacing.lg,
  },
  interestSection: {
    gap: 9,
    marginBottom: Spacing.lg,
  },
  interestSectionTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  customField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.14)',
    backgroundColor: 'rgba(24, 22, 20, 0.72)',
    paddingHorizontal: 14,
  },
  customLabel: {
    color: Colors.textMuted,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '600',
  },
  customInput: {
    flex: 1,
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 14,
    paddingVertical: 10,
    minWidth: 0,
  },
  customAdd: {
    paddingHorizontal: 8,
  },
  customAddText: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    fontWeight: '700',
  },
  cardGrid: {
    gap: 10,
  },
  selectCard: {
    minHeight: 84,
    justifyContent: 'center',
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(24, 22, 21, 0.82)',
    padding: Spacing.md,
    gap: 5,
  },
  selectCardSelected: {
    borderColor: Colors.peach,
    backgroundColor: 'rgba(247, 213, 178, 0.12)',
  },
  selectCardName: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
  },
  selectCardNameSelected: {
    color: Colors.peach,
  },
  selectCardDesc: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  hint: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 18,
  },
  photoButton: {
    width: 96,
    height: 96,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 48,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
  },
  photoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardAccent,
    borderWidth: 3,
    borderColor: Colors.background,
  },
  consent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.18)',
    backgroundColor: Colors.surface,
  },
  checkboxChecked: {
    backgroundColor: Colors.cardAccent,
    borderColor: Colors.cardAccentBorder,
  },
  consentCopy: {
    flex: 1,
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  primaryAction: {
    flex: 1,
  },
  pressed: {
    opacity: 0.78,
  },
});
