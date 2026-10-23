# Ko Ho? — को हो?

A mobile-first imposter game for Nepali-American get-togethers. Choose **Pass & Play** on one shared phone, or **Own Phones** for synchronized in-person parties. The React/TypeScript/Vite website stays on GitHub Pages; a Cloudflare Worker, persistent room directory, and isolated SQLite-backed Durable Objects run multiplayer. Players need no accounts. A separate GitHub-owner login controls administration.

## Modes and appearance

The prominent **Pass & Play / Own Phones** selector below the header is available in both modes. Leaving an active shared-phone game asks for confirmation before discarding that unfinished game; completed-game history is kept. Switching away from an own-phone room does not end it. Its saved seat can be resumed in the same browser while the room remains active.

Use the **moon/sun button** in either header to change light or dark mode. The site initially follows your device appearance, including changes while it is open. Once you choose a theme, that choice is remembered on this browser across refreshes, visits, and both modes. Other open tabs in the same browser update too. If browser storage is unavailable, changing the theme still works for the current visit.

Open **This phone’s options** below the mode selector for device-specific comforts. **Keep screen awake while playing** is opt-in, requests a screen wake lock only during an active game, releases it in setup, round results, final standings, or when the page is hidden, and tries again when an active page returns. A browser or battery-saving policy may decline it; the actual status and a retry action are shown. **Vibrate when it’s my clue turn** is also opt-in, with one short vibration request per new clue turn and a test button. Unsupported APIs are disabled with an explanation. Browser acceptance does not guarantee physical vibration; hardware, silent mode, and platform support still apply.

## Install and play offline

Open the published HTTPS site and stay connected until **Offline Pass & Play ready** appears below the mode selector. The production service worker saves the static app, all bilingual word packs, bundled fonts, and icons. Pass & Play can then launch and complete games without a connection. Browser storage can be cleared or evicted; open online again if offline readiness is lost.

- **Android / supported desktop browsers:** choose **Install app** in Ko Ho. If the browser offers a native install prompt, confirm it; otherwise follow the browser-menu **Install app / Add to Home screen** guidance. Installation support varies by browser.
- **iPhone / iPad:** open Ko Ho in Safari, choose **Share** (or **More → Share**), then **Add to Home Screen**. Leave **Open as Web App** on if shown, tap **Add**, and launch the icon. **Offline tips** contains the same instructions.
- **Own Phones still requires internet**, including in the installed app. Its existing saved-seat reconnection remains authoritative; no room snapshots, roles, votes, guesses, history, admin pages, or OAuth responses enter the service-worker cache. Offline actions are not queued or replayed. This does not change the existing room-token storage described below.
- **Installation does not save an unfinished Pass & Play game.** Closing or refreshing still loses that in-memory match; completed history and preferences survive in the same browser storage. An installed app may use storage separate from its browser, so do not assume names, history, or an Own Phones seat transfer automatically. Keep using the same app/browser for a saved seat; never put private credentials into installation links.

**Updates never reload an open game.** A new version downloads in the background, then waits until **every Ko Ho tab and installed-app window is closed** before activating. An idle setup/lobby/final screen shows **Update ready** with these steps. Finish ongoing games first, close all windows, then reopen. The install/offline/update panel is hidden during active rounds and between-round results; an asynchronous multiplayer start also dismisses open installation guidance. Do not refresh an unfinished shared-phone game to apply an update.

Manifest identity, launch URL, scope, icon paths, and worker registration follow Vite’s resolved deployment base, including the Pages workflow’s `/imposter/`. The custom worker precaches static files only and limits its offline navigation fallback to the app entry (`/imposter/` or `/imposter/index.html`, including invitation/mode query parameters). Other paths and backend/admin/OAuth requests remain network-only. It has no forced-activation message handler, client claiming, runtime response cache, or background action queue.

PWA registration is production-only: use `npm run build` and `npm run preview` to exercise it on localhost. A LAN HTTP development URL is not a secure context for installing an offline service worker; use the published HTTPS URL on phones. Ordinary Vite development does not install a worker. For deployment/update checks, use the existing gated build rather than manually publishing `dist/` from a differently configured preview.

