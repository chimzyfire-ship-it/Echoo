import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { claimCityBadge, getCityScores, type CityScore } from '@/src/services/outing';
import { Colors, Fonts } from '@/src/theme/tokens';

export function CityScoreSection({ userId }: { userId?: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const scores = useQuery({ queryKey: ['city-scores', userId], enabled: Boolean(userId), queryFn: () => getCityScores(userId!), retry: false });
  useFocusEffect(useCallback(() => { if (userId) void scores.refetch(); }, [userId]));
  const claim = useMutation({
    mutationFn: (score: CityScore) => claimCityBadge(userId!, score),
    onSuccess: () => client.invalidateQueries({ queryKey: ['city-scores', userId] }),
    retry: false,
  });
  const top = scores.data?.scores[0];
  const leaders = scores.data?.scores.filter((score) => score.visit_count === top?.visit_count) || [];
  return <View style={styles.section}>
    <Text style={styles.kicker}>YOUR CITY, DISCOVERED</Text>
    <Text style={styles.title}>Every visit adds up.</Text>
    <Text style={styles.body}>Earn 10 points per distinct verified place per local day. At 100, claim a city milestone badge. Claiming deducts 100; any extra points carry forward.</Text>
    <Text style={styles.note}>City badges are keepsakes, not money, discounts or partner offers. Arrival requires a foreground location check. Planning and pressing next do not earn points.</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/planner', params: { quickPlan: 'resume' } })} style={styles.link}><Text style={styles.linkText}>Return to my outing</Text></Pressable>
    {!userId ? <Text style={styles.body}>Sign in to keep verified visits and city badges.</Text> : scores.isPending ? <Text style={styles.body}>Loading verified city scores...</Text> : scores.isError ? <>
      <Text selectable style={styles.body}>{scores.error.message}</Text>
      <Pressable accessibilityRole="button" style={styles.link} onPress={() => void scores.refetch()}><Text style={styles.linkText}>Try again</Text></Pressable>
    </> : <>
      {top ? <Text style={styles.body}>{leaders.length > 1 ? 'Most visited cities' : 'Most visited city'}: {leaders.map((score) => score.city_name).join(', ')}. {top.visit_count} verified {top.visit_count === 1 ? 'visit' : 'visits'}{leaders.length > 1 ? ' each' : ''}.</Text> : <Text style={styles.body}>No verified visits yet. Your first arrival starts a separate score for that city.</Text>}
      {scores.data?.scores.map((score) => <View key={score.city_key} style={styles.city}>
        <Text style={styles.cityName}>{score.city_name}</Text>
        <Text selectable style={styles.points}>{Math.min(100, score.points)} <Text style={styles.denominator}>/ 100 points</Text></Text>
        {score.points > 100 ? <Text style={styles.note}>{score.points - 100} extra points carry forward after claiming.</Text> : null}
        <View accessibilityRole="progressbar" accessibilityLabel={`${score.city_name} city score`} accessibilityValue={{ min: 0, max: 100, now: Math.min(100, score.points), text: `${score.points} points, ${score.badge_count} badges` }} style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, score.points)}%` }]} /></View>
        <Text style={styles.note}>{score.visit_count} verified visits. {score.badge_count} city badges earned.</Text>
        {score.points >= 100 ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: claim.isPending }} disabled={claim.isPending} style={styles.claim} onPress={() => claim.mutate(score)}><Text style={styles.claimText}>{claim.isPending ? 'Confirming with server...' : `Claim ${score.city_name} badge ${score.badge_count + 1}`}</Text></Pressable> : <Text style={styles.body}>{100 - score.points} points to your next city badge.</Text>}
      </View>)}
      {claim.isError ? <Text selectable accessibilityLiveRegion="polite" style={styles.body}>{claim.error.message} Claim not confirmed on this device. Reconnect and retry the same milestone.</Text> : null}
      {claim.isSuccess ? <Text accessibilityLiveRegion="polite" style={styles.body}>City badge saved. Keep exploring; your next milestone has begun.</Text> : null}
      {scores.data?.badges.length ? <View style={styles.badges}><Text style={styles.cityName}>Your city badges</Text>{scores.data.badges.map((badge) => <View key={badge.id} style={styles.badge}>
        <Text style={styles.badgeName}>{badge.city_name}</Text><Text style={styles.note}>City milestone {badge.milestone}. Earned {new Date(badge.earned_at).toLocaleDateString('en-CA')}.</Text>
      </View>)}</View> : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 16, borderTopWidth: 1, borderColor: Colors.peachBorder, paddingTop: 26 },
  kicker: { fontFamily: Fonts.uiSemiBold, color: Colors.peach, fontSize: 10, letterSpacing: 1.6 }, title: { fontFamily: Fonts.display, fontSize: 30, color: Colors.ink },
  body: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 14, lineHeight: 21 }, note: { fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 12, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: 'center' }, linkText: { fontFamily: Fonts.uiSemiBold, color: Colors.peach, fontSize: 14 },
  city: { backgroundColor: Colors.surface, padding: 22, borderRadius: 18, gap: 12 }, cityName: { fontFamily: Fonts.display, fontSize: 24, color: Colors.ink },
  points: { fontFamily: Fonts.display, color: Colors.peach, fontSize: 42, fontVariant: ['tabular-nums'] }, denominator: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 14 },
  track: { height: 4, backgroundColor: Colors.peachSubtle, overflow: 'hidden', borderRadius: 2 }, fill: { height: 4, backgroundColor: Colors.peach },
  claim: { minHeight: 48, padding: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.peach, borderRadius: 12 }, claimText: { fontFamily: Fonts.uiSemiBold, color: Colors.inkDark, fontSize: 14 },
  badges: { gap: 14 }, badge: { padding: 20, borderWidth: 1, borderColor: Colors.peachBorder, borderRadius: 4, gap: 6 }, badgeName: { fontFamily: Fonts.display, color: Colors.peach, fontSize: 23 },
});
