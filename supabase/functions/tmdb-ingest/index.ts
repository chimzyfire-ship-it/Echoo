// Supabase Edge Function: tmdb-ingest
// Scheduled job that fetches now-playing, upcoming, and trending movies from TMDB,
// resolves each movie's official trailer (YouTube), and upserts into the `movies` table.
//
// Auth: uses TMDB v4 Read Access Token (Bearer) stored as TMDB_API_TOKEN secret.
// Falls back to v3 API key (TMDB_API_KEY) if the token is absent.
//
// Deploy:  supabase functions deploy tmdb-ingest --no-verify-jwt
// Schedule: pg_cron hourly, or external ping (see README at bottom).

import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";

const TMDB_TOKEN = Deno.env.get("TMDB_API_TOKEN") || "";
const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY") || "";
const TMDB_BASE = "https://api.themoviedb.org/3";
const REGION = "CA";
const LANGUAGE = "en-CA";

// ── TMDB types (subset) ──────────────────────────────────────────
type TMDBMovie = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  popularity?: number;
};

type TMDBVideo = {
  key: string;
  site: string;
  type: string;
  official?: boolean;
  name?: string;
  published_at?: string;
};

type TMDBMovieDetail = TMDBMovie & {
  imdb_id?: string;
  runtime?: number;
  genres?: { id: number; name: string }[];
  release_dates?: {
    results?: {
      iso_3166_1: string;
      release_dates?: { certification?: string }[];
    }[];
  };
};

// ── TMDB fetch helper ────────────────────────────────────────────
// Auth strategy: prefer the v3 API key (query param) since it's the
// simpler, more broadly supported method. The v4 Bearer token is kept
// as a fallback for environments where only the token is configured.
const USE_V4_TOKEN = !TMDB_API_KEY && Boolean(TMDB_TOKEN);

function tmdbHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (USE_V4_TOKEN) {
    headers["authorization"] = `Bearer ${TMDB_TOKEN}`;
  }
  return headers;
}

function tmdbUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("language", LANGUAGE);
  if (!USE_V4_TOKEN && TMDB_API_KEY) {
    url.searchParams.set("api_key", TMDB_API_KEY);
  }
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

