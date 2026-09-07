import { useMutation } from '@tanstack/react-query';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Send, Sparkles } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenLoading } from '@/src/components/screen-state';
import type { QuickPlan } from '@/src/models';
import { useAuth } from '@/src/providers/auth-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import { askCompanion, EchooApiError } from '@/src/services/api';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const SUGGESTIONS = [
  'Somewhere low-key tonight',
  'Good food then live music',
  'Date night, walkable',
  'Somewhere new this weekend',
];

type Turn =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; message: string; plan: QuickPlan | null };

const readAssistantMessage = (payload: Record<string, unknown>) => {
  const ai = payload.ai as Record<string, unknown> | undefined;
  if (ai && typeof ai.assistantMessage === 'string' && ai.assistantMessage.trim()) {
    return ai.assistantMessage.trim();
  }
  const ontario = payload.ontario as Record<string, unknown> | undefined;
  const plan = ontario?.plan as Record<string, unknown> | undefined;
  if (plan && typeof plan.explanation === 'string' && plan.explanation.trim()) {
    return plan.explanation.trim();
  }
  if (typeof payload.summary === 'string' && payload.summary.trim()) return payload.summary;
  return 'Echoo could not answer that just now. Try a more specific ask.';
};

export default function PlannerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prompt?: string; quickPlan?: string }>();
  const { profile } = useAuth();
  const { location } = useEchooLocation();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const appliedRef = useRef(false);

  const companion = useMutation({
    mutationFn: async (query: string) => {
      const payload = await askCompanion({ query, location });
      setTurns((current) => [
        ...current,
        { kind: 'assistant', message: readAssistantMessage(payload), plan: null },
      ]);
      return payload;
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof EchooApiError
          ? mutationError.message
          : 'Echoo could not reach the planner. Try again in a moment.'
      );
    },
  });

  function ask(query: string) {
    const trimmed = query.trim();
    if (!trimmed || companion.isPending) return;
    void triggerHaptic.light();
    setError(null);
    setTurns((current) => [...current, { kind: 'user', text: trimmed }]);
    setInput('');
    companion.mutate(trimmed);
  }

  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (params.quickPlan) {
      try {
        const plan = JSON.parse(params.quickPlan) as QuickPlan;
        setTurns([{ kind: 'assistant', message: plan.subtitle || plan.availabilityNote, plan }]);
        return;
      } catch {
        // Fall through to the prompt path.
      }
    }
    if (params.prompt) ask(params.prompt);
  }, [params.prompt, params.quickPlan]);

  const profileSignals = profile
    ? `${profile.energy} energy · ${profile.budget} budget · into ${profile.interests.slice(0, 3).join(', ')}`
    : 'Guest taste';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topCopy}>
          <Text style={styles.kicker}>TONIGHT&apos;S PLAN</Text>
          <Text style={styles.title}>Tell Echoo the vibe.</Text>
          <Text style={styles.body}>
            A real multi-stop route from Echoo&apos;s planner, matched to {profileSignals}.
          </Text>
        </View>

        <View style={styles.suggestions}>
          {SUGGESTIONS.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              onPress={() => ask(suggestion)}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
            >
              <Sparkles size={13} color={Colors.peach} />
              <Text style={styles.suggestionText}>{suggestion}</Text>
            </Pressable>
          ))}
        </View>

        {companion.isPending ? (
          <View style={styles.thinking}>
            <ScreenLoading label="Echoo is planning it." />
          </View>
        ) : null}

        {turns.map((turn, index) =>
          turn.kind === 'user' ? (
            <View key={`u-${index}`} style={styles.userBubble}>
              <Text style={styles.userText}>{turn.text}</Text>
            </View>
          ) : (
            <View key={`a-${index}`} style={styles.assistantBlock}>
              <Text style={styles.assistantText}>{turn.message}</Text>
              {turn.plan ? (
                <View style={styles.planCard}>
                  <View style={styles.planHead}>
                    <Text style={styles.planTitle}>{turn.plan.title}</Text>
                    <Text style={styles.planMeta}>{turn.plan.totalTravelMinutes} min travel</Text>
                  </View>
                  <Text style={styles.planNote}>{turn.plan.availabilityNote}</Text>
                  {turn.plan.stops.map((stop, stopIndex) => (
                    <View key={stop.id} style={styles.stopRow}>
                      <View style={[styles.stopNumber, stopIndex === 0 && styles.stopNumberAnchor]}>
                        <Text style={styles.stopNumberText}>{stopIndex + 1}</Text>
                      </View>
                      <View style={styles.stopCopy}>
                        <Text style={styles.stopName} numberOfLines={1}>
                          {stop.name}
                        </Text>
                        <Text style={styles.stopMeta} numberOfLines={1}>
                          {stop.time} · {stop.category} · {stop.priceLabel}
                        </Text>
                        {stop.reason ? (
                          <Text style={styles.stopReason} numberOfLines={2}>
                            {stop.reason}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          )
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.inputBar}>
        <View style={styles.inputBox}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Describe the night you want…"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            returnKeyType="send"
            multiline
            onSubmitEditing={() => ask(input)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send to planner"
            disabled={!input.trim() || companion.isPending}
            onPress={() => ask(input)}
            style={({ pressed }) => [
              styles.sendButton,
              input.trim() && !companion.isPending ? styles.sendActive : styles.sendIdle,
              pressed && styles.pressed,
            ]}
          >
            <Send size={16} color={input.trim() ? Colors.background : Colors.textMuted} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: 30,
    gap: Spacing.lg,
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
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    backgroundColor: 'rgba(24, 22, 20, 0.72)',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  suggestionText: {
    color: 'rgba(248, 245, 239, 0.75)',
    fontFamily: Fonts.uiMedium,
    fontSize: 12,
  },
  thinking: {
    marginTop: -6,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: 20,
    borderBottomRightRadius: 6,
    backgroundColor: Colors.cardAccent,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  userText: {
    color: Colors.inkDark,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  assistantBlock: {
    gap: Spacing.sm,
  },
  assistantText: {
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 21,
  },
  planCard: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    backgroundColor: 'rgba(24, 22, 21, 0.88)',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  planTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  planMeta: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '600',
  },
  planNote: {
    color: 'rgba(248, 245, 239, 0.52)',
    fontFamily: Fonts.ui,
    fontSize: 11,
    lineHeight: 16,
  },
  stopRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  stopNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
  stopNumberAnchor: {
    backgroundColor: Colors.peach,
  },
  stopNumberText: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '700',
  },
  stopCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  stopName: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 14,
    fontWeight: '600',
  },
  stopMeta: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  stopReason: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 11,
    lineHeight: 16,
  },
  error: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    backgroundColor: 'rgba(239,68,68,0.1)',
    padding: 12,
  },
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(248, 245, 239, 0.08)',
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    backgroundColor: 'rgba(24, 22, 21, 0.82)',
    paddingHorizontal: Spacing.md,
  },
  input: {
    flex: 1,
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 15,
    minHeight: 48,
    maxHeight: 110,
    paddingVertical: 12,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  sendActive: {
    backgroundColor: Colors.cardAccent,
  },
  sendIdle: {
    backgroundColor: Colors.surfaceElevated,
  },
  pressed: {
    opacity: 0.78,
  },
});
