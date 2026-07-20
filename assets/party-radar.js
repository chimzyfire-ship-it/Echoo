/**
 * Echoo Party Drops & Radar Component
 * Minimalist, elegant upcoming parties module with WhatsApp Concierge & Map overlay integration.
 */

(function () {
  const WHATSAPP_HOST_NUMBER = "16478901234"; // Echoo Concierge WhatsApp contact

  const ECHOO_UPCOMING_PARTIES = [
    {
      id: "party-nocturne-rooftop",
      title: "Nocturne: Rooftop Sunset & Midnight",
      venue: "Kōjin Rooftop Lounge",
      address: "190 University Ave, Toronto",
      lat: 43.6491,
      lng: -79.3854,
      date: "Saturday, Oct 26",
      time: "10:00 PM – 3:00 AM",
      dressCode: "Chic & Dark",
      entry: "Guestlist / Table RSVP",
      lineup: "DJ Julian, Noir Beats, Special Guest",
      description: "An exclusive high-fashion rooftop experience featuring panoramic city views, deep house rhythms, and curated cocktails. Limited table reservations available via Echoo Concierge.",
      image: "assets/echoo_party_noir.jpg",
      fallbackImage: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80",
      tags: "Rooftop · House · Table RSVP"
    },
    {
      id: "party-aura-afrobeats",
      title: "Aura: Afrobeats & Amapiano Flow",
      venue: "Subterranean Velvet Club",
      address: "510 King St W, Toronto",
      lat: 43.6455,
      lng: -79.3972,
      date: "Friday, Nov 1",
      time: "10:30 PM – 4:00 AM",
      dressCode: "Elevated Nightwear",
      entry: "RSVP Direct",
      lineup: "DJ Spinall, Major Soundz, Amapiano Kings",
      description: "Immerse yourself in heavy basslines, authentic Amapiano grooves, and Afrobeats energy. Curated by Echoo for night owls and music purists.",
      image: "assets/echoo_party_aura.jpg",
      fallbackImage: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80",
      tags: "Afrobeats · Amapiano · Nightlife"
    }
  ];

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function generateWhatsAppUrl(party) {
    const messageText = `Hey Echoo! I'd like to RSVP / book a table for "${party.title}" on ${party.date} at ${party.venue}.`;
    return `https://wa.me/${WHATSAPP_HOST_NUMBER}?text=${encodeURIComponent(messageText)}`;
  }

  function initPartyRadar() {
    const container = document.getElementById("party-radar-mount");
    if (!container) return;

    let html = `
      <div class="party-radar-section">
        <div class="party-radar-header">
          <div>
            <h2 class="party-radar-title">Upcoming Drops</h2>
            <span class="party-radar-subtitle">Echoo Curated Parties</span>
          </div>
        </div>
        <div class="party-cards-strip">
    `;

    ECHOO_UPCOMING_PARTIES.forEach((party, idx) => {
      html += `
        <div class="party-card" role="button" tabindex="0" data-party-index="${idx}">
          <div class="party-poster-box">
            <img class="party-poster-img" src="${escapeHtml(party.image)}" data-fallback="${escapeHtml(party.fallbackImage)}" alt="${escapeHtml(party.title)}" loading="lazy" onerror="if(this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.style.display='none';}" />
          </div>
          <div class="party-card-body">
            <span class="party-date-time">${escapeHtml(party.date)} · ${escapeHtml(party.time.split('–')[0].trim())}</span>
            <h3 class="party-name">${escapeHtml(party.title)}</h3>
            <span class="party-venue-line">${escapeHtml(party.venue)}</span>
            <span class="party-lineup-preview">${escapeHtml(party.lineup)}</span>
            <div class="party-card-footer">
              <span class="party-tag-clean">${escapeHtml(party.tags)}</span>
              <span class="party-action-link">Details & RSVP ↗</span>
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>

      <!-- Detail Modal Sheet -->
      <div id="party-modal-backdrop" class="party-modal-backdrop" aria-hidden="true">
        <div class="party-modal-sheet" role="dialog" aria-modal="true">
          <button id="party-modal-close" class="party-modal-close" aria-label="Close sheet">&times;</button>
          <div class="party-modal-hero">
            <img id="party-modal-img" src="" alt="" />
          </div>
          <div class="party-modal-body">
            <div>
              <span id="party-modal-date" class="party-modal-date"></span>
              <h2 id="party-modal-title" class="party-modal-title"></h2>
              <span id="party-modal-venue" class="party-modal-venue"></span>
            </div>

            <div class="party-modal-grid">
              <div>
                <div class="party-meta-item-title">Time</div>
                <div id="party-modal-time" class="party-meta-item-val"></div>
              </div>
              <div>
                <div class="party-meta-item-title">Dress Code</div>
                <div id="party-modal-dress" class="party-meta-item-val"></div>
              </div>
              <div>
                <div class="party-meta-item-title">Entry</div>
                <div id="party-modal-entry" class="party-meta-item-val"></div>
              </div>
              <div>
                <div class="party-meta-item-title">Address</div>
                <div id="party-modal-address" class="party-meta-item-val"></div>
              </div>
            </div>

            <p id="party-modal-desc" class="party-modal-desc"></p>

            <div class="party-modal-lineup-box">
              <span class="party-modal-lineup-label">Lineup</span>
              <span id="party-modal-lineup" class="party-modal-lineup-names"></span>
            </div>

            <div class="party-modal-actions">
              <a id="party-modal-wa-btn" class="party-btn-whatsapp" href="#" target="_blank" rel="noopener">
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

    // Attach Event Listeners
    const backdrop = document.getElementById("party-modal-backdrop");
    const closeBtn = document.getElementById("party-modal-close");
    let currentParty = null;

    function openModal(party) {
      currentParty = party;
      const modalImg = document.getElementById("party-modal-img");
      modalImg.src = party.image;
      modalImg.dataset.fallback = party.fallbackImage;
      modalImg.onerror = function() {
        if (this.src !== this.dataset.fallback) this.src = this.dataset.fallback;
      };
      modalImg.alt = party.title;

      document.getElementById("party-modal-date").textContent = party.date;
      document.getElementById("party-modal-title").textContent = party.title;
      document.getElementById("party-modal-venue").textContent = `${party.venue} · ${party.address}`;
      document.getElementById("party-modal-time").textContent = party.time;
      document.getElementById("party-modal-dress").textContent = party.dressCode;
      document.getElementById("party-modal-entry").textContent = party.entry;
      document.getElementById("party-modal-address").textContent = party.address.split(',')[0];
      document.getElementById("party-modal-desc").textContent = party.description;
      document.getElementById("party-modal-lineup").textContent = party.lineup;

      const waBtn = document.getElementById("party-modal-wa-btn");
      waBtn.href = generateWhatsAppUrl(party);

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

    document.querySelectorAll("[data-party-index]").forEach(card => {
      card.addEventListener("click", () => {
        const idx = Number(card.dataset.partyIndex);
        openModal(ECHOO_UPCOMING_PARTIES[idx]);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const idx = Number(card.dataset.partyIndex);
          openModal(ECHOO_UPCOMING_PARTIES[idx]);
        }
      });
    });

    // See Route on Map integration with #map-overlay (per AGENTS.md rules)
    const mapBtn = document.getElementById("party-modal-map-btn");
    mapBtn.onclick = function () {
      if (!currentParty) return;
      closeModal();

      const mapOverlay = document.getElementById("map-overlay");
      if (mapOverlay) {
        mapOverlay.classList.add("open");
        mapOverlay.setAttribute("aria-hidden", "false");
        if (window.EchooMap && typeof window.EchooMap.renderPartyRoute === "function") {
          window.EchooMap.renderPartyRoute(currentParty);
        } else if (window.EchooMap && typeof window.EchooMap.focusLocation === "function") {
          window.EchooMap.focusLocation(currentParty.lat, currentParty.lng, currentParty.title);
        }
      } else {
        window.open(`https://www.google.com/maps/search/?api=1&query=${currentParty.lat},${currentParty.lng}`, "_blank");
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPartyRadar);
  } else {
    initPartyRadar();
  }
})();
