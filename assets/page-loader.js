(() => {
  const dismiss = () => requestAnimationFrame(() => document.documentElement.classList.remove("echoo-page-loading"));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dismiss, { once: true });
  else dismiss();
})();
