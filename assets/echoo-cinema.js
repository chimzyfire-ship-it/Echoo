/* ──────────────────────────────────────────────
   Echoo Cinema — rails loader + renderer
   Loaded by films.html. Fetches /functions/v1/movies-feed?rails=all
   and renders poster carousels. Falls back to inline fallback films
   (provided by the page) if the feed is empty or unreachable.

   Exposes window.EchooCinema.init({ container, onSelect, fallbacks })
   ────────────────────────────────────────────── */
(function () {
  "use strict";

  const SUPABASE_URL = "https://dlezregdjpdqmooubwvl.supabase.co";
  const FEED_URL = `${SUPABASE_URL}/functions/v1/movies-feed?rails=all&limit=12`;

  const PLACEHOLDER_POSTER =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="132" height="198"><rect width="132" height="198" fill="#1a1a1a"/><text x="66" y="105" font-family="sans-serif" font-size="11" fill="#555" text-anchor="middle">no poster</text></svg>',
    );

  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.container - element to render rails into
   * @param {Function} opts.onSelect - called with a movie object when a poster is tapped
   * @param {Array} opts.fallbacks - inline fallback films (the page's hardcoded list)
   */
  async function init(opts) {
    const container = opts.container;
    const onSelect = opts.onSelect || function () {};
    const fallbacks = opts.fallbacks || [];

    if (!container) return;

    // Show skeletons immediately.
    renderSkeletons(container);

    let rails = null;
    try {
      const res = await fetch(FEED_URL, {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        rails = data.rails || null;
      }
    } catch (_err) {
      // Network failure — fall through to fallbacks.
    }

    // Normalize: only keep rails that have at least one movie WITH a poster.
    const railOrder = ["now_playing", "upcoming", "trending", "date_night"];
    const validRails = rails
      ? railOrder
          .map((key) => ({ key, ...rails[key] }))
          .filter(
            (r) =>
              Array.isArray(r.movies) && r.movies.some((m) => m.poster_url),
          )
      : [];

    if (validRails.length === 0) {
      renderFallback(container, fallbacks, onSelect);
      return;
    }

    container.innerHTML = "";
    for (const rail of validRails) {
      const movies = rail.movies.filter((m) => m.poster_url);
      if (movies.length === 0) continue;
      container.appendChild(renderRail(rail, movies, onSelect));
    }
  }

  function renderSkeletons(container) {
    container.innerHTML = "";
    const rail = document.createElement("div");
    rail.className = "cinema-rail";
    const eyebrow = document.createElement("div");
    eyebrow.className = "rail-eyebrow";
    eyebrow.innerHTML =
      '<span class="label">Loading</span><span class="sub">curating trailers</span>';
    rail.appendChild(eyebrow);

    const carousel = document.createElement("div");
    carousel.className = "poster-carousel";
    for (let i = 0; i < 5; i++) {
      const card = document.createElement("div");
      card.className = "poster-card skeleton";
      card.innerHTML =
        '<div class="poster-thumb"></div><span class="poster-title">&nbsp;</span><span class="poster-meta">&nbsp;</span>';
      carousel.appendChild(card);
    }
    rail.appendChild(carousel);
    container.appendChild(rail);
  }

  function renderRail(rail, movies, onSelect) {
    const section = document.createElement("div");
    section.className = "cinema-rail";
    section.dataset.rail = rail.key;

    const eyebrow = document.createElement("div");
    eyebrow.className = "rail-eyebrow";
    eyebrow.innerHTML =
      `<span class="label">${escapeHtml(rail.label || rail.eyebrow || rail.key)}</span>` +
      `<span class="sub">${escapeHtml(rail.eyebrow || "")}</span>`;
    section.appendChild(eyebrow);

    const carousel = document.createElement("div");
    carousel.className = "poster-carousel";

    for (const movie of movies) {
      carousel.appendChild(renderPoster(movie, onSelect));
    }

    section.appendChild(carousel);
    return section;
  }

  function renderPoster(movie, onSelect) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "poster-card";
    card.dataset.tmdbId = movie.tmdb_id;
    card.setAttribute("aria-label", `Watch ${movie.title || "trailer"}`);

    const hasTrailer = Boolean(movie.trailer_youtube_id);
    const thumb = document.createElement("div");
    thumb.className = "poster-thumb" + (hasTrailer ? "" : " no-trailer");

    // Play glyph (only if there's a trailer)
    if (hasTrailer) {
      const play = document.createElement("span");
      play.className = "poster-play";
      play.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
      thumb.appendChild(play);
    }

    const img = document.createElement("img");
    img.src = movie.poster_url || PLACEHOLDER_POSTER;
    img.alt = movie.title ? `${movie.title} poster` : "Movie poster";
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = function () {
      img.src = PLACEHOLDER_POSTER;
    };
    thumb.appendChild(img);
    card.appendChild(thumb);

    const title = document.createElement("span");
    title.className = "poster-title";
    title.textContent = movie.title || "Untitled";
    card.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "poster-meta";
    const bits = [];
    if (movie.year) bits.push(movie.year);
    if (movie.vote_average)
      bits.push(`★ ${Number(movie.vote_average).toFixed(1)}`);
    meta.innerHTML = bits
      .map((b) => escapeHtml(b))
      .join('<span class="dot"></span>');
    card.appendChild(meta);

    card.addEventListener("click", function () {
      onSelect(movie);
    });

    return card;
  }

  // If the feed is empty/down, show a quiet message + hand the page
  // its fallbacks so the existing hardcoded films still work.
  function renderFallback(container, fallbacks, onSelect) {
    container.innerHTML = "";
    const note = document.createElement("div");
    note.className = "cinema-empty";
    note.innerHTML =
      "<span>Trailers are warming up.</span>" +
      "<span>Showing curated picks below.</span>";
    container.appendChild(note);

    // If the page provided fallbacks, render them as a rail too.
    if (fallbacks.length > 0) {
      const rail = {
        key: "curated",
        label: "Now screening",
        eyebrow: "Curated",
        movies: fallbacks.map((f) => ({
          title: f.title,
          poster_url:
            f.poster && f.poster.startsWith("http") ? f.poster : f.poster,
          trailer_youtube_id: f.video || null,
          overview: f.copy,
          curated_mood: f.mood,
          year: null,
          vote_average: 0,
        })),
      };
      container.appendChild(renderRail(rail, rail.movies, onSelect));
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.EchooCinema = { init };
})();
