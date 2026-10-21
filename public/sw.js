self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Sem cache: o app continua na rede. O listener existe para o Chrome
  // tratar o site como instalável.
});
