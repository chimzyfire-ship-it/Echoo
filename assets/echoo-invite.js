(function () {
  const CONFIG = {
    createUrl:
      "https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/invitation-create",
  };
  let layer = null;
  let activeInvitation = null;
  let activeRequestId = 0;

  const escapeHtml = (value) =>
    String(value || "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );

  function safeImage(value) {
    const image = String(value || "").trim();
    return /^(https?:\/\/|\/?assets\/)/i.test(image) ? image : "";
  }

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement("section");
    layer.className = "echoo-invite-layer";
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  }

  function close() {
    if (!layer) return;
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("echoo-invite-open");
    activeInvitation = null;
    activeRequestId += 1;
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  function setStatus(copy) {
    const status = layer?.querySelector("[data-invite-status]");
    if (status) status.textContent = copy;
  }

  function messageFor(target, url) {
    return `${target.title || "You’re invited"} — open your Echoo invitation: ${url}`;
  }

  async function share(target) {
    if (!activeInvitation?.url) return;
    const payload = {
      title: `Echoo invitation · ${target.title || "Join me"}`,
      text: `You’re invited to ${target.title || "an Echoo plan"}.`,
      url: activeInvitation.url,
    };

    if (window.ReactNativeWebView?.postMessage) {
      window.ReactNativeWebView.postMessage(
        `echoo:share:${JSON.stringify(payload)}`,
      );
      setStatus("Invitation opened in your share sheet.");
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share(payload);
        setStatus("Invitation shared.");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    const providers = layer.querySelector("[data-invite-providers]");
    providers.hidden = false;
    setStatus("Choose an app below, or copy the link.");
  }

  async function providerShare(provider, target) {
    if (!activeInvitation?.url) return;
    const url = activeInvitation.url;
    const message = messageFor(target, url);
    if (provider === "whatsapp") {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(message)}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    await copyText(message);
    setStatus(
      provider === "instagram"
        ? "Copied. Paste the invitation into an Instagram DM."
        : provider === "facebook"
          ? "Copied. Paste the invitation into Facebook or Messenger."
          : "Copied. Paste the invitation into Snapchat.",
    );
    window.open(
      provider === "instagram"
        ? "https://www.instagram.com/"
        : provider === "facebook"
          ? "https://www.facebook.com/"
          : "https://www.snapchat.com/",
      "_blank",
      "noopener,noreferrer",
    );
  }

  function bind(target) {
    layer.querySelector("[data-invite-close]").onclick = close;
    layer.querySelector("[data-invite-scrim]").onclick = close;
    layer.querySelector("[data-invite-share]").onclick = () => share(target);
    layer.querySelector("[data-invite-copy]").onclick = async () => {
      if (!activeInvitation?.url) return;
      await copyText(activeInvitation.url);
      setStatus("Invitation link copied.");
    };
    layer.querySelectorAll("[data-invite-provider]").forEach((button) => {
      button.onclick = () => providerShare(button.dataset.inviteProvider, target);
    });
  }

  async function open(target = {}) {
    if (!target.targetId || !["event", "place"].includes(target.targetType))
      return;
    const mount = ensureLayer();
    const requestId = ++activeRequestId;
    const image = safeImage(target.image);
    mount.innerHTML = `
      <button class="echoo-invite-scrim" type="button" data-invite-scrim tabindex="-1" aria-label="Close invitation"></button>
      <div class="echoo-invite-sheet" role="dialog" aria-modal="true" aria-labelledby="echoo-invite-title">
        <div class="echoo-invite-handle" aria-hidden="true"></div>
        <button class="echoo-invite-close" type="button" data-invite-close aria-label="Close">×</button>
        <div class="echoo-invite-heading"><small>Echoo invitation</small><h2 id="echoo-invite-title">Send the moment.</h2></div>
        <article class="echoo-invite-card">
          ${image ? `<img src="${escapeHtml(image)}" alt="" />` : ""}
          <div class="echoo-invite-card-copy">
            <small>You’re invited</small>
            <strong>${escapeHtml(target.title || "An Echoo plan")}</strong>
            <span>${escapeHtml(target.meta || "Open in Echoo")}</span>
          </div>
        </article>
        <p class="echoo-invite-status" data-invite-status aria-live="polite">Creating your private invitation link…</p>
        <div class="echoo-invite-actions">
          <button class="echoo-invite-primary" type="button" data-invite-share disabled>Share invitation</button>
          <button class="echoo-invite-copy" type="button" data-invite-copy disabled>Copy</button>
        </div>
        <div class="echoo-invite-providers" data-invite-providers hidden>
          <button class="echoo-invite-provider" type="button" data-invite-provider="whatsapp">WhatsApp</button>
          <button class="echoo-invite-provider" type="button" data-invite-provider="instagram">Instagram</button>
          <button class="echoo-invite-provider" type="button" data-invite-provider="facebook">Facebook</button>
          <button class="echoo-invite-provider" type="button" data-invite-provider="snapchat">Snapchat</button>
        </div>
      </div>`;
    mount.hidden = false;
    mount.setAttribute("aria-hidden", "false");
    document.body.classList.add("echoo-invite-open");
    bind(target);

    try {
      const headers = await window.EchooAuth.authHeaders({
        "Content-Type": "application/json",
      });
      const response = await fetch(CONFIG.createUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          targetType: target.targetType,
          targetId: target.targetId,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(json.error || "Invitation could not be created.");
      if (requestId !== activeRequestId || mount.hidden) return;
      activeInvitation = json.invitation;
      mount.querySelector("[data-invite-share]").disabled = false;
      mount.querySelector("[data-invite-copy]").disabled = false;
      setStatus("Ready for WhatsApp, Instagram, Facebook, Snapchat, or any app.");
    } catch (error) {
      if (requestId !== activeRequestId || mount.hidden) return;
      setStatus(error.message || "Invitation could not be created.");
    }
  }

  window.EchooInvite = { close, open };
})();
