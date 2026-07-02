(function () {
  const CONFIG = {
    supabaseAnonKey: "sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH",
    discoverLiveUrl:
      "https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/discover-live",
  };

  const FALLBACKS = {
    music: "assets/optimized/news-music-768.jpg",
    dates: "assets/optimized/news-date-768.jpg",
    food: "assets/optimized/news-date-768.jpg",
  };

  function readPrefs() {
    try {
      return JSON.parse(localStorage.getItem("echoo_preferences") || "{}");
    } catch (_err) {
      return {};
    }
  }

  function clean(value, fallback = "") {
    return String(value || fallback).replace(/\s+/g, " ").trim();
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

  function imageFor(item, category) {
    return clean(item.imageUrl || item.image_url || item.img, FALLBACKS[category]);
  }

  function copyFor(item) {
    return clean(
      item.reason || item.description || item.address,
      "A live Echoo pick matched to the current moment.",
    );
  }

  function hrefFor(item, category) {
    return (
      clean(item.actionUrl) ||
      `events.html?query=${encodeURIComponent(`${item.title || category} Ontario`)}`
    );
  }

  function rowCopy(item, city) {
    const bits = [
      clean(item.venueName || item.address || item.city || city),
      item.startsAt
        ? new Date(item.startsAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : clean(item.priceLabel || item.actionLabel),
    ].filter(Boolean);
    return bits.join(" · ") || copyFor(item);
  }

  function render(items, category, city) {
    const feed = document.getElementById("live-feed");
    if (!feed) return;
    if (!items.length) {
      feed.innerHTML = `
        <section class="empty">
          <h2>Live picks are warming up.</h2>
          <p>Try again in a moment, or open Discover for broader Ontario results.</p>
        </section>
      `;
      return;
    }

    const [lead, ...rest] = items;
    feed.innerHTML = `
      <a class="live-card" href="${hrefFor(lead, category)}">
        <img src="${imageFor(lead, category)}" alt="${clean(lead.title, "Live Echoo pick")}" loading="eager" decoding="async" fetchpriority="high">
        <h2>${clean(lead.title, "Live pick")}</h2>
        <p>${copyFor(lead)}</p>
      </a>
      <section class="live-list" aria-label="More live picks">
        ${rest
          .slice(0, 5)
          .map(
            (item) => `
              <a class="live-row" href="${hrefFor(item, category)}">
                <img src="${imageFor(item, category)}" alt="" loading="lazy" decoding="async">
                <span>
                  <strong>${clean(item.title, "Live pick")}</strong>
                  <span>${rowCopy(item, city)}</span>
                </span>
              </a>
            `,
          )
          .join("")}
      </section>
    `;
  }

  async function load() {
    const page = document.body.dataset.page || "music";
    const query = document.body.dataset.query || `${page} Ontario`;
    const state = document.getElementById("live-state");
    const prefs = readPrefs();
    const city = clean(prefs.city, "Ontario");
    if (state) state.textContent = "Finding live Ontario picks...";

    try {
      const lat = Number(prefs.lastLat);
      const lng = Number(prefs.lastLng);
      const body = Number.isFinite(lat) && Number.isFinite(lng)
        ? { query, lat, lng, city, limit: 8, profile: prefs.personalizationProfile || prefs }
        : { query, city, limit: 8, profile: prefs.personalizationProfile || prefs };
      const response = await fetch(CONFIG.discoverLiveUrl, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Live feed failed: ${response.status}`);
      const payload = await response.json();
      const items = Array.isArray(payload.recommendations)
        ? payload.recommendations
        : [];
      render(items, page, payload.city || city);
      if (state) {
        state.textContent = items.length
          ? `Live around ${payload.city || city}`
          : "No live picks found yet";
      }
    } catch (error) {
      console.warn("Echoo lifestyle live feed unavailable.", error);
      render([], page, city);
      if (state) state.textContent = "Live feed unavailable";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }
})();
