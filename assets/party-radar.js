/**
 * Discover's event rail. It follows the active Culture Lens when one is set,
 * while the default rail stays useful as a lightweight Discover fallback.
 */
(function () {
  const WHATSAPP_HOST_NUMBER = "16478901234";
  const EXPLORE_URL = "https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/explore-search";
  const ANON_KEY = "sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH";
  let displayedEvents = [];

  const DEFAULT_EVENTS = [
    {
      id: "event-jazz-night",
      title: "Live Jazz Night",
      venue: "The Jazz Room",
      date: "LIVE MUSIC",
      time: "Tonight",
      image: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=600&q=80",
      description: "Atmospheric evening of live contemporary jazz and artisanal cocktails.",
    },
    {
      id: "event-summer-beats",
      title: "Summer Beats",
      venue: "Celebrities",
      date: "DJ SET",
      time: "This weekend",
      image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
      description: "Electric DJ sets, immersive lighting, and high-energy house beats.",
    },
    {
      id: "event-sunset-sessions",
      title: "Sunset Sessions",
      venue: "Beach Club",
      date: "OUTDOOR",
      time: "Coming up",
      image: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=600&q=80",
      description: "Golden-hour tunes and an easy local social gathering.",
    },
  ];

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function imageFor(item) {
    const image = item?.image;
    return image?.url || item?.imageUrl || item?.image || "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=600&q=80";
  }

  function dateFor(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "LOCAL PICK";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
  }

  function timeFor(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "Explore now";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function mapLiveItem(item) {
    return {
      id: item.id || item.title,
      title: item.title || "Local event",
      venue: item.address || item.city || item.category || "Greater Toronto Area",
      date: dateFor(item.startsAt),
      time: timeFor(item.startsAt),
      image: imageFor(item),
      description: item.description || "A live local culture pick from Echoo.",
      actionUrl: item.actionUrl || "",
    };
  }

  async function loadCultureEvents(culture) {
    if (!culture) return DEFAULT_EVENTS;
    try {
      const rawPreferences = JSON.parse(localStorage.getItem("echoo_preferences") || "{}");
      const city = rawPreferences.city || "Toronto";
      const query = window.EchooCultureContext?.queryFor("events", culture) || `${culture.label} cultural events`;
      const response = await fetch(EXPLORE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ query, city, includeLiveFallback: true, limit: 8 }),
      });
      if (!response.ok) return [];
      const payload = await response.json();
      return (payload.results || []).slice(0, 6).map(mapLiveItem);
    } catch (_error) {
      return [];
    }
  }

  function openEvent(event) {
    if (event.actionUrl && /^https?:\/\//i.test(event.actionUrl)) {
      window.open(event.actionUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const sheetContent = document.getElementById("detail-content");
    if (!sheetContent) return;
    sheetContent.innerHTML = `
      <div class="detail-art" style="background-image: url('${escapeHtml(event.image)}')"></div>
      <span class="detail-kicker">${escapeHtml(event.date)} · ${escapeHtml(event.time)}</span>
      <h2 class="detail-title">${escapeHtml(event.title)}</h2>
      <p class="detail-copy">${escapeHtml(event.description)}</p>
      <div style="font-size: 14px; font-weight: 600; color: var(--muted); margin-bottom: 16px;">📍 ${escapeHtml(event.venue)}</div>
      <div class="detail-actions"><a class="primary" href="https://wa.me/${WHATSAPP_HOST_NUMBER}?text=${encodeURIComponent(`RSVP for ${event.title}`)}" target="_blank" rel="noopener">RSVP Concierge ↗</a></div>
    `;
    const sheet = document.getElementById("detail-sheet");
    if (sheet) {
      sheet.classList.add("open");
      sheet.setAttribute("aria-hidden", "false");
    }
  }

  function render(container, culture) {
    if (!displayedEvents.length) {
      container.innerHTML = `<div class="empty-state">Fresh ${escapeHtml(culture?.label || "local")} gatherings are being picked up. Explore the live places above.</div>`;
      return;
    }
    container.innerHTML = `<div class="horizontal-carousel">${displayedEvents.map((event, index) => `
      <button class="event-card" type="button" data-culture-event="${index}" aria-label="Open ${escapeHtml(event.title)}">
        <img class="event-card-img" src="${escapeHtml(event.image)}" alt="${escapeHtml(event.title)}" loading="lazy" />
        <div class="event-card-overlay"><span class="event-date-badge">${escapeHtml(event.date)}</span><div class="event-card-title">${escapeHtml(event.title)}</div><div class="event-card-time">${escapeHtml(event.time)} · ${escapeHtml(event.venue)}</div></div>
      </button>`).join("")}</div>`;
    container.querySelectorAll("[data-culture-event]").forEach((button) => {
      button.addEventListener("click", () => openEvent(displayedEvents[Number(button.dataset.cultureEvent)]));
    });
  }

  async function refresh() {
    const container = document.getElementById("party-radar-mount");
    if (!container) return;
    const culture = window.EchooCultureContext?.getActive?.() || null;
    if (culture) container.innerHTML = `<div class="horizontal-carousel"><div class="location-card skeleton-card"></div><div class="location-card skeleton-card"></div></div>`;
    displayedEvents = await loadCultureEvents(culture);
    render(container, culture);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
  else refresh();
  window.addEventListener("echoo:culture-changed", refresh);
})();