### Phone verification

On an actual iPhone and Android phone, install from the published site, launch the icon, wait for offline readiness, then enable airplane mode and finish a Pass & Play game. Check both themes, notches/home indicators, Nepali text, and private-role concealment after backgrounding. Restore connectivity and confirm an Own Phones saved seat reconnects without replaying a vote. With two app windows open, verify an update stays pending while either remains open and is applied only after both close. These hardware/browser installation checks are separate from desktop Chromium mobile-layout and service-worker verification.

## Run locally

Requires Node.js 22.12+. Automated checks also require Bun 1.4.2 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Pass & Play works without a backend; phones on the same Wi-Fi can use Vite’s network URL. The development server binds to your network, so use a trusted network. For Own Phones development, start the local referee and configure its URL as described below.

```sh
npm run build          # Type-check frontend/backend/service worker and build dist/
npm run preview        # Serve the production frontend locally
npm test               # Run deterministic game, history, room and security tests
npm run test:integration # Exercise real HTTP/WebSocket clients in disposable local rooms
npm run worker:dev     # Run the local Cloudflare referee on port 8787
npm run worker:deploy  # Run rule/client checks and backend type-checks, then deploy
```

Deploy `dist/` to any static web host. Fonts and assets are bundled locally. Pass & Play has no runtime API dependency. Own Phones connects to the configured Cloudflare referee; neither mode includes application analytics.

## GitHub Pages

- Pass & Play: **https://gitaashishg.github.io/imposter/**
- Own Phones: **https://gitaashishg.github.io/imposter/?mode=party**

The repository is public so GitHub Pages is available on the current GitHub plan. `.github/workflows/deploy.yml` deploys the site on every push to `main`, or manually through **Actions → Deploy to GitHub Pages → Run workflow**. Pages uses **GitHub Actions** as its publishing source.

The workflow installs locked dependencies with Node.js 22 and Bun, runs the rule/security tests and real multi-client integration checks, and type-checks the frontend and backend before building with the repository name as Vite’s base path (`/imposter/`). Pull requests run the same checks without publishing. Only a successful `main` or manual `main` run uploads and deploys the verified site. The public backend URL comes from repository variable `VITE_PARTY_API_URL`; no admin credential belongs in it. Local development and ordinary builds still use `/`. Backend releases are deployed separately with `npm run worker:deploy`, which also gates deployment on rule and real-client checks.

To preview the Pages build locally with the deployed multiplayer referee:

```sh
export VITE_PARTY_API_URL=https://ko-ho-party.curly-bonus-1233.workers.dev
npm run build -- --base=/imposter/
npm run preview -- --base=/imposter/
```

Open the printed URL ending in `/imposter/`. If the repository is renamed, the workflow automatically uses the new name; update the site links and preview commands here too.

## Play: Pass & Play

1. Add 3–12 unique player names. Choose word packs, 3/5/7 rounds, and a **1–15-minute discussion time in one-minute steps**. The default is one minute; the slider supports keyboard arrows as well as touch.
2. Pass the phone to each named player. They reveal their role, memorize it, and hide it before handing over the phone. Everyone gets the same English + Nepali-script word except the one imposter, who receives no word or category.
3. Each player gives a spoken clue in the displayed, shuffled order. Clues can be in English or Nepali, but cannot say, spell, or translate the word. If the optional second clue cycle is enabled, go around the same order a second time before discussion.
4. Discuss who is bluffing. Pause/resume the timer or end the discussion early. Expiry does not automatically advance the game.
5. Pass the phone again for private, irreversible votes. Every player votes once and cannot vote for themselves.
6. The unique highest vote count determines the accused; an absolute majority is not required. Normally, catching the imposter gives each non-imposter 1 point; a wrong accusation or tie gives the imposter 2. If the optional last-chance rule is enabled, a caught imposter gets the private challenge described below before points are awarded.
7. Continue through the selected rounds. Highest total wins; tied leaders share the win. **New game, same players** asks for confirmation, clears only the current game’s scores/roles/votes, and returns to setup with the same names, settings, recent words, and previously completed games.

