// Background service worker. Private handlers (internal endpoints) live in the
// git-ignored background.local.js; without it this does nothing.
try { importScripts("background.local.js"); } catch { /* no private handlers installed */ }
