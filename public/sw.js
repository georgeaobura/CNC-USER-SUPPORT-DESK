const CACHE="ust-shell-v5";const SHELL=["/","/styles.css?v=5","/app.js","/manifest.webmanifest","/assets/organisation-logo-transparent.svg","/assets/acms-heading-reference.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET"||new URL(e.request.url).pathname.startsWith("/api/"))return;e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));});