## Play: Own Phones

1. Open Own Phones and choose **Create a room**. Enter a name and select settings, including a **1–15-minute discussion time in one-minute steps**. A six-digit joining PIN is generated automatically; edit it or generate another if needed. The host plays too. Each room has its own eight-character code, players, settings, scores, and credentials.
2. Tap the prominent **Invite players** button. By default its scannable QR and room-specific link include the joining PIN in `#pin=...` for faster joining. **Share invitation** opens native sharing where supported; **Copy link** remains available. Turn off **Include the PIN for faster joining** to share a PIN-free invitation instead.
3. On another phone, scan or open the invitation, enter a unique name, and tap Join. The PIN fragment is prefilled once and removed from the address bar; it does not automatically admit anyone. Alternatively enter the room code and six-digit PIN manually. New players can join only in the lobby, up to 12 people. Anyone with a PIN-bearing invitation can join while joining is open, so share it privately.
4. Once 3–12 players are connected, the host starts. Each player privately reveals their own role, then taps **Hide & I’m ready**. Even the playing host receives only their own secret. The host starts clues after everyone is ready.
5. Follow the shuffled speaking order and give clues out loud. The speaker or host advances the turn. With two clue cycles enabled, repeat the order before discussion. The shared countdown can be paused/resumed by the host, who can open voting at any time. Expiry never automatically casts votes or opens voting.
6. Each player locks one private vote on their own phone. No self-votes or changes after submission. When everyone has voted, scoring resolves or waits for the optional caught-imposter challenge. Results show aggregate counts, not individual ballot targets. Scoring is identical in both modes.
7. The host starts each next round and shows final standings. **Manage party** remains available to run another game, replace the party in this room, transfer hosting, replace joining/recovery credentials, or end the room. **History** shows this party’s completed games and totals.

Use **Home / choose room** to create or join another room. **Recent rooms on this device** lists up to ten saved visits, not public parties or nearby devices. Each room has a separate saved seat, so returning to one does not overwrite another room’s identity. Removing a recent entry removes only that shortcut: it does not leave the party or erase its saved seat. Going Home disconnects the current view but does not end its room.

Refreshing resumes a selected room’s saved seat while it remains active. If someone disconnects, wait for them to return; their role, vote, and score are retained. If they cannot return, the host can choose **New game, same players**, then remove that player from the reopened lobby. This discards the unfinished game, not previous completed-game history, rather than changing the roster mid-round.

## Party management and host recovery

Only the current host can make these changes; every destructive action explains its scope and asks for confirmation:

| Manage party action    | Kept                                                                 | Cleared or changed                                                                                                       |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| New game, same players | Room code, party, seats, PIN, settings, recovery code, recent words, completed games and party totals | Current-game scores, rounds, roles and votes; everyone returns to the lobby with a fresh game identity |
| Start a fresh party | Room code, host name, settings and recent word IDs | Completed-game history/totals and all old player seats; new party, game, PIN, recovery code and host credential; everyone else must rejoin |
| End party | Only bounded administrative closure metadata, without player names or secrets | Room storage, names, seats, roles, ballots, scores, completed games, recent words and credentials; releases capacity without starting another party |
| Transfer hosting | Current game, roles, votes, scores, admitted players and history | A connected player becomes host; the former host remains a player and the old recovery code is invalidated |
| Replace joining PIN | Room, all admitted seats, roles, votes, scores, history and host authority | Old PIN-bearing invitations stop admitting new players; share the replacement through Invite players |

Open **Manage party → Save your private host recovery code** and save the full code somewhere private. It has eight groups of four hexadecimal characters and is different from the six-digit joining PIN. The host can reveal/copy it or choose **Replace recovery code** to invalidate the previous one. The code hides when the dialog closes or the page loses focus. Anyone with the full recovery code can take over the host’s seat, including that player’s private role; do not share it with the group or put it in a URL.

