import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Mail,
  Search,
  Sparkles,
  Ticket as TicketIcon,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { PrimaryButton } from '@/src/components/primary-button';
import { ScreenLoading, ScreenMessage } from '@/src/components/screen-state';
import type { Ticket, TicketSaleItem } from '@/src/models';
import { useAuth } from '@/src/providers/auth-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import { getMyTickets, getTicketsForSale } from '@/src/services/api';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const STORAGE_EMAIL_KEY = 'echoo_ticket_buyer_email';

function formatEventDate(value: string | null | undefined): string {
  if (!value) return 'Dates to be announced';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Dates to be announced';
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatFullDate(value: string | null | undefined): string {
  if (!value) return 'Date to be confirmed';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date to be confirmed';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

export default function TicketsScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { location } = useEchooLocation();
  const [tab, setTab] = useState<'on_sale' | 'my_passes'>('on_sale');
  const [emailInput, setEmailInput] = useState(profile?.email || user?.email || '');
  const [activeEmail, setActiveEmail] = useState(profile?.email || user?.email || '');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_EMAIL_KEY).then((saved) => {
      if (saved && !activeEmail) {
        setEmailInput(saved);
        setActiveEmail(saved);
      }
    });
  }, [activeEmail]);

  const onSaleQuery = useQuery({
    queryKey: ['tickets-for-sale', location.city],
    queryFn: ({ signal }) => getTicketsForSale(location.city, signal),
  });

  const myTicketsQuery = useQuery({
    queryKey: ['my-tickets', activeEmail],
    enabled: Boolean(activeEmail),
    queryFn: ({ signal }) => getMyTickets(activeEmail, signal),
  });

  function handleLookup() {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    void triggerHaptic.light();
    void AsyncStorage.setItem(STORAGE_EMAIL_KEY, trimmed);
    setActiveEmail(trimmed);
  }

  async function handleCopyCode(code: string, index: number) {
    if (!code) return;
    void triggerHaptic.selection();
    try {
      await Share.share({
        message: `Echoo Pass Code: ${code}`,
        title: 'Echoo Ticket Pass',
      });
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Best-effort
    }
  }

  function handleOpenTicket(url: string) {
    if (!url) return;
    void triggerHaptic.light();
    void Linking.openURL(url);
  }

  function handleAddToCalendar(ticket: Ticket) {
    void triggerHaptic.light();
    Alert.alert(
      'Echoo Calendar Pass',
      `${ticket.eventTitle || 'Echoo Event'}\n${formatFullDate(ticket.startsAt)}\nVenue: ${ticket.venueName || 'TBA'}`,
      [{ text: 'OK' }]
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        pointerEvents="none"
        colors={['#302c25', '#1d1e1b', '#1d1e1b']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ArrowLeft size={19} color={Colors.ink} />
        </Pressable>
        <BrandMark size="small" />
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={tab === 'on_sale' ? onSaleQuery.isRefetching : myTicketsQuery.isRefetching}
            onRefresh={() => {
              if (tab === 'on_sale') void onSaleQuery.refetch();
              else void myTicketsQuery.refetch();
            }}
            tintColor={Colors.peach}
          />
        }
      >
        <View style={styles.topCopy}>
          <Text style={styles.eyebrow}>ECHOO TICKETING</Text>
          <Text style={styles.title}>Passes & live access.</Text>
          <Text style={styles.subtitle}>
            Live event drops around {location.label}, priority booking, and your confirmed passes.
          </Text>
        </View>

        {/* Tab Selector */}
        <View style={styles.tabTrack}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: tab === 'on_sale' }}
            onPress={() => {
              void triggerHaptic.selection();
              setTab('on_sale');
            }}
            style={[styles.tabButton, tab === 'on_sale' && styles.tabButtonActive]}
          >
            <Sparkles size={14} color={tab === 'on_sale' ? Colors.inkDark : Colors.textMuted} />
            <Text style={[styles.tabButtonText, tab === 'on_sale' && styles.tabButtonTextActive]}>
              On Sale Now
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: tab === 'my_passes' }}
            onPress={() => {
              void triggerHaptic.selection();
              setTab('my_passes');
            }}
            style={[styles.tabButton, tab === 'my_passes' && styles.tabButtonActive]}
          >
            <TicketIcon size={14} color={tab === 'my_passes' ? Colors.inkDark : Colors.textMuted} />
            <Text style={[styles.tabButtonText, tab === 'my_passes' && styles.tabButtonTextActive]}>
              My Passes {myTicketsQuery.data?.length ? `(${myTicketsQuery.data.length})` : ''}
            </Text>
          </Pressable>
        </View>

        {/* ON SALE TAB */}
        {tab === 'on_sale' ? (
          onSaleQuery.isLoading ? (
            <ScreenLoading label="Loading live ticket drops…" />
          ) : onSaleQuery.isError ? (
            <ScreenMessage
              title="Tickets could not load"
              body="Unable to fetch live event drops. Pull to refresh."
              action={<PrimaryButton label="Try again" onPress={() => onSaleQuery.refetch()} />}
            />
          ) : onSaleQuery.data?.length ? (
            <View style={styles.salesList}>
              {onSaleQuery.data.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => handleOpenTicket(item.detailUrl)}
                  style={({ pressed }) => [styles.saleCard, pressed && styles.pressed]}
                >
                  <View style={styles.saleArt}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#2a2723' }]} />
                    )}
                    <LinearGradient
                      colors={['transparent', 'rgba(10,9,8,0.78)']}
                      locations={[0.3, 1]}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.saleBadge}>
                      <Text style={styles.saleBadgeText}>{item.statusLabel || 'Selling now'}</Text>
                    </View>
                    <View style={styles.salePriceBadge}>
                      <Text style={styles.salePriceBadgeText}>{item.priceLabel}</Text>
                    </View>
                  </View>
                  <View style={styles.saleCopy}>
                    <Text style={styles.saleTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.saleMeta} numberOfLines={1}>
                      {formatEventDate(item.startsAt)}
                      {item.subtitle ? ` · ${item.subtitle}` : ''}
                    </Text>
                    <View style={styles.saleActionRow}>
                      <Text style={styles.saleCategory}>{item.category || 'Live Event'}</Text>
                      <View style={styles.saleGetBtn}>
                        <Text style={styles.saleGetText}>{item.actionLabel || 'Get tickets'}</Text>
                        <ArrowUpRight size={13} color={Colors.inkDark} />
                      </View>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No live ticket drops right now</Text>
              <Text style={styles.emptyBody}>
                Live show allocations around {location.label} will appear here as promoters drop them.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/(tabs)/discover', params: { intent: 'events' } })}
                style={styles.browseLink}
              >
                <Text style={styles.browseLabel}>Explore city events</Text>
                <ChevronRight size={16} color={Colors.peach} />
              </Pressable>
            </View>
          )
        ) : null}

        {/* MY PASSES TAB */}
        {tab === 'my_passes' ? (
          <View style={styles.myPassesWrap}>
            {/* Email Lookup Pill */}
            <View style={styles.lookupPill}>
              <Mail size={16} color={Colors.peach} />
              <TextInput
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder="Enter your order email"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={handleLookup}
                style={styles.lookupInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search tickets"
                onPress={handleLookup}
                style={styles.lookupButton}
              >
                <Search size={16} color={Colors.inkDark} />
              </Pressable>
            </View>

            {myTicketsQuery.isLoading ? (
              <ScreenLoading label="Looking up your passes…" />
            ) : myTicketsQuery.data?.length ? (
              <View style={styles.passList}>
                {myTicketsQuery.data.map((ticket, idx) => (
                  <View key={ticket.id || idx} style={styles.passCard}>
                    <View style={styles.passArt}>
                      {ticket.imageUrl ? (
                        <Image source={{ uri: ticket.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      ) : (
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#24221d' }]} />
                      )}
                      <LinearGradient
                        colors={['transparent', 'rgba(10,9,8,0.85)']}
                        locations={[0.25, 1]}
                        style={StyleSheet.absoluteFill}
                      />
                      <View style={styles.passStatusPill}>
                        <Text style={styles.passStatusText}>CONFIRMED</Text>
                      </View>
                      {ticket.tierName ? (
                        <View style={styles.passTierPill}>
                          <Text style={styles.passTierText}>{ticket.tierName}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.passBody}>
                      <Text style={styles.passTitle} numberOfLines={2}>
                        {ticket.eventTitle || 'Echoo Event Pass'}
                      </Text>
                      <Text style={styles.passDate}>{formatFullDate(ticket.startsAt)}</Text>
                      <Text style={styles.passLocation} numberOfLines={1}>
                        {[ticket.venueName, ticket.city].filter(Boolean).join(' · ')}
                      </Text>

                      {/* Display Code Monospace Box */}
                      <View style={styles.codeCard}>
                        <View style={styles.codeWrap}>
                          <Text style={styles.codeLabel}>ENTRY CODE</Text>
                          <Text style={styles.codeText} numberOfLines={1}>
                            {ticket.ticketCode || 'TICKET-CODE-PENDING'}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => handleCopyCode(ticket.ticketCode, idx)}
                          style={styles.copyBtn}
                        >
                          {copiedIndex === idx ? (
                            <>
                              <Check size={13} color={Colors.peachLight} />
                              <Text style={styles.copyBtnText}>Copied</Text>
                            </>
                          ) : (
                            <>
                              <Copy size={13} color={Colors.peachLight} />
                              <Text style={styles.copyBtnText}>Share</Text>
                            </>
                          )}
                        </Pressable>
                      </View>

                      {/* Actions */}
                      <View style={styles.passActions}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => handleAddToCalendar(ticket)}
                          style={styles.passActionSecondary}
                        >
                          <Calendar size={14} color={Colors.ink} />
                          <Text style={styles.passActionSecondaryText}>Calendar</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            router.push({
                              pathname: '/(tabs)/discover',
                              params: { intent: 'events' },
                            })
                          }
                          style={styles.passActionPrimary}
                        >
                          <ExternalLink size={14} color={Colors.inkDark} />
                          <Text style={styles.passActionPrimaryText}>View event</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Nothing saved here yet</Text>
                <Text style={styles.emptyBody}>
                  Your Echoo passes appear automatically after checkout. Enter the email address used during order to
                  restore them on this device.
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#1d1e1b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 245, 239, 0.06)',
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 80,
    gap: 18,
  },
  topCopy: {
    gap: 6,
  },
  eyebrow: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  subtitle: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  tabTrack: {
    flexDirection: 'row',
    borderRadius: 16,
    backgroundColor: 'rgba(248, 245, 239, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    padding: 4,
    gap: 6,
  },
  tabButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
  },
  tabButtonActive: {
    backgroundColor: Colors.peach,
  },
  tabButtonText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    color: Colors.textMuted,
  },
  tabButtonTextActive: {
    color: Colors.inkDark,
  },
  salesList: {
    gap: 16,
  },
  saleCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.09)',
    backgroundColor: 'rgba(248, 245, 239, 0.035)',
    overflow: 'hidden',
  },
  saleArt: {
    height: 160,
    position: 'relative',
    backgroundColor: '#262420',
  },
  saleBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(10, 9, 8, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.18)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  saleBadgeText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 10,
    color: Colors.ink,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  salePriceBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(247, 213, 178, 0.92)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  salePriceBadgeText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    color: Colors.inkDark,
    fontWeight: '700',
  },
  saleCopy: {
    padding: 16,
    gap: 8,
  },
  saleTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 21,
    fontWeight: '600',
    lineHeight: 25,
  },
  saleMeta: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 13,
  },
  saleActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  saleCategory: {
    fontFamily: Fonts.uiMedium,
    fontSize: 12,
    color: Colors.peachLight,
  },
  saleGetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.peach,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saleGetText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.inkDark,
  },
  myPassesWrap: {
    gap: 16,
  },
  lookupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(24, 22, 21, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 16,
    minHeight: 52,
    gap: 10,
  },
  lookupInput: {
    flex: 1,
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 14,
    paddingVertical: 0,
  },
  lookupButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passList: {
    gap: 18,
  },
  passCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(24, 22, 21, 0.88)',
    overflow: 'hidden',
  },
  passArt: {
    height: 140,
    position: 'relative',
    backgroundColor: '#24221d',
  },
  passStatusPill: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(10, 9, 8, 0.7)',
    borderWidth: 1,
    borderColor: Colors.peach,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  passStatusText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 9,
    color: Colors.peach,
    letterSpacing: 0.8,
  },
  passTierPill: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(10, 9, 8, 0.65)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  passTierText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 10,
    color: Colors.ink,
    letterSpacing: 0.4,
  },
  passBody: {
    padding: 16,
    gap: 8,
  },
  passTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 27,
  },
  passDate: {
    color: Colors.peach,
    fontFamily: Fonts.uiMedium,
    fontSize: 13,
  },
  passLocation: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(10, 9, 8, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  codeWrap: {
    gap: 2,
  },
  codeLabel: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 9,
    letterSpacing: 1,
    color: 'rgba(248, 245, 239, 0.45)',
  },
  codeText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 16,
    letterSpacing: 1.2,
    color: Colors.peachLight,
    fontWeight: '700',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(247, 213, 178, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(247, 213, 178, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  copyBtnText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    color: Colors.peachLight,
  },
  passActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  passActionSecondary: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.15)',
    backgroundColor: 'rgba(248, 245, 239, 0.04)',
  },
  passActionSecondaryText: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
  },
  passActionPrimary: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: Colors.peach,
  },
  passActionPrimaryText: {
    color: Colors.inkDark,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 20,
    backgroundColor: 'rgba(248, 245, 239, 0.035)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    padding: 22,
    gap: 8,
  },
  emptyTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 20,
    fontWeight: '600',
  },
  emptyBody: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 19,
  },
  browseLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  browseLabel: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    color: Colors.peach,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.99 }],
  },
});
