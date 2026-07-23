(() => {
  const dismiss = () => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("echoo-page-loading");
    });
  };

  if (document.readyState !== "loading") {
    dismiss();
  } else {
    document.addEventListener("DOMContentLoaded", dismiss, { once: true });
    window.addEventListener("load", dismiss, { once: true });
  }

  // Handle back/forward cache navigation in WebViews & mobile Safari
  window.addEventListener("pageshow", dismiss);

  // Failsafe timeout so the screen NEVER stays blank or frozen under any circumstance
  setTimeout(dismiss, 300);
})();

