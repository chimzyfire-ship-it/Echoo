(() => {
  const dismissed = { current: false };

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("echoo-page-loading");
    });
  };

  // Pages whose first paint depends on an async boot decision (auth.html)
  // call this explicitly when their real content is ready. Everywhere else
  // the loader dismisses as soon as the page + access check resolve, so
  // content never pops in behind a vanished loader.
  window.echooDismissPageLoader = dismiss;

  const pageReady =
    document.readyState !== "loading"
      ? Promise.resolve()
      : new Promise((resolve) =>
          document.addEventListener("DOMContentLoaded", resolve, {
            once: true,
          }),
        );

  const holdsOwnReveal =
    document.body?.dataset?.page === "auth" ||
    document.documentElement.getAttribute("data-echoo-hold-loader") === "1";

  if (!holdsOwnReveal) {
    Promise.all([pageReady, window.echooAccessReady || Promise.resolve()]).then(
      ([, access]) => {
        if (!access || access.ok) dismiss();
      },
    );
  }

  // Handle back/forward cache navigation in WebViews & mobile Safari
  window.addEventListener("pageshow", () => {
    Promise.resolve(window.echooAccessReady).then((access) => {
      if (!access || access.ok) dismiss();
    });
  });
})();
