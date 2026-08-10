// Supabase Edge Function: movies-feed
// Read API for the Echoo Cinema page (films.html) and the Discover "Now Showing" rail.
// Reads from the `movies` table (synced by tmdb-ingest) — no live TMDB calls per user.
//
// Usage:
//   GET /functions/v1/movies-feed?rail=now_playing|upcoming|trending|date_night
//   GET /functions/v1/movies-feed?rails=all              → returns every rail at once
//   GET /functions/v1/movies-feed?movie=<tmdb_id>        → single movie detail
//   GET /functions/v1/movies-feed?rail=now_playing&limit=10
//
// Deploy:  supabase functions deploy movies-feed --no-verify-jwt

import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";

const ALL_RAILS = [
  "now_playing",
  "upcoming",
  "trending",
  "date_night",
] as const;
type Rail = (typeof ALL_RAILS)[number];

const IMAGE_BASE = "https://image.tmdb.org/t/p";

// Build a CDN poster/backdrop URL from a TMDB path.
function imageUrl(
  path: string | null | undefined,
  size = "w342",
): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

// Map a DB row to the public-facing shape the frontend expects.
function toPublicMovie(row: Record<string, unknown>) {
  const posterPath = row.poster_path as string | null;
  const backdropPath = row.backdrop_path as string | null;
  return {
    tmdb_id: row.tmdb_id,
    title: row.title,
    overview: row.overview,
    curated_copy: row.curated_copy,
    curated_mood: row.curated_mood,
    poster_url: imageUrl(posterPath, "w342"),
    backdrop_url: imageUrl(backdropPath, "w780"),
    trailer_youtube_id: row.trailer_youtube_id,
    has_trailer: Boolean(row.trailer_youtube_id),
    release_date: row.release_date,
    year: row.release_date ? String(row.release_date).slice(0, 4) : null,
    vote_average: Number(row.vote_average) || 0,
    vote_count: Number(row.vote_count) || 0,
    genres: row.genres || [],
    runtime_minutes: row.runtime_minutes,
    certification: row.certification,
    status: row.status,
    is_date_night_pick: row.is_date_night_pick,
    popularity: Number(row.popularity) || 0,
  };
}

// ── Fetch a single rail ──────────────────────────────────────────
async function fetchRail(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rail: Rail,
  limit: number,
): Promise<Record<string, unknown>[]> {
  let query = supabase
    .from("movies")
    .select(
      "tmdb_id, title, overview, curated_copy, curated_mood, poster_path, backdrop_path, trailer_youtube_id, release_date, vote_average, vote_count, genres, runtime_minutes, certification, status, is_date_night_pick, popularity",
    )
    .order("popularity", { ascending: false })
    .limit(limit);

  if (rail === "date_night") {
    query = query.eq("is_date_night_pick", true);
  } else {
    query = query.eq("status", rail);
  }

  const { data, error } = await query;
  if (error) {
    console.warn(`movies-feed: query error for rail=${rail}:`, error.message);
    return [];
  }
  return data || [];
}

// ── Main handler ─────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabase = getSupabaseAdmin();
  const url = new URL(req.url);
  const params = url.searchParams;

  const limit = Math.min(Number(params.get("limit")) || 12, 24);
  const singleMovieId = params.get("movie");
  const requestedRails = params.get("rails");
  const railParam = params.get("rail");

  // ── Single movie detail ──
  if (singleMovieId) {
    const tmdbId = Number(singleMovieId);
    if (!tmdbId) {
      return jsonResponse({ error: "Invalid movie id" }, 400);
    }
    const { data, error } = await supabase
      .from("movies")
      .select(
        "tmdb_id, title, overview, curated_copy, curated_mood, poster_path, backdrop_path, trailer_youtube_id, release_date, vote_average, vote_count, genres, runtime_minutes, certification, status, is_date_night_pick, popularity",
      )
      .eq("tmdb_id", tmdbId)
      .maybeSingle();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    if (!data) {
      return jsonResponse({ error: "Movie not found" }, 404);
    }
    return jsonResponse({ movie: toPublicMovie(data) });
  }

  // ── All rails at once (films.html main load) ──
  if (requestedRails === "all") {
    const [nowPlaying, upcoming, trending, dateNight] = await Promise.all([
      fetchRail(supabase, "now_playing", limit),
      fetchRail(supabase, "upcoming", limit),
      fetchRail(supabase, "trending", limit),
      fetchRail(supabase, "date_night", limit),
    ]);

    return jsonResponse({
      rails: {
        now_playing: {
          label: "This Week",
          eyebrow: "In theatres now",
          movies: nowPlaying.map(toPublicMovie),
        },
        upcoming: {
          label: "Coming Soon",
          eyebrow: "On the horizon",
          movies: upcoming.map(toPublicMovie),
        },
        trending: {
          label: "Trending",
          eyebrow: "What people are watching",
          movies: trending.map(toPublicMovie),
        },
        date_night: {
          label: "Date-Night Picks",
          eyebrow: "Worth planning around",
          movies: dateNight.map(toPublicMovie),
        },
      },
    });
  }

  // ── Single rail ──
  if (railParam) {
    if (!ALL_RAILS.includes(railParam as Rail)) {
      return jsonResponse(
        { error: `Invalid rail. Must be one of: ${ALL_RAILS.join(", ")}` },
        400,
      );
    }
    const movies = await fetchRail(supabase, railParam as Rail, limit);
    return jsonResponse({
      rail: railParam,
      movies: movies.map(toPublicMovie),
    });
  }

  // ── No params → default: all rails summary ──
  return jsonResponse(
    {
      error:
        "Provide ?rail=now_playing|upcoming|trending|date_night, ?rails=all, or ?movie=<tmdb_id>",
    },
    400,
  );
});
