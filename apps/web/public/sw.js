// Service worker mínimo: só torna o app instalável e acelera a casca
// estática (JS/CSS/ícones). Nunca faz cache de páginas, /api ou
// socket.io - a MultyGames é uma plataforma em tempo real, dados
// desatualizados aqui causariam sessões/partidas quebradas.
const CACHE = "quizarena-shell-v1";
const CACHEABLE = [/^\/_next\/static\//, /^\/icons\//];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!CACHEABLE.some((pattern) => pattern.test(url.pathname))) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
