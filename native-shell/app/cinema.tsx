import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Film,
  Play,
  RotateCw,
  Search,
  Sparkles,
  Star,
} from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { PrimaryButton } from '@/src/components/primary-button';
import { ScreenLoading, ScreenMessage } from '@/src/components/screen-state';
import type { MovieItem } from '@/src/models';
import { getMoviesFeed } from '@/src/services/api';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const FALLBACK_FILMS: MovieItem[] = [
  {
    tmdb_id: 1184918,
    title: 'The Wild Robot',
    overview:
      'A luminous animated survival story with heart, wonder, and the kind of trailer that instantly feels like a shared plan.',
    curated_mood: 'Tender sci-fi adventure',
    trailer_youtube_id: '67vbA5ZJdKQ',
    has_trailer: true,
    poster_url: 'https://image.tmdb.org/t/p/w342/wTnV3PCVW5O92JMrFvvrRil3RsH.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/w780/9l1eZiJHmhra55GAKXr1kf8qW2W.jpg',
    release_date: '2024-09-27',
    year: '2024',
    vote_average: 8.4,
    genres: ['Animation', 'Sci-Fi', 'Family'],
    runtime_minutes: 102,
  },
  {
    tmdb_id: 693134,
    title: 'Dune: Part Two',
    overview:
      'Huge scale, desert myth, and a trailer built for the biggest screen you can find. An epic cinema night out.',
    curated_mood: 'Epic cinema night',
    trailer_youtube_id: 'Way9Dexny3w',
    has_trailer: true,
    poster_url: 'https://image.tmdb.org/t/p/w342/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/w780/xOMo8BRK7PfcJv9JCnx7s520DRq.jpg',
    release_date: '2024-03-01',
    year: '2024',
    vote_average: 8.2,
    genres: ['Sci-Fi', 'Adventure'],
    runtime_minutes: 166,
  },
  {
    tmdb_id: 1022789,
    title: 'Inside Out 2',
    overview:
      'Bright, funny, and easy to say yes to when the group needs something lighter and wonderfully relatable.',
    curated_mood: 'Feel-good group pick',
    trailer_youtube_id: 'LEjhY15eCx0',
    has_trailer: true,
    poster_url: 'https://image.tmdb.org/t/p/w342/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/w780/xg27NrXi79CGYrPQRAxZzyQy9R7.jpg',
    release_date: '2024-06-14',
    year: '2024',
    vote_average: 7.6,
    genres: ['Animation', 'Comedy', 'Family'],
    runtime_minutes: 96,
  },
  {
    tmdb_id: 402431,
    title: 'Wicked',
    overview:
      'Big vocals, polished fantasy, and date-night theatrical energy in one trailer worth planning around.',
    curated_mood: 'Musical spectacle',
    trailer_youtube_id: '6COmYeLsz4c',
    has_trailer: true,
    poster_url: 'https://image.tmdb.org/t/p/w342/xDGbZ0JJ3mYaGKy4Nzd9Kph6M9L.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/w780/uKb22E5ww9bXhZ9L48NCQC34q0.jpg',
    release_date: '2024-11-22',
    year: '2024',
    vote_average: 7.4,
    genres: ['Drama', 'Fantasy', 'Musical'],
    runtime_minutes: 160,
  },
];

