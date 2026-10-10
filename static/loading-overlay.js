(() => {
    const OVERLAY_ID = "global-loading-overlay";
    const READ_DELAY_MS = 280;
    let pendingCount = 0;
    let hideTimeoutId = null;
    let showTimeoutId = null;

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

    function revealOverlay() {
        const overlay = ensureOverlay();
        overlay.removeAttribute("hidden");
        overlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("loading-active");
    }

    function beginLoading(immediate) {
        pendingCount += 1;
        if (hideTimeoutId !== null) {
            window.clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }

        if (immediate) {
            if (showTimeoutId !== null) {
                window.clearTimeout(showTimeoutId);
                showTimeoutId = null;
            }
            revealOverlay();
            return;
        }

        if (showTimeoutId !== null || document.body.classList.contains("loading-active")) {
            return;
        }
        showTimeoutId = window.setTimeout(() => {
            showTimeoutId = null;
            if (pendingCount > 0) {
                revealOverlay();
            }
        }, READ_DELAY_MS);
    }

    function endLoading() {
        pendingCount = Math.max(0, pendingCount - 1);
        if (pendingCount > 0) {
            return;
        }

        if (showTimeoutId !== null) {
            window.clearTimeout(showTimeoutId);
            showTimeoutId = null;
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
        }, 80);
    }

    function shouldTrackFetch(input, init) {
        const method = String((init && init.method) || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
            return { track: true, immediate: true };
        }

        let url = "";
        if (typeof input === "string") {
            url = input;
        } else if (input && typeof input.url === "string") {
            url = input.url;
        }

        if (!url.includes("/api/")) {
            return { track: false, immediate: false };
        }
        // Delay overlay on reads so quick responses don't flash.
        return { track: true, immediate: false };
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function trackedFetch(input, init) {
        const { track, immediate } = shouldTrackFetch(input, init);
        if (track) {
            beginLoading(immediate);
        }
        try {
            return await originalFetch(input, init);
        } finally {
            if (track) {
                endLoading();
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
            beginLoading(true);
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
            beginLoading(true);
        },
        true
    );

    window.aGendaLoading = {
        show: () => beginLoading(true),
        hide: endLoading,
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureOverlay);
    } else {
        ensureOverlay();
    }
})();
