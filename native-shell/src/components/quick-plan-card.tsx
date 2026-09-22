import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { QuickPlan, QuickPlanStop } from '@/src/models';
import { formatPlanBudget, formatStopCost } from '@/src/services/plan-format';
import { MapPin } from 'lucide-react-native';
import { PlanConnection } from '@/src/components/plan-connection';
import { Colors, Fonts } from '@/src/theme/tokens';

function PlacePhoto({ place }: { place: QuickPlanStop }) {
  const [failed, setFailed] = useState(false);
  return place.imageUrl && !failed ? <Image source={{ uri: place.imageUrl }} accessibilityLabel={place.name} style={styles.photo} resizeMode="cover" onError={() => setFailed(true)} /> :
    <View style={styles.fallback} accessibilityLabel="Photo unavailable"><MapPin size={28} color={Colors.peach} /></View>;
}

export function QuickPlanCard({ plan, renderProgress, onPlaceLayout }: { plan: QuickPlan; renderProgress?: (place: QuickPlanStop, index: number) => React.ReactNode; onPlaceLayout?: (id: string, y: number) => void }) {
  return <View style={styles.root}>
    <View style={styles.intro}>
      <Text style={styles.kicker}>YOUR OUTING{plan.city ? ` IN ${plan.city.toUpperCase()}` : ''}</Text>
      <Text style={styles.title}>{plan.title}</Text>
      <Text style={styles.body}>Built around {plan.anchorName}. {plan.stopCount} places{plan.stopCount < plan.requestedStopCount ? ` of ${plan.requestedStopCount} requested` : ''}.</Text>
      <Text style={styles.caption}>{plan.budgetStyle === 'value' ? 'Low' : plan.budgetStyle === 'elevated' ? 'High' : 'Regular'} budget preference. {plan.mood === 'hype' ? 'Lively' : plan.mood === 'curious' ? 'Curious' : 'Chill'} mood.</Text>
      <Text style={styles.budget}>{formatPlanBudget(plan)}</Text>
      <Text style={styles.body}>{plan.totalDurationMinutes ?? (plan.stopCount * 75 + plan.totalTravelMinutes)} minutes estimated for the outing, including {plan.totalTravelMinutes} minutes between places.</Text>
      <Text style={styles.caption}>CAD per person. Price-band estimates, not quotes. Travel, tax and tips are not included.</Text>
    </View>
    {plan.stops.map((place, index) => <View key={place.id} onLayout={(event) => onPlaceLayout?.(place.id, event.nativeEvent.layout.y)}>
      {index > 0 ? <PlanConnection minutes={place.travelMinutes} mode={plan.travelMode} verified={plan.travelVerified} /> : null}
      <View style={styles.place}>
        <PlacePhoto key={place.imageUrl} place={place} />
        <View style={styles.copy}>
          <Text style={styles.kicker}>{['FIRST', 'SECOND', 'THIRD'][index]} PLACE{place.isAnchor ? '. YOUR CHOICE' : ''}</Text>
          <Text style={styles.name}>{place.name}</Text>
          <Text style={styles.body}>{place.category.replace(/[_-]+/g, ' ')}{place.address ? `, ${place.address}` : ''}</Text>
          <View style={styles.facts}><Text style={styles.fact}>Suggested {place.arrivalAt ? `${new Date(place.arrivalAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' })}, ` : ''}{place.time}</Text><Text style={styles.fact}>Allow {place.durationMinutes ?? 75} min</Text></View>
          <Text style={styles.budget}>{formatStopCost(place)}</Text>
          <Text style={styles.caption}>{place.availability === 'open' ? 'Full visit fits listed hours. Confirm before leaving.' : place.availability === 'check_hours' ? 'The full visit does not fit listed hours. Choose another time.' : 'Hours unknown. This is not a confirmed opening time.'}</Text>
          {renderProgress?.(place, index)}
        </View>
      </View>
    </View>)}
    <Text style={styles.caption}>{plan.availabilityNote} Times between places are rough estimates, not mapped routes.</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 22 }, intro: { gap: 12, paddingBottom: 6 }, kicker: { fontFamily: Fonts.uiSemiBold, color: Colors.peach, fontSize: 10, letterSpacing: 1.5 },
  title: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 35, lineHeight: 40, letterSpacing: -1 },
  body: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 14, lineHeight: 21 },
  caption: { fontFamily: Fonts.ui, color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  budget: { fontFamily: Fonts.uiSemiBold, color: Colors.peach, fontSize: 16, lineHeight: 23 },
  place: { borderRadius: 22, overflow: 'hidden', backgroundColor: Colors.surfaceElevated },
  photo: { width: '100%', aspectRatio: 1.35, backgroundColor: Colors.surface },
  fallback: { minHeight: 180, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 12, backgroundColor: Colors.surface },
  fallbackName: { fontFamily: Fonts.display, color: Colors.textSecondary, fontSize: 28 },
  copy: { padding: 20, gap: 10 }, name: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 26, lineHeight: 32 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 6 }, fact: { fontFamily: Fonts.uiMedium, color: Colors.ink, fontSize: 14 },
  connection: { alignItems: 'center', gap: 9, paddingBottom: 22 }, line: { height: 17, width: 1, backgroundColor: Colors.peachBorder },
  connectionText: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 12 },
});
