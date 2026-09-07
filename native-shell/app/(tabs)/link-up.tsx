import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Link2, LogOut, Radio, Search } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/src/components/primary-button';
import { ScreenLoading, ScreenMessage } from '@/src/components/screen-state';
import { useAuth } from '@/src/providers/auth-provider';
import {
  checkOut,
  endMatch,
  loadLinkUpSnapshot,
  respondToMatch,
  type LinkUpPendingMatch,
} from '@/src/services/linkup';
import { supabase } from '@/src/services/supabase';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

export default function LinkUpScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [openConversation, setOpenConversation] = useState<{ conversationId: string; title: string; expiresAt: string } | null>(null);

  const snapshot = useQuery({
    queryKey: ['linkup-snapshot', user?.id],
    enabled: Boolean(user),
    queryFn: () => loadLinkUpSnapshot(user!.id),
    refetchInterval: 30_000,
  });

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await snapshot.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Link Up action failed.');
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
        />
      </View>
    );
  }

  const hasActivity = data.pending.length || data.waiting.length || data.conversations.length;

  return (
    <ScrollView
      style={styles.screenScroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.screen}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topCopy}>
        <Text style={styles.kicker}>LINK UP</Text>
        <Text style={styles.title}>Meet the right people, here.</Text>
        <Text style={styles.body}>
          Check in at a place to match with one other member there. Presence is explicit and never derived from background location.
        </Text>
      </View>

      {data.presence ? (
        <View style={styles.presenceCard}>
          <View style={styles.presenceDot} />
          <View style={styles.presenceCopy}>
            <Text style={styles.presenceTitle}>
              {data.ghost ? 'Ghosting' : 'Presence active'} · {data.presence.placeName ?? 'your spot'}
            </Text>
            <Text style={styles.presenceSub}>
              {data.ghost ? 'Hidden from new matches.' : 'Scanning for the right person here.'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave this place"
            onPress={() => {
              void triggerHaptic.medium();
              void runAction(checkOut);
            }}
            style={styles.leaveButton}
          >
            <LogOut size={15} color={Colors.peach} />
            <Text style={styles.leaveText}>Leave</Text>
          </Pressable>
        </View>
      ) : (
        <ScreenMessage
          title="Ready when you are"
          body="Find a place nearby, check in when you arrive, and meet people who match your vibe."
          icon={<Search size={26} color={Colors.peach} />}
          action={<PrimaryButton label="Find a place" onPress={() => router.push('/(tabs)/discover')} />}
        />
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
                    onPress={() => {
                      void triggerHaptic.success();
                      void runAction(() => respondToMatch(match.matchId, 'accepted'));
                    }}
                  />
                  <PrimaryButton
                    label="Not now"
                    variant="secondary"
                    fullWidth={false}
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
              meta="Ephemeral chat · tap to open"
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
            ? "Ghosting — you're checked in but hidden from new matches."
            : "Scanning for the right people here — we'll surface a match the moment there's one."}
        </Text>
      ) : null}

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

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
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.peerCard, onPress && styles.peerCardTappable, pressed && styles.pressed]}
    >
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
        {actions ? <View style={styles.peerActions}>{actions}</View> : null}
      </View>
      {trailingAction}
    </Pressable>
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const writable = new Date(conversation.expiresAt).getTime() > Date.now();

  async function loadHistory() {
    try {
      const { data } = await supabase
        .from('linkup_conversations')
        .select('id, expires_at')
        .eq('id', conversation.conversationId)
        .maybeSingle();
      if (!data) throw new Error('This conversation has ended.');
      const { data: rows, error: historyError } = await supabase
        .from('linkup_messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', conversation.conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (historyError) throw historyError;
      setMessages(
        (rows ?? []).map((row) => ({
          id: row.id,
          senderId: row.sender_id,
          body: row.body,
          createdAt: row.created_at,
        }))
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load chat.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, [conversation.conversationId]);

  async function send() {
    const body = draft.trim();
    if (!body || body.length > 1000 || !user) return;
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
      await loadHistory();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.chatScreen}>
        <View style={styles.chatHeader}>
          <View>
            <Text style={styles.chatTitle}>{conversation.title}</Text>
            <Text style={styles.chatSub}>Ephemeral chat · text only</Text>
          </View>
        </View>

        <ScrollView style={styles.chatScroll} contentContainerStyle={styles.chatList}>
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
          <View style={styles.composer}>
            <View style={styles.composerBox}>
              <TextInput
                value={draft}
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
            <PrimaryButton label="Send" onPress={send} loading={sending} fullWidth={false} />
          </View>
        ) : (
          <Text style={styles.chatExpired}>This conversation expired and is read-only.</Text>
        )}
      </View>
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
    gap: Spacing.xl,
  },
  topCopy: {
    gap: 4,
    marginTop: 4,
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
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.7,
    lineHeight: 33,
  },
  body: {
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 330,
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
    gap: 2,
  },
  presenceTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    fontWeight: '600',
  },
  presenceSub: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  leaveButton: {
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
  section: {
    gap: Spacing.md,
  },
  sectionTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  matchList: {
    gap: Spacing.sm,
  },
  peerCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(24, 22, 21, 0.85)',
    padding: Spacing.md,
  },
  peerCardTappable: {
    borderColor: 'rgba(248, 245, 239, 0.16)',
  },
  pressed: {
    opacity: 0.78,
  },
  peerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  peerAvatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
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
    gap: 3,
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
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  peerMeta: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 11,
  },
  peerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 6,
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
  chatScreen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  chatHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing['2xl'],
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(248, 245, 239, 0.08)',
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
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(248, 245, 239, 0.08)',
    gap: Spacing.sm,
  },
  composerBox: {
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
