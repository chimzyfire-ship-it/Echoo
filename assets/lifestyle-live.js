/*
 * Echoo · Category discover (window.EchooLifestyleLive)
 *
 * Powers the category pages (food / comedy / music / nightlife). Renders places
 * as GRIDS in sections (Nearby → Recommended → All places), with an in-category
 * keyword search, stale-while-revalidate caching (so pages don't reload from
 * scratch every open), and aesthetic gradient fallback covers (never the old
 * stock images). Built to feel like a real discover engine.
 *
 * Data source: the discover-live Edge Function. Depends on window.EchooAuth
 * (for headers) and window.EchooCultureContext (optional, for Culture Lens).
 */
(function () {
  "use strict";

  const CONFIG = {
    supabaseAnonKey: "sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH",
    discoverLiveUrl:
      "https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/discover-live",
    limit: 30,
    cacheFreshMs: 5 * 60 * 1000, // render cache, skip refetch if younger
    cacheMaxMs: 24 * 60 * 60 * 1000, // render cache up to 24h, then refetch
    nearbyRadiusKm: 15,
    perSectionCap: 12,
  };

  const state = {
    page: "",
    baseQuery: "",
    culture: null,
    city: "Ontario",
    lat: NaN,
    lng: NaN,
    items: [],
    query: "", // active search query
  };

  // ── helpers ──
  function readPrefs() {
    try {
      return JSON.parse(localStorage.getItem("echoo_preferences") || "{}");
    } catch (_e) {
      return {};
    }
  }
  function clean(value, fallback = "") {
    return String(value || fallback).replace(/\s+/g, " ").trim();
  }
  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function headers() {
    return window.EchooAuth
      ? window.EchooAuth.authHeaders({ "Content-Type": "application/json" })
      : Promise.resolve({
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
          apikey: CONFIG.supabaseAnonKey,
        });
  }
  function titleFor(item) {
    return clean(item.title, "Place");
  }
  function subFor(item) {
    const bits = [
      clean(item.venueName || item.address || item.city),
      item.startsAt
        ? new Date(item.startsAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : clean(item.priceLabel || item.actionLabel || item.sourceAttribution),
    ].filter(Boolean);
    return bits.slice(0, 2).join(" · ") || clean(item.reason, "");
  }
  function hrefFor(item) {
    return (
      clean(item.actionUrl) ||
      `events.html?query=${encodeURIComponent(`${titleFor(item)} Ontario`)}`
    );
  }
  function distanceKm(item) {
    if (
      !Number.isFinite(state.lat) ||
      !Number.isFinite(state.lng) ||
      !Number.isFinite(item.latitude) ||
      !Number.isFinite(item.longitude)
    )
      return Infinity;
    const R = 6371;
    const dLat = ((item.latitude - state.lat) * Math.PI) / 180;
    const dLng = ((item.longitude - state.lng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      (Math.cos((state.lat * Math.PI) / 180) *
        Math.cos((item.latitude * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function hueFor(seed) {
    let h = 0;
    const s = String(seed || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  // ── cache (stale-while-revalidate) ──
  function cacheKey() {
    const c = clean(state.culture?.label, "local").toLowerCase();
    return `echoo_disc_${state.page}_${clean(state.city, "ontario").toLowerCase()}_${c}`;
  }
  function readCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return null;
      return data;
    } catch (_e) {
      return null;
    }
  }
  function writeCache(items) {
    try {
      localStorage.setItem(
        cacheKey(),
        JSON.stringify({ at: Date.now(), items }),
      );
    } catch (_e) {
      /* storage full / disabled — non-fatal */
    }
  }

  // ── rendering ──
  function thumbHtml(item) {
    const img = clean(item.imageUrl || item.image_url);
    if (img) {
      return `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(window.__echooPlaceFallback && window.__echooPlaceFallback('${esc(titleFor(item))}'))">`;
    }
    return fallbackThumbHtml(item);
  }
  function fallbackThumbHtml(item) {
    const name = titleFor(item);
    const h = hueFor(name + (item.id || ""));
    const initial = (name[0] || "?").toUpperCase();
    return `<div class="place-thumb-fallback" style="background:linear-gradient(140deg, hsl(${h} 42% 20%), hsl(${(h + 48) % 360} 48% 10%))"><span>${esc(initial)}</span></div>`;
  }
  // exposed for the <img onerror> swap when a real photo fails to load
  window.__echooPlaceFallback = function (name) {
    const wrap = document.createElement("div");
    const h = hueFor(name);
    wrap.className = "place-thumb-fallback";
    wrap.style.background = `linear-gradient(140deg, hsl(${h} 42% 20%), hsl(${(h + 48) % 360} 48% 10%))`;
    wrap.innerHTML = `<span>${esc((name[0] || "?").toUpperCase())}</span>`;
    return wrap;
  };

  function cardHtml(item) {
    const name = esc(titleFor(item));
    return `<a class="place-card" href="${esc(hrefFor(item))}">
      <div class="place-thumb">${thumbHtml(item)}</div>
      <div class="place-meta">
        <strong class="place-name">${name}</strong>
        <span class="place-sub">${esc(subFor(item))}</span>
      </div>
    </a>`;
  }
  function gridHtml(items) {
    return `<div class="place-grid">${items.map(cardHtml).join("")}</div>`;
  }
  function sectionHtml(title, sub, items) {
    if (!items || !items.length) return "";
    return `<section class="place-section">
      <div class="place-section-head">
        <h3 class="place-section-title">${esc(title)}</h3>
        <span class="place-section-sub">${esc(sub)}</span>
      </div>
      ${gridHtml(items)}
    </section>`;
  }

  function splitSections(items) {
    const withDist = items
      .map((it) => ({ it, d: distanceKm(it) }))
      .filter((x) => Number.isFinite(x.d));
    const hasLocation = withDist.length > 0 && Number.isFinite(state.lat);
    const nearbyIds = new Set();
    let nearby = [];
    if (hasLocation) {
      nearby = withDist
        .sort((a, b) => a.d - b.d)
        .slice(0, CONFIG.perSectionCap)
        .map((x) => {
          nearbyIds.add(x.it.id || x.it.title);
          return x.it;
        });
    }
    const recommended = items
      .filter((it) => !nearbyIds.has(it.id || it.title))
      .slice()
      .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0))
      .slice(0, CONFIG.perSectionCap);
    return { nearby, recommended, all: items };
  }

  function emptyHtml() {
    return `<section class="place-empty">
      <h2>Picks are warming up.</h2>
      <p>Try a different keyword, or open Discover for broader results.</p>
    </section>`;
  }

  function render() {
    const feed = document.getElementById("live-feed");
    if (!feed) return;
    const items = state.items;

    // Search mode: single filtered grid.
    if (state.query) {
      const q = state.query.toLowerCase();
      const filtered = items.filter((it) => {
        const hay = [
          it.title,
          it.description,
          it.address,
          it.city,
          it.category,
          it.venueName,
          it.reason,
        ]
          .map((v) => clean(v).toLowerCase())
          .join(" ");
        return hay.includes(q);
      });
      feed.innerHTML =
        sectionHtml(
          `${filtered.length} result${filtered.length === 1 ? "" : "s"}`,
          `matching "${state.query}"`,
          filtered,
        ) || emptyHtml();
      return;
    }

    if (!items.length) {
      feed.innerHTML = emptyHtml();
      return;
    }

    const { nearby, recommended, all } = splitSections(items);
    const parts = [];
    if (nearby.length)
      parts.push(sectionHtml("Nearby", "Closest to you", nearby));
    parts.push(
      sectionHtml("Recommended", "Top picks for you", recommended),
    );
    if (all.length > nearby.length + recommended.length)
      parts.push(sectionHtml("All places", `Every ${state.page} spot`, all));
    feed.innerHTML = parts.join("");
  }

  function setStatus(text) {
    const el = document.getElementById("live-state");
    if (el) el.textContent = text;
  }

  // ── search box (injected) ──
  function ensureSearch() {
    const feed = document.getElementById("live-feed");
    if (!feed || document.getElementById("category-search-form")) return;
    const form = document.createElement("form");
    form.className = "category-search";
    form.id = "category-search-form";
    form.setAttribute("role", "search");
    form.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>
      <input type="search" id="category-search-input" placeholder="Search ${esc(state.page)}…" autocomplete="off" aria-label="Search ${esc(state.page)}">
      <button type="button" id="category-search-clear" aria-label="Clear search" hidden>×</button>`;
    feed.parentNode.insertBefore(form, feed);
    const input = form.querySelector("#category-search-input");
    const clearBtn = form.querySelector("#category-search-clear");
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      clearBtn.hidden = !input.value;
      t = setTimeout(() => {
        state.query = clean(input.value);
        render();
      }, 140);
    });
    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.hidden = true;
      state.query = "";
      render();
      input.focus();
    });
  }

  // ── data ──
  function applyCultureHero() {
    if (!state.culture) return;
    const title = document.querySelector("[data-echoo-hero-title]");
    const copy = document.querySelector("[data-echoo-hero-copy]");
    if (title)
      title.textContent = `${state.culture.label} ${state.page}, nearby.`;
    if (copy)
      copy.textContent = `Your Culture Lens is shaping these picks around ${state.culture.label} culture.`;
  }

  function buildQuery() {
    return window.EchooCultureContext?.queryFor
      ? window.EchooCultureContext.queryFor(state.baseQuery, state.culture)
      : state.baseQuery;
  }

  async function fetchItems() {
    const body = Number.isFinite(state.lat) && Number.isFinite(state.lng)
      ? { query: buildQuery(), lat: state.lat, lng: state.lng, city: state.city, limit: CONFIG.limit }
      : { query: buildQuery(), city: state.city, limit: CONFIG.limit };
    const res = await fetch(CONFIG.discoverLiveUrl, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`discover-live ${res.status}`);
    const payload = await res.json();
    return Array.isArray(payload.recommendations) ? payload.recommendations : [];
  }

  function renderSkeletons() {
    const feed = document.getElementById("live-feed");
    if (!feed) return;
    const n = 6;
    let html = '<section class="place-section"><div class="place-grid">';
    for (let i = 0; i < n; i++) html += '<div class="place-card skeleton"><div class="place-thumb"></div><div class="place-meta"><span class="sk-line"></span><span class="sk-line short"></span></div></div>';
    html += "</div></section>";
    feed.innerHTML = html;
  }

  async function load() {
    const prefs = readPrefs();
    state.city = clean(prefs.city, "Ontario");
    state.lat = Number(prefs.lastLat);
    state.lng = Number(prefs.lastLng);
    applyCultureHero();
    ensureSearch();

    const cached = readCache();
    const now = Date.now();

    if (cached) {
      state.items = cached.items;
      render();
      const age = now - cached.at;
      if (age < CONFIG.cacheFreshMs) {
        setStatus(`Live around ${state.city}`);
        return; // fresh enough — don't refetch
      }
      // stale → show cache, refresh quietly in background (SWR).
      setStatus(`Updating around ${state.city}…`);
      refreshInBackground();
      return;
    }

    // No cache — fetch fresh with skeletons.
    setStatus(`Finding live ${state.culture?.label || state.page} picks…`);
    renderSkeletons();
    try {
      state.items = await fetchItems();
      writeCache(state.items);
      render();
      setStatus(
        state.items.length
          ? `Live around ${state.city}`
          : "No picks found yet",
      );
    } catch (err) {
      console.warn("Echoo category feed unavailable.", err);
      state.items = [];
      render();
      setStatus("Live feed unavailable");
    }
  }

  async function refreshInBackground() {
    try {
      const items = await fetchItems();
      // Don't clobber an active search.
      state.items = items;
      writeCache(items);
      render();
      setStatus(`Live around ${state.city}`);
    } catch (_e) {
      setStatus(`Showing recent picks around ${state.city}`);
    }
  }

  function init() {
    state.page = document.body.dataset.page || "food";
    state.baseQuery =
      document.body.dataset.query || `${state.page} Ontario`;
    state.culture = window.EchooCultureContext?.getActive?.() || null;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", load, { once: true });
    } else {
      load();
    }
  }

  init();
})();
