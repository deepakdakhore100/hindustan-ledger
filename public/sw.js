'use strict';
// No offline storage of private pages, sessions, API responses or financial records.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Network is always authoritative for this application.