On another browser or phone, select the correct room code, choose **Recover hosting**, and paste the full private code. Case, spaces, and dashes are accepted. Recovery preserves the host identity, roles, votes, scores, and history, signs out old host sessions, and rotates the recovery code. Save the replacement afterward. Neither the room code nor the shared joining PIN can recover or grant hosting. Ordinary players still need their saved seat; if they lose it, the host must reopen the lobby and remove the old seat before they join again.

Ending/replacing a party sends an explanatory notice to the old phones. New games have distinct game IDs, and every command carries the rendered game ID as well as relevant round/turn guards: delayed clicks or votes from an earlier game cannot alter a fresh one. A stale tab cannot delete a newer saved host credential created by another tab.

## Completed games and party totals

Open **Party history & totals** in Pass & Play or **History** in Own Phones. A game is recorded once when final standings are reached, with its completion time, players’ final scores, winners, and rules. Unfinished games and current-round points are not added to totals. Shared winners each receive a win.

Only the latest **20 completed games** are retained. The completed-game counter can exceed 20, but the displayed games played, wins, and points are calculated only from those retained games. Totals use player seats, not nicknames, and are not a global or lifetime ranking. Different rules can produce different point opportunities.

- **Own Phones:** history belongs to one party in one room. New game keeps it; Fresh party, End party, expiry, or owner closure clears it. Refreshing, host recovery, PIN replacement, and host transfer preserve it. Rejoining as a new seat does not merge with an old seat merely because the names match.
- **Pass & Play:** completed games persist on this browser for the same ordered roster. Changing the roster starts a new local-party history; cosmetic case/spacing changes do not. **End local party** explicitly clears its history and current game, while retaining setup preferences and non-personal recent word IDs. Refreshing loses only an unfinished match, not already completed games. Disabled browser storage limits this history to the current visit.

History contains final scores and rules, never private roles, secret words, ballots, session tokens, or recovery codes.

## Optional rules

Both options are available in both modes. Defaults remain **one clue cycle** and **last-chance guessing off**.

- **Two clue cycles:** every player gives two clues, in the same shuffled speaking order, before discussion. Each turn has a separate identity; repeated taps do not skip a future turn.
- **Last-chance imposter guess:** only an imposter caught by a unique highest vote gets one 30-second chance. The imposter enters one complete English or Nepali answer (1–80 characters); precise catalogue aliases also accept common transliterations/plurals. Case, punctuation, whitespace, and Unicode width differences are normalized; partial or fuzzy answers do not count. A correct answer gives the imposter 2 points and the other players none. A wrong answer, skip, or timeout gives each non-imposter 1 point. Wrong accusations and tied votes bypass this challenge and award the normal escape points.

The secret word is not publicly revealed and points are not awarded until the challenge resolves. The multiplayer server enforces the deadline and one-shot scoring even after a reconnect or delayed request; the host can explicitly end the chance without a guess. Pass & Play first shows a private handoff to the imposter, and its 30 seconds include that handoff. Leaving the shared-phone tab hides and clears the unfinished answer.

## Disconnections and abandoned parties

Authenticated WebSocket connections determine presence. Locking or backgrounding a phone alone is not a leave/reset command. If **all** admitted phones in a room are disconnected continuously for **15 minutes**, that room expires and releases its capacity slot. Reconnecting an admitted phone within the grace period cancels that deadline. There is also a **12-hour limit without a state-changing game action**, even if connections remain open. Expiry revokes sessions and clears the room’s personal state, completed games, and word history. It never transfers hosting or affects another room.

## Multiplayer development and deployment

In one terminal:

```sh
npm run worker:dev
```

In another:

```sh
VITE_PARTY_API_URL=http://localhost:8787 npm run dev -- --port 5174
```

Open `http://localhost:5174/?mode=party`. Use separate browser profiles or private-browser contexts to simulate different phones; ordinary tabs share the same seat within a room, while different room codes have separate saved credentials. Worker state persists locally under the ignored `.wrangler/` directory. Ordinary `npm run dev` needs no backend for Pass & Play. `npm run test:integration` starts its own local referee with temporary storage, creates only its own test rooms, and cleans them up; it never targets production.