async function tmdbFetch<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T | null> {
  try {
    const res = await fetch(tmdbUrl(path, params), { headers: tmdbHeaders() });
    if (!res.ok) {
      console.warn(`TMDB ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`TMDB fetch error for ${path}:`, err);
    return null;
  }
}

// ── Trailer resolution ───────────────────────────────────────────
// Picks the best YouTube trailer: prefer official, type Trailer, newest.
function pickTrailer(videos: TMDBVideo[] = []): {
  key: string;
  official: boolean;
} | null {
  const trailers = videos.filter(
    (v) => v.site === "YouTube" && v.type === "Trailer" && v.key,
  );
  if (trailers.length === 0) {
    // Accept Teasers as a fallback so we still have something to play.
    const teasers = videos.filter(
      (v) => v.site === "YouTube" && v.type === "Teaser" && v.key,
    );
    if (teasers.length === 0) return null;
    teasers.sort((a, b) =>
      (b.published_at || "").localeCompare(a.published_at || ""),
    );
    return { key: teasers[0].key, official: teasers[0].official || false };
  }
  // Official trailers first, then by publish date (newest first).
  trailers.sort((a, b) => {
    if ((b.official ? 1 : 0) !== (a.official ? 1 : 0)) {
      return (b.official ? 1 : 0) - (a.official ? 1 : 0);
    }
    return (b.published_at || "").localeCompare(a.published_at || "");
  });
  return { key: trailers[0].key, official: trailers[0].official || false };
}

// ── Certification lookup (Canadian rating) ───────────────────────
function extractCertification(detail: TMDBMovieDetail): string | null {
  const caEntry = detail.release_dates?.results?.find(
    (r) => r.iso_3166_1 === REGION,
  );
  const cert = caEntry?.release_dates?.find((rd) => rd.certification);
  return cert?.certification || null;
}

// ── Ingest one movie list into a given status ────────────────────
async function ingestList(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  movies: TMDBMovie[],
  status: string,
): Promise<{ ingested: number; skipped: number }> {
  let ingested = 0;
  let skipped = 0;

  for (const m of movies) {
    if (!m.id || !m.title) {
      skipped++;
      continue;
    }

    // Fetch details + videos in parallel.
    const [detail, videosResp] = await Promise.all([
      tmdbFetch<TMDBMovieDetail>(`/movie/${m.id}`, {
        append_to_response: "release_dates",
      }),
      tmdbFetch<{ results?: TMDBVideo[] }>(`/movie/${m.id}/videos`),
    ]);

    const trailer = pickTrailer(videosResp?.results);
    const genreNames = detail?.genres?.map((g) => g.name).filter(Boolean) || [];
    const certification = detail ? extractCertification(detail) : null;

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 12);

    const { error } = await supabase.from("movies").upsert(
      {
        tmdb_id: m.id,
        imdb_id: detail?.imdb_id || null,
        title: m.title,
        original_title: m.original_title || null,
        overview: m.overview || null,
        poster_path: m.poster_path || null,
        backdrop_path: m.backdrop_path || null,
        trailer_youtube_id: trailer?.key || null,
        trailer_is_official: trailer?.official || false,
        trailer_source: trailer ? "tmdb" : "none",
        release_date: m.release_date || null,
        vote_average: m.vote_average || 0,
        vote_count: m.vote_count || 0,
        genres: genreNames,
        genre_ids: m.genre_ids || [],
        runtime_minutes: detail?.runtime || null,
        certification,
        status,
        region: REGION,
        popularity: m.popularity || 0,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "tmdb_id" },
    );

    if (error) {
      console.warn(
        `Upsert failed for tmdb_id=${m.id} (${m.title}):`,
        error.message,
      );
      skipped++;
    } else {
      ingested++;
    }
  }

  return { ingested, skipped };
}

// ── Main handler ─────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!TMDB_TOKEN && !TMDB_API_KEY) {
    return jsonResponse(
      {
        error:
          "TMDB_API_KEY or TMDB_API_TOKEN must be configured in Supabase secrets.",
      },
      400,
    );
  }

  const supabase = getSupabaseAdmin();
  const startedAt = Date.now();

  try {
    // Fetch all three rails (first page each is plenty for a curated cinema).
    const [nowPlaying, upcoming, trending] = await Promise.all([
      tmdbFetch<{ results?: TMDBMovie[] }>("/movie/now_playing", {
        region: REGION,
        page: "1",
      }),
      tmdbFetch<{ results?: TMDBMovie[] }>("/movie/upcoming", {
        region: REGION,
        page: "1",
      }),
      tmdbFetch<{ results?: TMDBMovie[] }>("/trending/movie/week", {
        page: "1",
      }),
    ]);

    const np = await ingestList(
      supabase,
      nowPlaying?.results || [],
      "now_playing",
    );
    const up = await ingestList(supabase, upcoming?.results || [], "upcoming");
    const tr = await ingestList(supabase, trending?.results || [], "trending");

    // Prune stale rows: remove movies that haven't been refreshed in 14 days
    // AND are no longer in any active rail. (Keeps the catalog compact.)
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 14);
    await supabase
      .from("movies")
      .delete()
      .lt("fetched_at", staleCutoff.toISOString())
      .not("status", "in", '("now_playing","upcoming","trending")')
      .eq("is_date_night_pick", false);

    return jsonResponse({
      success: true,
      duration_ms: Date.now() - startedAt,
      rails: {
        now_playing: np,
        upcoming: up,
        trending: tr,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown ingest error";
    return jsonResponse({ error: message }, 500);
  }
});

/*
 ── Scheduling ────────────────────────────────────────────────────
 Run hourly via pg_cron (set in Supabase SQL editor once):

   select cron.schedule(
     'tmdb-ingest-hourly',
     '0 * * * *',
     $$ select net.http_post(
       url := '${SUPABASE_URL}/functions/v1/tmdb-ingest',
       headers := '{"Authorization": "Bearer ${SERVICE_ROLE_KEY}"}'::jsonb
     ) $$
   );

 Or ping with curl from an external scheduler:

   curl -X POST \
     -H "Authorization: Bearer <service-role-key>" \
     https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/tmdb-ingest
*/
