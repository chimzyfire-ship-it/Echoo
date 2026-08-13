(() => {
  const dismiss = () => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("echoo-page-loading");
    });
  };

  const pageReady =
    document.readyState !== "loading"
      ? Promise.resolve()
      : new Promise((resolve) =>
          document.addEventListener("DOMContentLoaded", resolve, {
            once: true,
          }),
        );
  Promise.all([pageReady, window.echooAccessReady || Promise.resolve()]).then(
    ([, access]) => {
      if (!access || access.ok) dismiss();
    },
  );

  // Handle back/forward cache navigation in WebViews & mobile Safari
  window.addEventListener("pageshow", () => {
    Promise.resolve(window.echooAccessReady).then((access) => {
      if (!access || access.ok) dismiss();
    });
  });
})();