For production, sign in with `npx wrangler login` and deploy with `npm run worker:deploy`. The config uses Workers Free-compatible SQLite Durable Objects and does not activate a paid plan. Set the HTTPS URL printed by Wrangler as the GitHub repository variable `VITE_PARTY_API_URL` before pushing the frontend. This URL is public configuration, not a credential; no Cloudflare admin token belongs in the website or repository. For local work, credentials and `.env*` / `.dev.vars` files are ignored by Git.

`wrangler.jsonc` lists the allowed frontend origins. If you move hosting or use a LAN development origin, update `ALLOWED_ORIGINS` and deploy the Worker too. Each room has one authoritative referee, authenticated private snapshots, serialized changes, and hibernating WebSockets. The persistent directory reserves capacity atomically, including simultaneous creation requests; unknown room codes do not allocate new room objects. Public directory responses expose capacity, not a browsable room list. No separate database service is required.

### Safe upgrades

The original `PartyRoom` binding and `v1` migration remain intact; the `v2` Durable Object migration adds `RoomDirectory` and `AdminAuth`. Persisted v1/v2 party data upgrades to game schema 3 without redealing roles or resetting earned scores, votes, game identity, clue order, or an active countdown. Legacy 30/90-second discussion choices round upward to a valid whole-minute setting for future discussions, while an already-running countdown keeps its original deadline. Expired legacy parties are not revived or counted toward capacity.

Deploy the Worker, then publish the frontend with the **same** public API URL. On returning to Own Phones home, an old browser seat is authenticated through `/api/rooms/restore`, adopted into one stable room code, and saved under that room without changing its token or player identity. Other rooms’ saved seats are not overwritten. Old open tabs must refresh: retired `/api/party` routes return `426` rather than forwarding to a global party. Do not reset, end, or recover a live party just to upgrade it. Reverting to an older server that cannot read schema 3 is not a safe data rollback.

### Capacity and cleanup

The default is **five simultaneous rooms**, each with up to 12 players. The owner can set the cap from 1 to 20. Lowering it never closes existing rooms; it prevents new rooms until there is space. Ended and expired rooms release capacity, and unavailable capacity produces an explicit join-or-try-later message rather than replacing another party.

Room creation, requests, PIN/recovery attempts, and fresh OAuth flows are rate-limited; histories and administrative storage are bounded. Closed administrative entries contain no player names or secrets and are retained for at most 24 hours, with at most 100 entries, unless explicitly purged earlier. Purging clears application storage and directory metadata; it does not delete the Cloudflare deployment or its Durable Object classes. The configuration does not activate a paid plan. These limits reduce usage but do not replace Cloudflare’s own free-tier quotas.

## Owner administration and GitHub setup

Open **Admin · owner sign-in** in Own Phones, or visit **https://ko-ho-party.curly-bonus-1233.workers.dev/admin**. Players remain account-free. Administration permits only **GitAashishG**, checked server-side against immutable GitHub user ID **9066299**, not a submitted username, room token, or joining PIN. No repository permissions are requested.

GitHub CLI is sufficient for repository/deployment work; installing a GitHub MCP server is unnecessary. An existing `gh auth login` session or personal access token is **not** the OAuth app credential needed by browser sign-in.

