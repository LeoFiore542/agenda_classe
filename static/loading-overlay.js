(() => {
    const OVERLAY_ID = "global-loading-overlay";
    let pendingCount = 0;
    let hideTimeoutId = null;

    function ensureOverlay() {
        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            return overlay;
        }

        overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.className = "loading-overlay";
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
            <div class="loading-overlay-card" role="status" aria-live="polite">
                <div class="loading-spinner" aria-hidden="true"></div>
                <p class="loading-overlay-title">Caricamento</p>
                <p class="loading-overlay-copy">Attendere un momento...</p>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function showLoading() {
        pendingCount += 1;
        if (hideTimeoutId !== null) {
            window.clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }

        const overlay = ensureOverlay();
        overlay.removeAttribute("hidden");
        overlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("loading-active");
    }

    function hideLoading() {
        pendingCount = Math.max(0, pendingCount - 1);
        if (pendingCount > 0) {
            return;
        }

        hideTimeoutId = window.setTimeout(() => {
            const overlay = document.getElementById(OVERLAY_ID);
            if (!overlay || pendingCount > 0) {
                return;
            }
            overlay.setAttribute("hidden", "");
            overlay.setAttribute("aria-hidden", "true");
            document.body.classList.remove("loading-active");
            hideTimeoutId = null;
        }, 120);
    }

    function shouldTrackFetch(input, init) {
        const method = String((init && init.method) || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
            return true;
        }

        let url = "";
        if (typeof input === "string") {
            url = input;
        } else if (input && typeof input.url === "string") {
            url = input.url;
        }

        // Track API reads that can freeze the UI while waiting.
        return url.includes("/api/");
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function trackedFetch(input, init) {
        const track = shouldTrackFetch(input, init);
        if (track) {
            showLoading();
        }
        try {
            return await originalFetch(input, init);
        } finally {
            if (track) {
                hideLoading();
            }
        }
    };

    function shouldShowForNavigation(anchor) {
        if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
            return false;
        }
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
            return false;
        }

        try {
            const url = new URL(href, window.location.href);
            if (url.origin !== window.location.origin) {
                return false;
            }
            if (url.pathname === window.location.pathname && url.search === window.location.search) {
                return false;
            }
            return true;
        } catch (_error) {
            return false;
        }
    }

    document.addEventListener(
        "submit",
        (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement)) {
                return;
            }
            if (event.defaultPrevented) {
                return;
            }
            showLoading();
        },
        true
    );

    document.addEventListener(
        "click",
        (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const anchor = target.closest("a[href]");
            if (!shouldShowForNavigation(anchor)) {
                return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
            }
            showLoading();
        },
        true
    );

    window.aGendaLoading = {
        show: showLoading,
        hide: hideLoading,
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureOverlay);
    } else {
        ensureOverlay();
    }
})();
