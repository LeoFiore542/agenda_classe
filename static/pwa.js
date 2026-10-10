(() => {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
            // Installability still works if SW registration fails temporarily.
        });
    });
})();
