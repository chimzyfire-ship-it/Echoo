/**
 * Echoo Featured Events & Party Drop Component
 * Premium horizontal carousel alignment matching reference design
 */

(function () {
  const WHATSAPP_HOST_NUMBER = "16478901234";

  const EVENTS_LIST = [
    {
      id: "event-jazz-night",
      title: "Live Jazz Night",
      venue: "The Jazz Room",
      date: "FRI, JUL 25",
      time: "7:30 PM",
      image: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=600&q=80",
      description: "Atmospheric evening of live contemporary jazz and artisanal cocktails."
    },
    {
      id: "event-summer-beats",
      title: "Summer Beats",
      venue: "Celebrities",
      date: "SAT, JUL 26",
      time: "9:00 PM",
      image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
      description: "Electric DJ sets, immersive lighting, and high-energy house beats."
    },
    {
      id: "event-sunset-sessions",
      title: "Sunset Sessions",
      venue: "Beach Club",
      date: "SUN, JUL 27",
      time: "6:00 PM",
      image: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=600&q=80",
      description: "Golden hour tunes, beach vibes, and relaxed local social gathering."
    },
    {
      id: "party-flex-feast-sammy",
      title: "Flex Feast x Sammy: Summer Beach Time 2.0",
      venue: "Woodbine Beach",
      date: "THU, JUL 31",
      time: "11:00 AM",
      image: "assets/sammy.jpeg",
      fallbackImage: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
      description: "Summer Beach Time 2.0 featuring OBA THE DJ, games, and beach vibes!"
    }
  ];

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function initPartyRadar() {
    const container = document.getElementById("party-radar-mount");
    if (!container) return;

    let html = `
      <div class="horizontal-carousel">
        ${EVENTS_LIST.map((event) => `
          <div class="event-card" onclick="window.openEventModal('${event.id}')">
            <img class="event-card-img" src="${escapeHtml(event.image)}" alt="${escapeHtml(event.title)}" loading="lazy" onerror="this.src='${escapeHtml(event.fallbackImage || 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=600&q=80')}'" />
            <div class="event-card-overlay">
              <span class="event-date-badge">${escapeHtml(event.date)}</span>
              <div class="event-card-title">${escapeHtml(event.title)}</div>
              <div class="event-card-time">${escapeHtml(event.time)} • ${escapeHtml(event.venue)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    container.innerHTML = html;

    window.openEventModal = function(id) {
      const ev = EVENTS_LIST.find(e => e.id === id) || EVENTS_LIST[0];
      const sheetContent = document.getElementById("detail-content");
      if (!sheetContent) return;

      sheetContent.innerHTML = `
        <div class="detail-art" style="background-image: url('${escapeHtml(ev.image)}')"></div>
        <span class="detail-kicker">${escapeHtml(ev.date)} • ${escapeHtml(ev.time)}</span>
        <h2 class="detail-title">${escapeHtml(ev.title)}</h2>
        <p class="detail-copy">${escapeHtml(ev.description)}</p>
        <div style="font-size: 14px; font-weight: 600; color: var(--muted); margin-bottom: 16px;">📍 ${escapeHtml(ev.venue)}</div>
        <div class="detail-actions">
          <a class="primary" href="https://wa.me/${WHATSAPP_HOST_NUMBER}?text=${encodeURIComponent('RSVP for ' + ev.title)}" target="_blank" rel="noopener">RSVP Concierge ↗</a>
        </div>
      `;

      const sheet = document.getElementById("detail-sheet");
      if (sheet) {
        sheet.classList.add("open");
        sheet.setAttribute("aria-hidden", "false");
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPartyRadar);
  } else {
    initPartyRadar();
  }
})();
