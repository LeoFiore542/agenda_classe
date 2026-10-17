(() => {
    const OVERLAY_ID = "global-loading-overlay";
    const READ_DELAY_MS = 280;
    const STUCK_GUARD_MS = 20000;
    let pendingCount = 0;
    let hideTimeoutId = null;
    let showTimeoutId = null;
    let stuckGuardTimeoutId = null;

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

    function clearStuckGuard() {
        if (stuckGuardTimeoutId !== null) {
            window.clearTimeout(stuckGuardTimeoutId);
            stuckGuardTimeoutId = null;
        }
    }

    function scheduleStuckGuard() {
        clearStuckGuard();
        stuckGuardTimeoutId = window.setTimeout(() => {
            stuckGuardTimeoutId = null;
            if (pendingCount > 0) {
                forceHideLoading();
            }
        }, STUCK_GUARD_MS);
    }

    function revealOverlay() {
        const overlay = ensureOverlay();
        overlay.removeAttribute("hidden");
        overlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("loading-active");
        scheduleStuckGuard();
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
            scheduleStuckGuard();
            return;
        }
        showTimeoutId = window.setTimeout(() => {
            showTimeoutId = null;
            if (pendingCount > 0) {
                revealOverlay();
            }
        }, READ_DELAY_MS);
    }

    function hideOverlayNow() {
        clearStuckGuard();
        if (showTimeoutId !== null) {
            window.clearTimeout(showTimeoutId);
            showTimeoutId = null;
        }
        if (hideTimeoutId !== null) {
            window.clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) {
            document.body.classList.remove("loading-active");
            return;
        }
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");
        document.body.classList.remove("loading-active");
    }

    function forceHideLoading() {
        pendingCount = 0;
        hideOverlayNow();
    }

    function endLoading() {
        pendingCount = Math.max(0, pendingCount - 1);
        if (pendingCount > 0) {
            scheduleStuckGuard();
            return;
        }

        if (showTimeoutId !== null) {
            window.clearTimeout(showTimeoutId);
            showTimeoutId = null;
        }

        hideTimeoutId = window.setTimeout(() => {
            if (pendingCount > 0) {
                return;
            }
            hideOverlayNow();
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

    // Bubble phase (not capture): SPA forms call preventDefault first, so we skip
    // them and let the fetch wrapper own the overlay. Classic full-page submits
    // still show loading because defaultPrevented stays false.
    document.addEventListener("submit", (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) {
            return;
        }
        if (event.defaultPrevented) {
            return;
        }
        beginLoading(true);
    });

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

    window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
            forceHideLoading();
        }
    });

    window.aGendaLoading = {
        show: () => beginLoading(true),
        hide: endLoading,
        reset: forceHideLoading,
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureOverlay);
    } else {
        ensureOverlay();
    }
})();

