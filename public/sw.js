const CACHE_NAME = 'ssh-web-client-v2';
const urlsToCache = [
  '/ssh',
  '/ssh/',
  '/ssh/app.js',
  '/ssh/manifest.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        // Cache individual items, don't fail all if one fails
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => console.log('Failed to cache:', url, err))
          )
        );
      })
      .catch((err) => {
        console.log('Cache error:', err);
      })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Skip non-GET requests, socket.io, and non-http(s) schemes
  if (event.request.method !== 'GET' || 
      url.includes('socket.io') ||
      url.includes('/api/') ||
      !url.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful responses from same origin
        if (!response || response.status !== 200) {
          return response;
        }
        
        // Don't cache cross-origin responses or API calls
        if (response.type === 'opaque' || url.includes('/api/')) {
          return response;
        }
        
        // Clone the response
        const responseClone = response.clone();
        
        // Cache the fetched response
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseClone);
          })
          .catch(() => {});
        
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return a basic offline response for navigation requests
          if (event.request.mode === 'navigate') {
            return new Response('Offline - Por favor, verifique sua conexão.', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }
          // For other requests, just return a network error
          return new Response('', { status: 503 });
        });
      })
  );
});
