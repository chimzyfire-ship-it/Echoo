/**
 * Echoo Featured Party Drop Component - Native 430px Mobile Alignment
 * Minimalist, elegant single party card with WhatsApp Concierge & Map overlay integration.
 */

(function () {
  const WHATSAPP_HOST_NUMBER = "16478901234"; // Echoo Concierge WhatsApp contact

  const ECHOO_FEATURED_PARTY = {
    id: "party-flex-feast-sammy",
    title: "Flex Feast x Sammy: Summer Beach Time 2.0",
    venue: "Woodbine Beach",
    address: "1675 Lake Shore Blvd E, Toronto, ON",
    lat: 43.6635,
    lng: -79.3080,
    date: "25 JULY",
    time: "11:00 AM",
    fullTime: "11:00 AM (No African time)",
    dressCode: "Beach Outfit Only",
    entry: "FREE · Bring Mat or Chairs",
    lineup: "OBA THE DJ · Hosts: Yumu of Toronto, Tina, Tmore, Tummy, MkO, ChefKiki",
    description: "Summer Beach Time 2.0 at Woodbine Beach featuring OBA THE DJ! Enjoy water gun battles, painting fun, puzzle challenges, table tennis, draft & ludo, non-stop games, free food, and good music. Free entry — come along with your chairs or mat!",
    image: "assets/echoo_party_aura.jpg",
    fallbackImage: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80"
  };

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function generateWhatsAppUrl(party) {
    const messageText = `Hey Echoo! I'd like to RSVP / get details for "${party.title}" at ${party.venue} on ${party.date}.`;
    return `https://wa.me/${WHATSAPP_HOST_NUMBER}?text=${encodeURIComponent(messageText)}`;
  }

  function initPartyRadar() {
    const container = document.getElementById("party-radar-mount");
    if (!container) return;

    const party = ECHOO_FEATURED_PARTY;

    let html = `
      <div class="party-radar-section">
        <div class="party-radar-header">
          <div>
            <h2 class="party-radar-title">Upcoming Drop</h2>
            <span class="party-radar-subtitle">Echoo Exclusive Party</span>
          </div>
        </div>
        <div class="party-cards-stack">
          <div class="party-card" role="button" tabindex="0" id="featured-party-card">
            <div class="party-poster-box">
              <img class="party-poster-img" src="${escapeHtml(party.image)}" data-fallback="${escapeHtml(party.fallbackImage)}" alt="${escapeHtml(party.title)}" loading="lazy" onerror="if(this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}" />
            </div>
            <div class="party-card-body">
              <span class="party-date-time">${escapeHtml(party.date)} · ${escapeHtml(party.time)}</span>
              <h3 class="party-name">${escapeHtml(party.title)}</h3>
              <span class="party-venue-line">${escapeHtml(party.venue)}</span>
              <span class="party-lineup-preview">${escapeHtml(party.lineup)}</span>
              <div class="party-card-footer">
                <span class="party-action-link">RSVP ↗</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail Modal Sheet -->
      <div id="party-modal-backdrop" class="party-modal-backdrop" aria-hidden="true">
        <div class="party-modal-sheet" role="dialog" aria-modal="true">
          <button id="party-modal-close" class="party-modal-close" aria-label="Close sheet">&times;</button>
          <div class="party-modal-hero">
            <img id="party-modal-img" src="${escapeHtml(party.image)}" alt="${escapeHtml(party.title)}" />
          </div>
          <div class="party-modal-body">
            <div>
              <span id="party-modal-date" class="party-modal-date">${escapeHtml(party.date)} · ${escapeHtml(party.fullTime)}</span>
              <h2 id="party-modal-title" class="party-modal-title">${escapeHtml(party.title)}</h2>
              <span id="party-modal-venue" class="party-modal-venue">${escapeHtml(party.venue)} · ${escapeHtml(party.address)}</span>
            </div>

            <div class="party-modal-grid">
              <div>
                <div class="party-meta-item-title">Time</div>
                <div class="party-meta-item-val">${escapeHtml(party.fullTime)}</div>
              </div>
              <div>
                <div class="party-meta-item-title">Dress Code</div>
                <div class="party-meta-item-val">${escapeHtml(party.dressCode)}</div>
              </div>
              <div>
                <div class="party-meta-item-title">Entry</div>
                <div class="party-meta-item-val">${escapeHtml(party.entry)}</div>
              </div>
              <div>
                <div class="party-meta-item-title">Location</div>
                <div class="party-meta-item-val">${escapeHtml(party.venue)}</div>
              </div>
            </div>

            <p class="party-modal-desc">${escapeHtml(party.description)}</p>

            <div class="party-modal-lineup-box">
              <span class="party-modal-lineup-label">Lineup & Hosts</span>
              <span class="party-modal-lineup-names">${escapeHtml(party.lineup)}</span>
            </div>

            <div class="party-modal-actions">
              <a id="party-modal-wa-btn" class="party-btn-whatsapp" href="${generateWhatsAppUrl(party)}" target="_blank" rel="noopener">
                RSVP via WhatsApp Concierge ↗
              </a>
              <button id="party-modal-map-btn" class="party-btn-map" type="button">
                See Route on Map
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Event Listeners
    const backdrop = document.getElementById("party-modal-backdrop");
    const closeBtn = document.getElementById("party-modal-close");

    function openModal() {
      const modalImg = document.getElementById("party-modal-img");
      modalImg.src = party.image;
      modalImg.dataset.fallback = party.fallbackImage;
      modalImg.onerror = function() {
        if (this.src !== this.dataset.fallback) this.src = this.dataset.fallback;
      };
      backdrop.classList.add("active");
      backdrop.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
      backdrop.classList.remove("active");
      backdrop.setAttribute("aria-hidden", "true");
    }

    closeBtn.onclick = closeModal;
    backdrop.onclick = function (e) {
      if (e.target === backdrop) closeModal();
    };

    const card = document.getElementById("featured-party-card");
    if (card) {
      card.addEventListener("click", openModal);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openModal();
        }
      });
    }

    // See Route on Map integration with #map-overlay (per AGENTS.md rules)
    const mapBtn = document.getElementById("party-modal-map-btn");
    if (mapBtn) {
      mapBtn.onclick = function () {
        closeModal();
        const mapOverlay = document.getElementById("map-overlay");
        if (mapOverlay) {
          mapOverlay.classList.add("open");
          mapOverlay.setAttribute("aria-hidden", "false");
          if (window.EchooMap && typeof window.EchooMap.renderPartyRoute === "function") {
            window.EchooMap.renderPartyRoute(party);
          } else if (window.EchooMap && typeof window.EchooMap.focusLocation === "function") {
            window.EchooMap.focusLocation(party.lat, party.lng, party.title);
          }
        } else {
          window.open(`https://www.google.com/maps/search/?api=1&query=${party.lat},${party.lng}`, "_blank");
        }
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPartyRadar);
  } else {
    initPartyRadar();
  }
})();