export default function CinemaScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const [selectedMovie, setSelectedMovie] = useState<MovieItem | null>(null);

  const moviesQuery = useQuery({
    queryKey: ['movies-feed'],
    queryFn: ({ signal }) => getMoviesFeed(signal),
  });

  const rails = moviesQuery.data;
  const allMovies: MovieItem[] = [
    ...(rails?.now_playing?.movies ?? []),
    ...(rails?.trending?.movies ?? []),
    ...(rails?.upcoming?.movies ?? []),
    ...(rails?.date_night?.movies ?? []),
    ...FALLBACK_FILMS,
  ];

  const uniqueMovies = Array.from(
    new Map(allMovies.map((m) => [m.tmdb_id || m.title, m])).values()
  );

  const featured = selectedMovie || uniqueMovies[0] || FALLBACK_FILMS[0];

  function openTrailer(film: MovieItem) {
    void triggerHaptic.light();
    const videoId = film.trailer_youtube_id;
    if (videoId) {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      void Linking.openURL(url);
    } else {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${film.title} official trailer`)}`;
      void Linking.openURL(searchUrl);
    }
  }

  function handleSelectMovie(movie: MovieItem) {
    void triggerHaptic.selection();
    setSelectedMovie(movie);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function handleNextTrailer() {
    void triggerHaptic.selection();
    const currentIndex = uniqueMovies.findIndex(
      (m) => (m.tmdb_id || m.title) === (featured.tmdb_id || featured.title)
    );
    const nextIndex = (currentIndex + 1) % uniqueMovies.length;
    setSelectedMovie(uniqueMovies[nextIndex]);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function handleFindScreenings(film: MovieItem) {
    void triggerHaptic.light();
    router.push({
      pathname: '/(tabs)/discover',
      params: { intent: 'events' },
    });
  }

  const posterWidth = 120;
  const posterHeight = 175;

  return (
    <View style={styles.screen}>
      <LinearGradient
        pointerEvents="none"
        colors={['#302c25', '#1d1e1b', '#1d1e1b']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
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
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={moviesQuery.isRefetching}
            onRefresh={() => void moviesQuery.refetch()}
            tintColor={Colors.peach}
          />
        }
      >
        <View style={styles.topCopy}>
          <Text style={styles.eyebrow}>ECHOO CINEMA ROOM</Text>
          <Text style={styles.title}>Trailers worth a night out.</Text>
          <Text style={styles.subtitle}>
            A compact cinema room for beautiful trailers, date-night films, and movies that feel worth planning around.
          </Text>
        </View>

        {/* Featured Trailer Stage */}
        <View style={styles.stageCard}>
          <View style={styles.stageArt}>
            {featured.backdrop_url || featured.poster_url ? (
              <Image
                source={{ uri: featured.backdrop_url || featured.poster_url || '' }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#211f1c' }]} />
            )}
            <LinearGradient
              colors={['rgba(15,14,12,0.15)', 'rgba(15,14,12,0.92)']}
              locations={[0.2, 1]}
              style={StyleSheet.absoluteFill}
            />

            {/* Glowing Play Trailer Button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Watch trailer for ${featured.title}`}
              onPress={() => openTrailer(featured)}
              style={({ pressed }) => [styles.playTrigger, pressed && styles.pressed]}
            >
              <View style={styles.playCircle}>
                <Play size={24} color={Colors.inkDark} fill={Colors.inkDark} style={{ marginLeft: 3 }} />
              </View>
              <Text style={styles.playTriggerText}>Watch Trailer</Text>
            </Pressable>

            {/* Badges */}
            <View style={styles.stageTopRow}>
              <View style={styles.stageMoodBadge}>
                <Film size={11} color={Colors.peach} />
                <Text style={styles.stageMoodText}>
                  {featured.curated_mood || (featured.is_date_night_pick ? 'Date-Night Pick' : 'Now Playing')}
                </Text>
              </View>
              {featured.vote_average ? (
                <View style={styles.ratingBadge}>
                  <Star size={11} color="#f5cf7e" fill="#f5cf7e" />
                  <Text style={styles.ratingText}>{featured.vote_average.toFixed(1)}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Stage Details */}
          <View style={styles.stageBody}>
            <Text style={styles.stageTitle} numberOfLines={2}>
              {featured.title}
            </Text>

            {/* Chips row: Year, Runtime, Genres */}
            <View style={styles.chipsRow}>
              {featured.year ? (
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{featured.year}</Text>
                </View>
              ) : null}
              {featured.runtime_minutes ? (
                <View style={styles.metaChip}>
                  <Clock size={10} color={Colors.textMuted} />
                  <Text style={styles.metaChipText}>{featured.runtime_minutes}m</Text>
                </View>
              ) : null}
              {featured.genres?.slice(0, 2).map((genre) => (
                <View key={genre} style={styles.genreChip}>
                  <Text style={styles.genreChipText}>{genre}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.stageOverview} numberOfLines={4}>
              {featured.overview || featured.curated_copy || 'Official trailer in theatres now.'}
            </Text>

            {/* Actions */}
            <View style={styles.stageActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => handleFindScreenings(featured)}
                style={styles.stageActionPrimary}
              >
                <Search size={14} color={Colors.inkDark} />
                <Text style={styles.stageActionPrimaryText}>Find screenings</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleNextTrailer}
                style={styles.stageActionSecondary}
              >
                <RotateCw size={14} color={Colors.ink} />
                <Text style={styles.stageActionSecondaryText}>Next</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* NOW SCREENING QUICK QUEUE */}
        <View style={styles.queueSection}>
          <View style={styles.sectionHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Sparkles size={13} color={Colors.peach} />
              <Text style={styles.sectionKicker}>NOW SCREENING</Text>
            </View>
            <Text style={styles.queueCount}>{uniqueMovies.slice(0, 8).length} films</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.queueRail}>
            {uniqueMovies.slice(0, 8).map((film) => {
              const isCurrent = (film.tmdb_id || film.title) === (featured.tmdb_id || featured.title);
              return (
                <Pressable
                  key={film.tmdb_id || film.title}
                  accessibilityRole="button"
                  onPress={() => handleSelectMovie(film)}
                  style={({ pressed }) => [
                    styles.queueCard,
                    isCurrent && styles.queueCardActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Image
                    source={{ uri: film.poster_url || film.backdrop_url || '' }}
                    style={styles.queueThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.queueCopy}>
                    <Text style={[styles.queueTitle, isCurrent && styles.queueTitleActive]} numberOfLines={1}>
                      {film.title}
                    </Text>
                    <Text style={styles.queueMood} numberOfLines={1}>
                      {film.curated_mood || film.genres?.[0] || 'Film'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* CINEMA RAILS */}
        {moviesQuery.isLoading ? (
          <ScreenLoading label="Curating trailers…" />
        ) : null}

        {rails?.now_playing?.movies.length ? (
          <CinemaRailSection
            rail={rails.now_playing}
            posterWidth={posterWidth}
            posterHeight={posterHeight}
            selectedId={featured.tmdb_id}
            onSelect={handleSelectMovie}
          />
        ) : null}

        {rails?.date_night?.movies.length ? (
          <CinemaRailSection
            rail={rails.date_night}
            posterWidth={posterWidth}
            posterHeight={posterHeight}
            selectedId={featured.tmdb_id}
            onSelect={handleSelectMovie}
          />
        ) : null}

        {rails?.trending?.movies.length ? (
          <CinemaRailSection
            rail={rails.trending}
            posterWidth={posterWidth}
            posterHeight={posterHeight}
            selectedId={featured.tmdb_id}
            onSelect={handleSelectMovie}
          />
        ) : null}

        {rails?.upcoming?.movies.length ? (
          <CinemaRailSection
            rail={rails.upcoming}
            posterWidth={posterWidth}
            posterHeight={posterHeight}
            selectedId={featured.tmdb_id}
            onSelect={handleSelectMovie}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function CinemaRailSection({
  rail,
  posterWidth,
  posterHeight,
  selectedId,
  onSelect,
}: {
  rail: { label: string; eyebrow: string; movies: MovieItem[] };
  posterWidth: number;
  posterHeight: number;
  selectedId?: number;
  onSelect: (movie: MovieItem) => void;
}) {
  return (
    <View style={styles.railSection}>
      <View style={styles.sectionHead}>
        <Text style={styles.railTitle}>{rail.label}</Text>
        <Text style={styles.railEyebrow}>{rail.eyebrow}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.postersRail}>
        {rail.movies.map((movie) => {
          const isSelected = movie.tmdb_id === selectedId;
          return (
            <Pressable
              key={movie.tmdb_id}
              accessibilityRole="button"
              onPress={() => onSelect(movie)}
              style={({ pressed }) => [
                styles.posterCard,
                { width: posterWidth },
                isSelected && styles.posterCardSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.posterImageWrap, { height: posterHeight }]}>
                {movie.poster_url ? (
                  <Image source={{ uri: movie.poster_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: '#262420' }]} />
                )}
                {movie.has_trailer ? (
                  <View style={styles.posterPlayGlyph}>
                    <Play size={10} color={Colors.ink} fill={Colors.ink} />
                  </View>
                ) : null}
                {movie.vote_average ? (
                  <View style={styles.posterRatingPill}>
                    <Star size={9} color="#f5cf7e" fill="#f5cf7e" />
                    <Text style={styles.posterRatingText}>{movie.vote_average.toFixed(1)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.posterTitle} numberOfLines={1}>
                {movie.title}
              </Text>
              <Text style={styles.posterMeta} numberOfLines={1}>
                {[movie.year, movie.genres?.[0]].filter(Boolean).join(' · ')}
              </Text>
            </Pressable>
          );
        })}
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
    gap: 20,
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
  stageCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(24, 22, 21, 0.92)',
    overflow: 'hidden',
  },
  stageArt: {
    height: 220,
    position: 'relative',
    backgroundColor: '#201e1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stageTopRow: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stageMoodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(10, 9, 8, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(247, 213, 178, 0.3)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stageMoodText: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(10, 9, 8, 0.7)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ratingText: {
    color: '#f5cf7e',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '700',
  },
  playTrigger: {
    alignItems: 'center',
    gap: 8,
  },
  playCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: Colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.peach,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 8,
  },
  playTriggerText: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  stageBody: {
    padding: 18,
    gap: 12,
  },
  stageTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 26,
    fontWeight: '600',
    lineHeight: 31,
    letterSpacing: -0.5,
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(248, 245, 239, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaChipText: {
    color: Colors.textSecondary,
    fontFamily: Fonts.uiMedium,
    fontSize: 11,
  },
  genreChip: {
    backgroundColor: 'rgba(247, 213, 178, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 213, 178, 0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  genreChipText: {
    color: Colors.peachLight,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
  },
  stageOverview: {
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 20,
  },
  stageActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 4,
  },
  stageActionPrimary: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    backgroundColor: Colors.peach,
  },
  stageActionPrimaryText: {
    color: Colors.inkDark,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    fontWeight: '700',
  },
  stageActionSecondary: {
    minHeight: 44,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.15)',
    backgroundColor: 'rgba(248, 245, 239, 0.04)',
  },
  stageActionSecondaryText: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
  },
  queueSection: {
    gap: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionKicker: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  queueCount: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  queueRail: {
    gap: 10,
  },
  queueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(248, 245, 239, 0.035)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    borderRadius: 14,
    padding: 7,
    paddingRight: 14,
    maxWidth: 220,
  },
  queueCardActive: {
    borderColor: Colors.peach,
    backgroundColor: 'rgba(247, 213, 178, 0.08)',
  },
  queueThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#262420',
  },
  queueCopy: {
    flexShrink: 1,
    gap: 2,
  },
  queueTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
  },
  queueTitleActive: {
    color: Colors.peachLight,
  },
  queueMood: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 11,
  },
  railSection: {
    gap: 12,
    marginTop: 6,
  },
  railTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 22,
    fontWeight: '600',
  },
  railEyebrow: {
    color: Colors.peach,
    fontFamily: Fonts.uiMedium,
    fontSize: 12,
  },
  postersRail: {
    gap: 12,
  },
  posterCard: {
    gap: 6,
  },
  posterCardSelected: {
    opacity: 1,
  },
  posterImageWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#262420',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    position: 'relative',
  },
  posterPlayGlyph: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(10, 9, 8, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterRatingPill: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(10, 9, 8, 0.72)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  posterRatingText: {
    color: '#f5cf7e',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 10,
    fontWeight: '700',
  },
  posterTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
  },
  posterMeta: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 11,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
