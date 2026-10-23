import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import type { PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

// Static app shell only. There is deliberately no skipWaiting, clients.claim or
// message handler: a new version activates only after every Ko Ho window closes.
// Precaching already removes obsolete revisions within this scope's own cache.
// cleanupOutdatedCaches would also evict nested apps when this base is "/".
precacheAndRoute(self.__WB_MANIFEST);

// The worker is served from the app base, so its directory is the app entry path
// for both `/` and `--base=/imposter/` builds without baking the base in.
const entryPath = new URL("./", self.location.href).pathname;
const escapedEntryPath = entryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    allowlist: [new RegExp(`^${escapedEntryPath}(?:index\\.html)?(?:\\?.*)?$`)],
  }),
);
