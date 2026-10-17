const CACHE_NAME = "agenda-shell-v4";
const SHELL_ASSETS = [
    "/login",
    "/manifest.webmanifest",
    "/static/styles.css",
    "/static/loading-overlay.js",
    "/static/pwa.js",
    "/static/app.js",
    "/static/orario.js",
    "/static/account.js",
    "/static/password-toggle.js",
    "/static/logo.png",
    "/static/icon-180.png",
    "/static/icon-192.png",
    "/static/icon-512.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.all(
                SHELL_ASSETS.map((url) => cache.add(url).catch(() => undefined))
            );
            await self.skipWaiting();
        })
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    // Always go to network for API and auth-sensitive HTML navigations.
    if (url.pathname.startsWith("/api/") || request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => response)
                .catch(async () => {
                    const cached = await caches.match(request);
                    if (cached) {
                        return cached;
                    }
                    if (request.mode === "navigate") {
                        return caches.match("/") || caches.match("/login");
                    }
                    throw new Error("Offline");
                })
        );
        return;
    }

    // Network-first for JS so deploys are not stuck on a stale shell script.
    if (url.pathname.startsWith("/static/") && url.pathname.endsWith(".js")) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Cache-first for other static shell assets.
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) {
                return cached;
            }
            return fetch(request).then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return response;
            });
        })
    );
});
