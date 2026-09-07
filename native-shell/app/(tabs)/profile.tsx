import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, useRouter } from 'expo-router';
import { ChevronRight, LogOut, Ticket, Pencil, RefreshCw } from 'lucide-react-native';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/src/components/primary-button';
import { useAuth } from '@/src/providers/auth-provider';
import { getMyTickets } from '@/src/services/api';
import { Colors, Fonts } from '@/src/theme/tokens';

const formatDate = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
};

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, profile, signOut, refreshProfile } = useAuth();

  const tickets = useQuery({
    queryKey: ['my-tickets', profile?.email],
    enabled: Boolean(profile?.email),
    queryFn: ({ signal }) => getMyTickets(profile!.email, signal),
  });

  const displayName = profile?.displayName ?? user?.email?.split('@')[0] ?? 'Member';

  return (
    <View style={styles.root}>
    <Tabs.Screen options={{ headerStyle: { backgroundColor: '#1d1e1b' } }} />
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.profileCard}>
        {profile?.photoUrl ? (
          <Image source={{ uri: profile.photoUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials}>{displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.profileCopy}>
          <Text style={styles.profileName} numberOfLines={2}>
            {displayName}
          </Text>
          {profile?.username ? <Text style={styles.profileHandle}>@{profile.username}</Text> : null}
          <Text style={styles.profileMeta} numberOfLines={1}>
            {profile?.homeCity ?? 'Greater Toronto Area'}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => router.push('/onboarding')} style={styles.editButton}><Pencil size={15} color={Colors.peachLight} /><Text style={styles.editLabel}>Edit profile</Text></Pressable>
      </View>

      {profile?.bio ? (
        <View style={styles.bioCard}>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      ) : null}

      {profile && (profile.interests.length || profile.eventStyles.length) ? (
        <View style={styles.tasteCard}>
          <Text style={styles.sectionLabel}>YOUR KIND OF PLANS</Text>
          <View style={styles.tasteGrid}>
            <TasteRow label="Into" values={profile.interests} />
            <TasteRow label="Plans" values={profile.eventStyles} />
            <TasteRow label="Budget" values={[profile.budget]} />
            <TasteRow label="Energy" values={[profile.energy]} />
          </View>

        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <View style={styles.sectionHeadCopy}>
            <Text style={styles.sectionTitle}>My passes</Text>
            <Text style={styles.sectionSub}>
              {tickets.data ? `${tickets.data.length} confirmed order${tickets.data.length === 1 ? '' : 's'}` : 'Loading orders…'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/tickets')}
            style={styles.ticketsHubBtn}
          >
            <Text style={styles.ticketsHubText}>Tickets Hub</Text>
            <ChevronRight size={13} color={Colors.peach} />
          </Pressable>
        </View>

        {tickets.isLoading ? (
          <Text style={styles.pendingNote}>Checking Echoo ticketing for your orders.</Text>
        ) : tickets.isError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Tickets could not load</Text>
            <Text style={styles.emptyBody}>
              {tickets.error instanceof Error ? tickets.error.message : 'Try again in a moment.'}
            </Text>
            <PrimaryButton label="Try again" onPress={() => tickets.refetch()} />
          </View>
        ) : tickets.data?.length ? (
          <View style={styles.ticketList}>
            {tickets.data.map((ticket) => (
              <Pressable
                key={ticket.id}
                accessibilityRole="button"
                onPress={() => router.push('/tickets')}
                style={styles.ticketCard}
              >
                {ticket.imageUrl ? (
                  <Image source={{ uri: ticket.imageUrl }} style={{ width: 58, height: 58, borderRadius: 12 }} resizeMode="cover" />
                ) : (
                  <View style={styles.ticketImageFallback}>
                    <Ticket size={18} color={Colors.peach} />
                  </View>
                )}
                <View style={styles.ticketCopy}>
                  <Text style={styles.ticketTitle} numberOfLines={2}>
                    {ticket.eventTitle || 'Echoo event'}
                  </Text>
                  <Text style={styles.ticketMeta} numberOfLines={1}>
                    {ticket.venueName}
                    {ticket.city ? ` · ${ticket.city}` : ''}
                  </Text>
                  <Text style={styles.ticketMeta}>
                    {formatDate(ticket.startsAt) ?? 'Date TBD'}
                    {ticket.tierName ? ` · ${ticket.tierName}` : ''}
                  </Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No passes yet</Text>
            <Text style={styles.emptyBody}>
              Your next night out starts here. Reserved tickets will appear in this space.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(tabs)/discover', params: { intent: 'events' } })} style={styles.browseLink}><Text style={styles.browseLabel}>Find an event</Text><ChevronRight size={16} color={Colors.peach} /></Pressable>
          </View>
        )}
      </View>

      <View style={styles.signOutRow}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <Pressable accessibilityRole="button" onPress={() => { void refreshProfile().then(() => queryClient.invalidateQueries({ queryKey: ['my-tickets'] })); }} style={({ pressed }) => [styles.accountRow, pressed && styles.pressed]}>
          <RefreshCw size={17} color="#bdbeb4" /><Text style={styles.accountLabel}>Refresh profile</Text><ChevronRight size={16} color="#858a7b" />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { void signOut().then(() => router.replace('/')); }} style={({ pressed }) => [styles.accountRow, pressed && styles.pressed]}>
          <LogOut size={17} color="#d4a296" /><Text style={[styles.accountLabel, { color: '#d4a296' }]}>Sign out</Text><ChevronRight size={16} color="#858a7b" />
        </Pressable>
      </View>
    </ScrollView>
    </View>
  );
}

function TasteRow({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <View style={styles.tasteRow}>
      <Text style={styles.tasteLabel}>{label}</Text>
      <Text style={styles.tasteValue} numberOfLines={2}>
        {values.join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1d1e1b' },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36, gap: 26 },
  profileCard: { alignItems: 'center', paddingTop: 8, gap: 14 },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: '#c7af8a' },
  avatarFallback: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#33392b', borderWidth: 1, borderColor: '#697153' },
  avatarInitials: { color: Colors.peach, fontFamily: Fonts.display, fontSize: 34 },
  profileCopy: { alignItems: 'center', gap: 5, width: '100%' },
  profileName: { color: Colors.ink, fontFamily: Fonts.display, fontSize: 29, lineHeight: 34, letterSpacing: -0.6, textAlign: 'center' },
  profileHandle: { color: '#cbb694', fontFamily: Fonts.uiMedium, fontSize: 13 },
  profileMeta: { color: '#b4b6ac', fontFamily: Fonts.ui, fontSize: 12 },
  editButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 17, borderWidth: 1, borderColor: '#494a40', borderRadius: 24 },
  editLabel: { fontFamily: Fonts.uiMedium, fontSize: 12, color: Colors.peachLight },
  bioCard: { paddingHorizontal: 20, marginTop: -10 },
  bioText: { color: '#c5c6bc', fontFamily: Fonts.ui, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  tasteCard: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#36392f', paddingVertical: 22, gap: 18 },
  sectionLabel: { color: '#a5ab99', fontFamily: Fonts.uiSemiBold, fontSize: 10, letterSpacing: 1.6 },
  tasteGrid: { gap: 14 },
  tasteRow: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  tasteLabel: { width: 58, color: '#a5ab99', fontFamily: Fonts.ui, fontSize: 13, lineHeight: 20 },
  tasteValue: { flex: 1, color: '#e6e6dc', fontFamily: Fonts.uiMedium, fontSize: 14, lineHeight: 20, textTransform: 'capitalize' },
  section: { gap: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeadCopy: { gap: 4 },
  sectionTitle: { color: Colors.ink, fontFamily: Fonts.display, fontSize: 25, letterSpacing: -0.5 },
  sectionSub: { color: '#a5ab99', fontFamily: Fonts.ui, fontSize: 12 },
  ticketsHubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(231, 201, 142, 0.3)',
    backgroundColor: 'rgba(231, 201, 142, 0.08)',
  },
  ticketsHubText: {
    fontFamily: Fonts.uiMedium,
    fontSize: 12,
    color: Colors.peach,
  },
  pendingNote: { color: '#b4b6ac', fontFamily: Fonts.ui, fontSize: 13 },
  ticketList: { gap: 12 },
  ticketCard: { flexDirection: 'row', gap: 14, borderRadius: 16, backgroundColor: '#292d24', padding: 16 },
  ticketImageFallback: { width: 58, height: 58, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#353c2b' },
  ticketCopy: { flex: 1, minWidth: 0, gap: 4 },
  ticketTitle: { color: Colors.ink, fontFamily: Fonts.uiSemiBold, fontSize: 14, lineHeight: 19 },
  ticketMeta: { color: '#b4b6ac', fontFamily: Fonts.ui, fontSize: 12, lineHeight: 17 },
  emptyCard: { borderRadius: 18, backgroundColor: '#292d24', padding: 21, gap: 8 },
  emptyTitle: { color: '#eee8da', fontFamily: Fonts.display, fontSize: 21 },
  emptyBody: { color: '#b9bfb0', fontFamily: Fonts.ui, fontSize: 13, lineHeight: 20 },
  browseLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  browseLabel: { fontFamily: Fonts.uiSemiBold, fontSize: 13, color: Colors.peach },
  signOutRow: { gap: 0, paddingTop: 4 },
  accountRow: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 54, borderBottomWidth: 1, borderBottomColor: '#34382e' },
  accountLabel: { flex: 1, fontFamily: Fonts.uiMedium, fontSize: 14, color: '#d2d5c9' },
  pressed: { opacity: 0.65 },
});
