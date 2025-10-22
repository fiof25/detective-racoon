// Service Worker for cache management
const CACHE_NAME = 'detective-raccoon-v' + Date.now();

// Install event - clear all caches
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          console.log('Deleting cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('All caches cleared');
      return self.skipWaiting();
    })
  );
});

// Activate event - take control immediately
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    self.clients.claim()
  );
});

// Fetch event - always fetch from network (no caching)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request.clone(), {
      cache: 'no-store'
    }).catch(() => {
      // If network fails, try cache as fallback
      return caches.match(event.request);
    })
  );
});
