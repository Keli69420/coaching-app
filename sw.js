// Makes the app open with no signal. Always tries for the newest version first, so a
// changed plan reaches the phone the next time it opens with signal, and falls back to
// the saved copy after 1.5 s so a bad gym signal can't hang it. Proven on Yapp.
// Only the page's own files and fonts pass through here. The client's logs never do, and neither
// does anything to or from the Groups server: that's another address, and goes straight out.
const CACHE = "coach-v10";
const SHELL = ["./", "./index.html", "./styles.css", "./logic.js", "./picture.js", "./weight.js", "./plans.js", "./planpages.js", "./market-logic.js", "./market.js", "./share-logic.js", "./coach-logic.js", "./coach.js", "./config.js", "./social.js", "./groups.js", "./app.js", "./plans/muscle-up.md", "./manifest.webmanifest", "./icon-180.png"];
const TIMEOUT_MS = 1500;
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // Only our own old copies: every app on keli69420.github.io shares this cache storage.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("coach-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function newestFirst(e) {
  const cache = await caches.open(CACHE);
  const url = new URL(e.request.url);
  url.search = "";
  const network = fetch(url.href, { cache: "no-cache" }).then((res) => {
    if (res.ok) cache.put(url.href, res.clone());
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  const saved = await cache.match(e.request, { ignoreSearch: true });
  if (!saved) return network;
  const fallback = new Promise((resolve) => setTimeout(() => resolve(saved), TIMEOUT_MS));
  return Promise.race([network.catch(() => saved), fallback]);
}

async function fontsFromCache(e) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(e.request);
  if (saved) return saved;
  const res = await fetch(e.request);
  if (res.ok || res.type === "opaque") cache.put(e.request, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) e.respondWith(newestFirst(e));
  else if (FONT_HOSTS.includes(url.hostname)) e.respondWith(fontsFromCache(e));
});