1. Register an [OAuth app in the owner’s GitHub account](https://github.com/settings/applications/new). Use a name such as **Ko Ho Admin**, homepage `https://gitaashishg.github.io/imposter/`, and authorization callback **`https://ko-ho-party.curly-bonus-1233.workers.dev/admin/auth/callback`**. No device-flow permission is needed.
2. Copy its Client ID and generate a Client Secret. From this checkout, set each through Wrangler’s interactive prompt; do not paste the secret into chat, source files, shell arguments, frontend variables, or GitHub Pages:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID --name ko-ho-party
   npx wrangler secret put GITHUB_CLIENT_SECRET --name ko-ho-party
   ```

3. Deploy the backend, open `/admin`, and complete the real GitHub authorization as the owner. Keep `ADMIN_GITHUB_USER_ID` set to `9066299`. Other GitHub accounts must be denied. For another deployment, register that Worker’s exact HTTPS `/admin/auth/callback` URL and update `PUBLIC_SITE_URL` as appropriate.

Until both app credentials are configured, administration fails closed and shows setup guidance; public play remains available. Sign-in uses browser-bound, single-use state and S256 PKCE, hash-only server credentials, an eight-hour `Secure`/`HttpOnly` session, and CSRF/origin checks for mutations. Anonymous fresh sign-ins are bounded without preventing an existing browser from renewing its pending flow. Logout revokes the admin session. Local rule and denial checks do not substitute for a real provider authorization.

GitHub callbacks include the RFC 9207 `iss` parameter. The server requires an exact match with GitHub’s [published authorization-server issuer](https://github.com/.well-known/oauth-authorization-server/login/oauth), `https://github.com/login/oauth`, while still validating the single-use state, browser cookie, expiry, and PKCE flow. Missing, foreign, or repeated issuers are rejected. After a failed or interrupted sign-in, restart from `/admin` in the same browser instead of refreshing or reusing a callback URL; callback URLs contain temporary authorization data and are not bookmarks.

The dashboard shows only room codes, status/phase, player and connection counts, completion counts, timestamps, expiry, and cleanup state—not names, secret words, roles, ballots, PINs, recovery codes, or player tokens. It supports:

- **Close room:** type the exact room code to confirm. Only that current party ends, its personal storage and credentials are cleared, and other rooms continue.
- **Purge retained entry:** confirm the code to remove a closed room’s remaining storage and metadata. Active rooms must first be closed; stale operations cannot delete a replacement party.
- **Purge expired / closed:** type `PURGE`; active, non-expired parties are not changed.
- **Maximum simultaneous rooms:** save a value from 1 to 20; concurrent/stale edits require refreshing rather than overwriting a newer configuration.

## Content

200 distinct bilingual words across five family-friendly packs:

| Pack                       | Words |
| -------------------------- | ----: |
| Food & daily life          |    32 |
| Nepal & culture            |    32 |
| Nepali-American life       |    64 |
| Party classics             |    32 |
| Easy words / सजिला शब्दहरू |    40 |

The four original packs remain selected by default; Easy words is an optional selection for mixed-age groups. The diaspora expansion includes familiar cross-cultural family, community, school, travel, and everyday experiences.

Edit `src/data.ts` to adjust words, Nepali labels, and exact optional guess aliases. IDs must stay unique, and descriptions must not reveal sample answers. Each mode retains up to 200 recent word IDs. Selection avoids seen words while possible, then uses the least-recently-used available word. Pass & Play keeps this non-personal word history on the browser even after End local party. Own Phones keeps it within a room across New game and Fresh party, but End party, expiry, owner closure, and storage purge clear it; new rooms do not share it. Imposter selection is independent each round, so the same player may be assigned again.

## Privacy and persistence

**Pass & Play:** role and ballot handoffs remove private content from the rendered page. Leaving the tab or opening help/standings hides an exposed role or ballot. Only aggregate vote counts are displayed after voting, not individual ballots.

Local setup, appearance, device comforts, recent word IDs, and bounded completed-game history are stored on this browser. Roles, ballots, and unfinished match progress stay in memory: **refreshing or closing the page ends that unfinished shared-phone game**, while completed-game history survives. End local party or a changed roster clears its personal history. Local mode is not a security boundary against someone inspecting the browser’s developer tools.

**Own Phones:** each isolated room stores its party’s names, settings, roles, votes, scores, progress, and last 20 completed games until the party ends, is replaced, or expires. Each device receives only its own role before the public result; individual ballot targets are never included in snapshots or history. Only the current host receives joining/recovery credentials in authoritative snapshots. Authorization checks the room-bound token, current game identity, host status, phase, round, speaker, and duplicate submissions. Recovery revokes old host tokens and sockets; transfer changes management authority without changing player roles. History and saved credentials never cross room boundaries.

A cryptographically random player token is saved in local storage under its backend URL and room code; only its hash is stored in the backend. Recent-room shortcuts are separate from credentials, and removing a shortcut does not revoke a seat. **Session tokens, host recovery codes, and admin credentials never belong in shared links or QR codes.** The joining PIN is deliberately allowed in an invitation’s fragment only, is prefilled and removed on arrival, and can be invalidated by host-only PIN rotation without ejecting admitted players. Fragments are not sent as HTTP navigation URLs or referrers, but anyone holding the full invitation can read and use its PIN while joining is open. Share with the intended group only. Names, scores, readiness, connection status, and whether someone has voted are visible to admitted players; admin views expose metadata only.

## Structure

- `src/data.ts`: bilingual packs and words
- `src/game.ts`: validation, word/role selection, voting, scoring, rankings
- `src/game.test.ts`: behavioral rule tests
- `src/useGame.ts`: local-only match transitions
- `src/Setup.tsx`: roster and settings
- `src/playerNames.ts`: sample roster and join-name suggestions; saved player names are not overwritten
- `src/GameScreen.tsx`: private handoffs through final results
- `src/components.tsx`: shared controls, dialogs, rules, scoreboard
- `src/App.tsx`: Pass & Play shell and privacy events
- `src/styles.css`: responsive styling and reduced-motion support
- `src/RootApp.tsx`: mode switching, selected room routing, invitation-fragment consumption
- `src/PlayModeSwitch.tsx`: shared, guarded mode-selection control
- `src/Appearance.tsx`: system-aware theme preference and header toggle
- `src/theme.css`, `src/appearance.css`: light/dark palette and global controls
- `src/GameOptions.tsx`: shared optional rule controls
- `src/DeviceOptions.tsx`: opt-in wake locks and turn vibration with capability/status handling
- `src/pwa.tsx`, `src/PwaControls.tsx`, `src/pwa.css`: production worker lifecycle, explicit install guidance, offline readiness, and non-interrupting update notices
- `service-worker/sw.ts`, `service-worker/tsconfig.json`, `vite.config.ts`: isolated worker typing, static-only precache, entry-only offline navigation, and deployment-scoped manifest generation
- `src/DiscussionTime.tsx`: shared accessible 1–15-minute control
- `src/history.ts`, `src/HistoryPanel.tsx`, `src/history.test.ts`: bounded completed games, retained-game totals, and UI
- `src/InviteLink.tsx`, `src/clipboard.ts`, `src/party/joining.ts`: PIN-bearing/PIN-free QR invitations, native sharing, copy controls, PIN and room-code formatting
- `src/recentWords.ts`: bounded local recent-word storage
- `src/party/protocol.ts`: shared HTTP/WebSocket snapshots and commands
- `src/party/useParty.ts`, `src/party/roomStorage.ts`: room-scoped transport, reconnect, recent visits, and credential-safe legacy migration
- `src/party/PartyApp.tsx`, `PartyScreens.tsx`, `party.css`: Own Phones UI
- `worker/model.ts`: authoritative transitions, private projection, completed games, and preserved-state migration
- `worker/index.ts`: room-scoped Cloudflare gateway, room persistence, private history, and hibernating WebSockets
- `worker/registry.ts`, `worker/registry-domain.ts`, `worker/registry.test.ts`: room directory, atomic capacity, lifecycle metadata, and generation-safe cleanup
- `worker/admin.ts`, `admin-security.ts`, `admin-provider.ts`, `admin-page.ts`, `admin-admission.ts`: owner-only OAuth, bounded admission, secure sessions, and confirmed metadata administration
- `worker/admin-security.test.ts`, `worker/admin-admission.test.ts`: authentication, CSRF/origin, metadata, and admission boundaries
- `scripts/verify-multiplayer.ts`: disposable real HTTP/WebSocket integration runner
- `worker/security.ts`: session tokens, mutation serialization, and PIN throttling
- `worker/model.test.ts`: party behavior, privacy, permissions, and lifecycle tests
- `worker/roadmap.test.ts`: new game identities, recovery/transfer, abandonment, variants, word history and migration boundaries
- `wrangler.jsonc`, `.github/workflows/deploy.yml`: Workers Free-compatible SQLite migrations and gated production publishing
