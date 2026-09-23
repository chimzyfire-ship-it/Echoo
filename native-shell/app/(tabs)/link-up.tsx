import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Eye, EyeOff, Link2, LogOut, MapPin, Radio, Search, Timer, X } from 'lucide-react-native';
import { Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/src/components/primary-button';
import { ScreenLoading, ScreenMessage } from '@/src/components/screen-state';
import type { DiscoveryCard } from '@/src/models';
import { useAuth } from '@/src/providers/auth-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import {
  checkIn,
  checkOut,
  endMatch,
  loadLinkUpSnapshot,
  respondToMatch,
  setPresenceVisibility,
} from '@/src/services/linkup';
import { getDiscovery } from '@/src/services/api';
import { cachePlace } from '@/src/services/place-cache';
import { supabase } from '@/src/services/supabase';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';
import { announce } from '@/src/services/notification-events';

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

function remainingLabel(expiresAt: string, now: number) {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute left';
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m left`;
}

const HOW_IT_WORKS = [
  { title: 'Pick your spot', body: 'Find the place you are at right now.' },
  { title: 'Check in', body: 'A few hours of presence. No background tracking.' },
  { title: 'Make it mutual', body: 'When you both say yes, a private chat opens.' },
];

export default function LinkUpScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [openConversation, setOpenConversation] = useState<{ conversationId: string; title: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now);

  const snapshot = useQuery({
    queryKey: ['linkup-snapshot', user?.id],
    enabled: Boolean(user),
    queryFn: () => loadLinkUpSnapshot(user!.id),
    refetchInterval: 30_000,
  });

  // Drives every visible countdown without a per-second render.
  useInterval(() => setNow(Date.now()), 20_000);

  async function runAction(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await snapshot.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Link Up action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function checkInAt(place: DiscoveryCard) {
    if (checkingIn) return;
    setCheckingIn(true);
    setActionError(null);
    try {
      await checkIn(place.canonicalId || place.id);
      cachePlace(place);
      void triggerHaptic.success();
      setPickerOpen(false);
      announce({ title: 'You’re checked in', body: `${place.title}. Enjoy your time here.`, userId: user?.id });
      await snapshot.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Check-in failed.');
    } finally {
      setCheckingIn(false);
    }
  }

  if (!user) {
    return (
      <View style={styles.screen}>
        <ScreenMessage
          title="Sign in to Link Up"
          body="Create an account to connect with the right people, at the right place."
          icon={<Radio size={28} color={Colors.peach} />}
          action={
            <PrimaryButton label="Sign in" onPress={() => router.push('/auth')} variant="secondary" />
          }
        />
      </View>
    );
  }

  if (!profile?.completedAt || !profile.photoUrl || !profile.bio) {
    return (
      <View style={styles.screen}>
        <ScreenMessage
          title="Add a photo and a bio"
          body="Every Link Up match has a face and a one-liner. Finish your profile to start matching."
          action={<PrimaryButton label="Complete profile" onPress={() => router.push('/onboarding')} />}
        />
      </View>
    );
  }

  if (snapshot.isLoading) {
    return (
      <View style={styles.screen}>
        <ScreenLoading label="Finding your Link Up status." />
      </View>
    );
  }

  if (snapshot.isError) {
    return (
      <View style={styles.screen}>
        <ScreenMessage
          title="Link Up could not load"
          body={snapshot.error instanceof Error ? snapshot.error.message : 'Try again in a moment.'}
          action={<PrimaryButton label="Try again" onPress={() => snapshot.refetch()} />}
        />
      </View>
    );
  }

  const data = snapshot.data!;

  if (!data.enabled) {
    return (
      <View style={styles.screen}>
        <ScreenMessage
          title="Link Up is rolling out"
          body="We're opening Link Up city by city. Hang tight — it's almost here."
          icon={<Link2 size={28} color={Colors.peach} />}
        />
      </View>
    );
  }

  if (data.paused) {
    return (
      <View style={styles.screen}>
        <ScreenMessage
          title="Link Up is paused"
          body="You won't be matched while paused. Your active conversations are unaffected."
          icon={<Link2 size={28} color={Colors.peach} />}
          action={
            <PrimaryButton
              label="Resume Link Up"
              onPress={() => void runAction(() => setPresenceVisibility(user.id, 'active'))}
              loading={busy}
            />
          }
        />
      </View>
    );
  }

  const hasActivity = data.pending.length || data.waiting.length || data.conversations.length;
  const presenceRemaining = data.presence ? remainingLabel(data.presence.expiresAt, now) : null;

  return (
    <ScrollView
      style={styles.screenScroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.screen}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topCopy}>
        <Text style={styles.kicker}>LINK UP</Text>
        <Text style={styles.title}>Good company, right here.</Text>
      </View>

      {data.presence ? (
        <>
          <View style={styles.presenceCard}>
            <View style={styles.presenceDot} />
            <View style={styles.presenceCopy}>
              <Text style={styles.presenceTitle} numberOfLines={1}>
                {data.presence.placeName ?? 'Your spot'}
              </Text>
              <Text style={styles.presenceSub}>
                {data.ghost ? 'Ghost on · hidden from new matches' : 'Scanning for the right person here'}
                {presenceRemaining && presenceRemaining !== 'expired' ? ` · ${presenceRemaining}` : ''}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave this place"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={() => {
                void triggerHaptic.medium();
                void runAction(async () => { await checkOut(); announce({ title: 'You’re checked out', body: 'Your presence here has ended. See you at the next spot.', userId: user.id }); });
              }}
              style={styles.leaveButton}
            >
              <LogOut size={15} color={Colors.peach} />
              <Text style={styles.leaveText}>Leave</Text>
            </Pressable>
          </View>

          <View style={styles.presenceTools}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={data.ghost ? 'Turn ghost mode off' : 'Go ghost — stay checked in but hidden from new matches'}
              disabled={busy}
              accessibilityState={{ disabled: busy, selected: data.ghost }}
              onPress={() => {
                void triggerHaptic.light();
                void runAction(() => setPresenceVisibility(user.id, data.ghost ? 'active' : 'ghost'));
              }}
              style={[styles.toolButton, data.ghost && styles.toolButtonActive]}
            >
              {data.ghost ? <Eye size={14} color={Colors.background} /> : <EyeOff size={14} color={Colors.peach} />}
              <Text style={[styles.toolText, data.ghost && styles.toolTextActive]}>{data.ghost ? 'Ghost on' : 'Go ghost'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Extend your presence here"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={() => void runAction(() => checkIn(data.presence!.placeId))}
              style={styles.toolButton}
            >
              <Timer size={14} color={Colors.peach} />
              <Text style={styles.toolText}>Stay longer</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.startCard}>
          <View style={styles.startIntro}>
            <View style={styles.startEyebrow}>
              <MapPin size={15} color={Colors.peach} />
              <Text style={styles.startEyebrowText}>SAME PLACE. SHARED TASTE.</Text>
            </View>
            <Text style={styles.startTitle}>Already out? Start here.</Text>
            <Text style={styles.startBody}>
              Check in to meet someone here who shares your taste. One introduction at a time.
            </Text>
          </View>

          <View style={styles.steps}>
            {HOW_IT_WORKS.map((step, index) => (
              <View key={step.title} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.stepCopy}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepBody}>{step.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.startActions}>
            <PrimaryButton
              label="Find my spot"
              onPress={() => {
                setActionError(null);
                setPickerOpen(true);
              }}
            />
            <PrimaryButton
              label="Browse Discover instead"
              variant="quiet"
              onPress={() => router.push('/(tabs)/discover')}
            />
          </View>
        </View>
      )}

      {data.pending.length ? (
        <MatchSection title="People to link up with">
          {data.pending.map((match) => (
            <PeerCard
              key={match.matchId}
              name={match.peer.displayName}
              photoUrl={match.peer.photoUrl}
              bio={match.peer.bio}
              meta={`at ${match.placeName ?? 'this place'}`}
              actions={
                <>
                  <PrimaryButton
                    label="Link up"
                    fullWidth={false}
                    loading={busy}
                    onPress={() => {
                      void triggerHaptic.success();
                      void runAction(() => respondToMatch(match.matchId, 'accepted'));
                    }}
                  />
                  <PrimaryButton
                    label="Not now"
                    variant="secondary"
                    fullWidth={false}
                    disabled={busy}
                    onPress={() => void runAction(() => respondToMatch(match.matchId, 'declined'))}
                  />
                </>
              }
            />
          ))}
        </MatchSection>
      ) : null}

      {data.waiting.length ? (
        <MatchSection title="Waiting on them">
          {data.waiting.map((match) => (
            <PeerCard
              key={match.matchId}
              name={match.peer.displayName}
              photoUrl={match.peer.photoUrl}
              bio={match.peer.bio}
              meta={`at ${match.placeName ?? 'this place'}`}
              badge="You're in"
            />
          ))}
        </MatchSection>
      ) : null}

      {data.conversations.length ? (
        <MatchSection title="Your conversations">
          {data.conversations.map((conversation) => (
            <PeerCard
              key={conversation.conversationId}
              name={conversation.peer.displayName}
              photoUrl={conversation.peer.photoUrl}
              meta={
                remainingLabel(conversation.expiresAt, now)
                  ? `Private chat · ${remainingLabel(conversation.expiresAt, now)}`
                  : 'Chat expired'
              }
              onPress={() =>
                setOpenConversation({
                  conversationId: conversation.conversationId,
                  title: conversation.peer.displayName,
                  expiresAt: conversation.expiresAt,
                })
              }
              trailingAction={
                <PrimaryButton
                  label="End"
                  variant="danger"
                  fullWidth={false}
                  disabled={busy}
                  onPress={() => void runAction(() => endMatch(conversation.matchId))}
                />
              }
            />
          ))}
        </MatchSection>
      ) : null}

      {data.presence && !hasActivity ? (
        <Text style={styles.scanningNote}>
          {data.ghost
            ? 'Ghosting — you are checked in but hidden from new matches. Turn ghost off to be introduced.'
            : 'Scanning for the right people here — we will surface a match the moment there is one.'}
        </Text>
      ) : null}

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      <PlacePickerModal
        visible={pickerOpen}
        checkingIn={checkingIn}
        error={actionError}
        onClose={() => setPickerOpen(false)}
        onPick={(place) => void checkInAt(place)}
      />

      {openConversation ? (
        <ConversationModal
          conversation={openConversation}
          onClose={() => {
            setOpenConversation(null);
            void queryClient.invalidateQueries({ queryKey: ['linkup-snapshot'] });
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function useInterval(callback: () => void, ms: number) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function MatchSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.matchList}>{children}</View>
    </View>
  );
}

function PeerCard({
  name,
  photoUrl,
  bio,
  meta,
  badge,
  actions,
  trailingAction,
  onPress,
}: {
  name: string;
  photoUrl: string | null;
  bio?: string;
  meta: string;
  badge?: string;
  actions?: React.ReactNode;
  trailingAction?: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <View style={styles.peerCard}>
      <View style={styles.peerProfile}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.peerAvatar} />
        ) : (
          <View style={styles.peerAvatarFallback}>
            <Text style={styles.peerAvatarInitials}>{initials(name)}</Text>
          </View>
        )}
        <View style={styles.peerBody}>
          <View style={styles.peerRow}>
            <Text style={styles.peerName} numberOfLines={1}>
              {name}
            </Text>
            {badge ? <Text style={styles.peerBadge}>{badge}</Text> : null}
          </View>
          {bio ? (
            <Text style={styles.peerBio} numberOfLines={2}>
              {bio}
            </Text>
          ) : null}
          <Text style={styles.peerMeta}>{meta}</Text>
        </View>
      </View>
      {actions || onPress || trailingAction ? (
        <View style={styles.peerActions}>
          {actions}
          {onPress ? <PrimaryButton label="Open chat" onPress={onPress} fullWidth={false} /> : null}
          {trailingAction}
        </View>
      ) : null}
    </View>
  );
}

function PlacePickerModal({
  visible,
  checkingIn,
  error,
  onClose,
  onPick,
}: {
  visible: boolean;
  checkingIn: boolean;
  error: string | null;
  onClose: () => void;
  onPick: (place: DiscoveryCard) => void;
}) {
  const { location } = useEchooLocation();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const discovery = useQuery({
    queryKey: ['linkup-places', deferredSearch, location.city, location.latitude, location.longitude],
    enabled: visible,
    queryFn: ({ signal }) =>
      getDiscovery(
        {
          intent: deferredSearch ? 'search' : 'discover',
          query: deferredSearch || 'discover',
          location,
        },
        signal,
      ),
    staleTime: 60_000,
  });

  const places: DiscoveryCard[] = [];
  const feed = discovery.data;
  if (feed) {
    const seen = new Set<string>();
    for (const place of [...feed.nearby.items, ...feed.recommended.items, ...feed.all.items]) {
      const key = place.canonicalId || place.id;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(place);
      if (places.length >= 24) break;
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.pickerScreen}>
        <View style={styles.pickerHeader}>
          <View style={styles.pickerHeaderCopy}>
            <Text style={styles.pickerTitle}>Where are you?</Text>
            <Text style={styles.pickerSub}>Check in to be introduced to one member here.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close place picker" onPress={onClose} style={styles.pickerClose}>
            <X size={18} color={Colors.ink} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Search size={17} color={Colors.textMuted} />
          <TextInput
            value={search}
            accessibilityLabel="Search places"
            onChangeText={setSearch}
            placeholder="Search places, food, music..."
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>

        {error ? <Text selectable accessibilityRole="alert" style={styles.pickerError}>{error}</Text> : null}

        {discovery.isLoading ? (
          <Text style={styles.pickerNote}>Finding places nearby.</Text>
        ) : discovery.isError ? (
          <Text style={styles.pickerNote}>
            {discovery.error instanceof Error ? discovery.error.message : 'Could not load places. Try again.'}
          </Text>
        ) : places.length ? (
          <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent} keyboardShouldPersistTaps="handled">
            {places.map((place) => (
              <Pressable
                key={place.canonicalId || place.id}
                accessibilityRole="button"
                accessibilityLabel={`Check in at ${place.title}`}
                onPress={() => onPick(place)}
                style={({ pressed }) => [styles.placeRow, pressed && styles.pressed]}
                disabled={checkingIn}
              >
                <View style={styles.placeRowIcon}>
                  <MapPin size={15} color={Colors.peach} />
                </View>
                <View style={styles.placeRowCopy}>
                  <Text style={styles.placeRowTitle} numberOfLines={1}>
                    {place.title}
                  </Text>
                  <Text style={styles.placeRowMeta} numberOfLines={1}>
                    {place.city}
                    {place.community?.isHot ? ' · Live tonight' : ''}
                  </Text>
                </View>
                <Text style={styles.placeRowAction}>{checkingIn ? '…' : 'Check in'}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.pickerNote}>No verified places matched. Try a different search.</Text>
        )}
      </View>
    </Modal>
  );
}

type ChatMessage = { id: string; senderId: string; body: string; createdAt: string };

function ConversationModal({
  conversation,
  onClose,
}: {
  conversation: { conversationId: string; title: string; expiresAt: string };
  onClose: () => void;
}) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now);
  const listRef = useRef<ScrollView>(null);
  const writable = new Date(conversation.expiresAt).getTime() > Date.now();

  useInterval(() => setNow(Date.now()), 20_000);

  async function loadHistory(silent = false) {
    try {
      const { data: row } = await supabase
        .from('linkup_conversations')
        .select('id, expires_at')
        .eq('id', conversation.conversationId)
        .maybeSingle();
      if (!row) throw new Error('This conversation has ended.');
      const { data: rows, error: historyError } = await supabase
        .from('linkup_messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', conversation.conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (historyError) throw historyError;
      setMessages(
        (rows ?? []).map((message) => ({
          id: message.id,
          senderId: message.sender_id,
          body: message.body,
          createdAt: message.created_at,
        })),
      );
      setError(null);
    } catch (loadError) {
      if (!silent) setError(loadError instanceof Error ? loadError.message : 'Could not load chat.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
    // Keep both sides current without realtime: a light poll while open.
    const interval = setInterval(() => void loadHistory(true), 5_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.conversationId]);

  useEffect(() => {
    if (messages.length) listRef.current?.scrollToEnd({ animated: false });
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || body.length > 1000 || !user || sending || new Date(conversation.expiresAt).getTime() <= Date.now()) return;
    setSending(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from('linkup_messages').insert({
        conversation_id: conversation.conversationId,
        sender_id: user.id,
        body,
      });
      if (insertError) throw insertError;
      setDraft('');
      await loadHistory(true);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }

  const remaining = remainingLabel(conversation.expiresAt, now);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.chatScreen} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.chatHeader}>
          <View style={styles.chatHeaderCopy}>
            <Text style={styles.chatTitle}>{conversation.title}</Text>
            <Text style={styles.chatSub}>
              {remaining && remaining !== 'expired' ? `Private · ${remaining}` : 'Private · chat expired'}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close chat" onPress={onClose} style={styles.pickerClose}>
            <X size={18} color={Colors.ink} />
          </Pressable>
        </View>

        <ScrollView ref={listRef} style={styles.chatScroll} contentContainerStyle={styles.chatList} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          {loading ? (
            <Text style={styles.chatEmpty}>Loading messages.</Text>
          ) : messages.length ? (
            messages.map((message) => {
              const mine = message.senderId === user?.id;
              return (
                <View key={message.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={mine ? styles.bubbleMineText : styles.bubbleTheirsText}>{message.body}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.chatEmpty}>Say hello — messages disappear when the conversation ends.</Text>
          )}
        </ScrollView>

        {error ? <Text style={styles.chatError}>{error}</Text> : null}

        {writable ? (
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
            <View style={styles.composerBox}>
              <TextInput
                value={draft}
                accessibilityLabel="Message"
                onChangeText={setDraft}
                placeholder="Message…"
                placeholderTextColor={Colors.textMuted}
                style={styles.composerInput}
                maxLength={1000}
                returnKeyType="send"
                editable={!sending}
                onSubmitEditing={send}
              />
            </View>
            <PrimaryButton label="Send" onPress={send} loading={sending} disabled={!draft.trim()} fullWidth={false} />
          </View>
        ) : (
          <Text style={styles.chatExpired}>This conversation expired and is read-only.</Text>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  screen: {
    backgroundColor: Colors.background,
    padding: Spacing.lg,
    paddingBottom: 36,
    gap: Spacing.lg,
  },
  topCopy: {
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  kicker: {
    color: 'rgba(248, 245, 239, 0.45)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.6,
    lineHeight: 29,
  },
  startCard: {
    gap: Spacing.xl,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.xl,
  },
  startIntro: {
    gap: Spacing.sm,
  },
  startEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  startEyebrowText: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 10,
    letterSpacing: 1,
  },
  startActions: {
    gap: 2,
  },
  startTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  startBody: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 21,
    marginTop: -2,
  },
  steps: {
    gap: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.peachSubtle,
    marginTop: 1,
  },
  stepNumberText: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '700',
  },
  stepCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  stepTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    fontWeight: '600',
  },
  stepBody: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  presenceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.peachSubtle,
    padding: Spacing.lg,
  },
  presenceDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.success,
  },
  presenceCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  presenceTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
  },
  presenceSub: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  leaveButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  leaveText: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '600',
  },
  presenceTools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: -Spacing.sm + 2,
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  toolButtonActive: {
    borderColor: Colors.peach,
    backgroundColor: Colors.peach,
  },
  toolText: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '600',
  },
  toolTextActive: {
    color: Colors.background,
  },
  section: {
    gap: Spacing.md,
    marginTop: 4,
  },
  sectionTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.35,
  },
  matchList: {
    gap: Spacing.sm,
  },
  peerCard: {
    gap: Spacing.lg,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    padding: Spacing.lg,
  },
  peerProfile: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  pressed: {
    opacity: 0.78,
  },
  peerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  peerAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
  peerAvatarInitials: {
    color: Colors.peach,
    fontFamily: Fonts.uiBold,
    fontSize: 15,
    fontWeight: '700',
  },
  peerBody: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  peerName: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  peerBadge: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '600',
  },
  peerBio: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  peerMeta: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  peerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  scanningNote: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    backgroundColor: 'rgba(24, 22, 21, 0.72)',
    padding: Spacing.md,
  },
  actionError: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 19,
  },
  pickerScreen: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: Spacing['2xl'],
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  pickerHeaderCopy: {
    flex: 1,
    gap: 6,
  },
  pickerTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  pickerSub: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 19,
  },
  pickerClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
  searchBox: {
    marginHorizontal: Spacing.lg,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 15,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 15,
    paddingVertical: 0,
  },
  pickerList: {
    marginTop: Spacing.md,
  },
  pickerListContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 32,
    gap: Spacing.sm,
  },
  pickerNote: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    padding: Spacing.xl,
  },
  pickerError: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
  },
  placeRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.peachSubtle,
  },
  placeRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  placeRowTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    fontWeight: '600',
  },
  placeRowMeta: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 11,
  },
  placeRowAction: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '700',
  },
  chatScreen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing['2xl'],
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(248, 245, 239, 0.08)',
    gap: Spacing.md,
  },
  chatHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  chatTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  chatSub: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
    marginTop: 2,
  },
  chatScroll: {
    flex: 1,
  },
  chatList: {
    padding: Spacing.lg,
    gap: 8,
    paddingBottom: 24,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 20,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.cardAccent,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceElevated,
  },
  bubbleMineText: {
    color: Colors.inkDark,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTheirsText: {
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  chatEmpty: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  chatError: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    fontSize: 12,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 6,
  },
  chatExpired: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 13,
    textAlign: 'center',
    padding: Spacing.lg,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(248, 245, 239, 0.08)',
    gap: Spacing.sm,
  },
  composerBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    backgroundColor: 'rgba(24, 22, 21, 0.82)',
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
  },
  composerInput: {
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 15,
    paddingVertical: 12,
  },
});
