// Service worker volontairement minimal.
//
// Strategie reseau d'abord, sans cache du code de l'app : un cache trop malin
// sert des vieilles versions apres un deploiement et donne l'impression que
// l'app est cassee. Ici il ne sert qu'a rendre l'app installable et a afficher
// quelque chose de correct quand le reseau est coupe.

const OFFLINE_CACHE = 'bubupost-offline-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add('/')))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // On ne touche ni aux appels d'API ni aux methodes d'ecriture.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Seule la navigation a un repli hors ligne.
  if (request.mode !== 'navigate') return

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(OFFLINE_CACHE).then((cache) => cache.put('/', copy))
        return response
      })
      .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
  )
})
