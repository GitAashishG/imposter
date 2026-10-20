# Ko Ho? — को हो?

A mobile-first imposter game for Nepali-American get-togethers. Choose **Pass & Play** on one shared phone, or **Own Phones** for a synchronized in-person party. The React/TypeScript/Vite website stays on GitHub Pages; a Cloudflare Worker and one SQLite-backed Durable Object run multiplayer. No player email/password accounts.

## Modes and appearance

The prominent **Pass & Play / Own Phones** selector below the header is available in both modes. Switching away from an active shared-phone game asks for confirmation before clearing its scores. Switching away from an own-phone party does not end it; returning in the same browser restores your seat.

Use the **moon/sun button** in either header to change light or dark mode. The site initially follows your device appearance, including changes while it is open. Once you choose a theme, that choice is remembered on this browser across refreshes, visits, and both modes. Other open tabs in the same browser update too. If browser storage is unavailable, changing the theme still works for the current visit.

Open **This phone’s options** below the mode selector for device-specific comforts. **Keep screen awake while playing** is opt-in, requests a screen wake lock only during an active game, releases it in setup, round results, final standings, or when the page is hidden, and tries again when an active page returns. A browser or battery-saving policy may decline it; the actual status and a retry action are shown. **Vibrate when it’s my clue turn** is also opt-in, with one short vibration request per new clue turn and a test button. Unsupported APIs are disabled with an explanation. Browser acceptance does not guarantee physical vibration; hardware, silent mode, and platform support still apply.

## Run locally

Requires Node.js 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Pass & Play works without a backend; phones on the same Wi-Fi can use Vite’s network URL. The development server binds to your network, so use a trusted network. For Own Phones development, start the local referee and configure its URL as described below.

```sh
npm run build          # Type-check frontend/backend and build dist/
npm run preview        # Serve the production frontend locally
npm test               # Run core and party-rule tests; requires Bun
npm run worker:dev     # Run the local Cloudflare referee on port 8787
npm run worker:deploy  # Deploy the referee using your Cloudflare login
```

Deploy `dist/` to any static web host. Fonts and assets are bundled locally. Pass & Play has no runtime API dependency. Own Phones connects to the configured Cloudflare referee; neither mode includes application analytics.

## GitHub Pages

- Pass & Play: **https://gitaashishg.github.io/imposter/**
- Own Phones: **https://gitaashishg.github.io/imposter/?mode=party**

The repository is public so GitHub Pages is available on the current GitHub plan. `.github/workflows/deploy.yml` deploys the site on every push to `main`, or manually through **Actions → Deploy to GitHub Pages → Run workflow**. Pages uses **GitHub Actions** as its publishing source.

The workflow installs locked dependencies with Node.js 22, type-checks the frontend and backend, and builds with the repository name as Vite’s base path (`/imposter/`). It reads the public backend URL from the GitHub repository variable `VITE_PARTY_API_URL`, uploads `dist/`, and deploys to Pages. Local development and ordinary builds still use `/`. Backend changes are deployed separately with `npm run worker:deploy`.

To preview the Pages build locally with the deployed multiplayer referee:

```sh
export VITE_PARTY_API_URL=https://ko-ho-party.curly-bonus-1233.workers.dev
npm run build -- --base=/imposter/
npm run preview -- --base=/imposter/
```

Open the printed URL ending in `/imposter/`. If the repository is renamed, the workflow automatically uses the new name; update the site links and preview commands here too.

## Play: Pass & Play

1. Add 3–12 unique player names. Choose word packs, 3/5/7 rounds, and a 30/60/90/120-second discussion timer.
2. Pass the phone to each named player. They reveal their role, memorize it, and hide it before handing over the phone. Everyone gets the same English + Nepali-script word except the one imposter, who receives no word or category.
3. Each player gives a spoken clue in the displayed, shuffled order. Clues can be in English or Nepali, but cannot say, spell, or translate the word. If the optional second clue cycle is enabled, go around the same order a second time before discussion.
4. Discuss who is bluffing. Pause/resume the timer or end the discussion early. Expiry does not automatically advance the game.
5. Pass the phone again for private, irreversible votes. Every player votes once and cannot vote for themselves.
6. The unique highest vote count determines the accused; an absolute majority is not required. Normally, catching the imposter gives each non-imposter 1 point; a wrong accusation or tie gives the imposter 2. If the optional last-chance rule is enabled, a caught imposter gets the private challenge described below before points are awarded.
7. Continue through the selected rounds. Highest total wins; tied leaders share the win. **New game, same players** asks for confirmation, clears this game’s scores/roles/votes, and returns to setup with the same names, settings, and recent-word history.

## Play: Own Phones

1. Everyone opens the Own Phones link on their own phone. One person chooses **Be the host**, enters their name, and selects settings. A six-digit PIN is generated automatically; the host can edit it or generate another. **Show PIN** and **Copy PIN** help share it privately. The host plays too, and there is only one shared party.
2. Other players choose **Join the party** and enter a unique name and all six PIN digits. Inline feedback explains missing digits or a disabled button. New players can join only in the lobby, up to 12 players. The host’s **Copy link** and scannable **join QR code** open Own Phones but deliberately contain no PIN, token, or recovery code; share the PIN separately. Use **Refresh availability** if the page was opened before the party was created.
3. Once 3–12 players are connected, the host starts. Each player privately reveals their own role, then taps **Hide & I’m ready**. Even the playing host receives only their own secret. The host starts clues after everyone is ready.
4. Follow the shuffled speaking order and give clues out loud. The speaker or host advances the turn. With two clue cycles enabled, repeat the order before discussion. Discussion uses one shared countdown; the host can pause/resume it and open voting at any time. Timer expiry never automatically casts votes or opens voting.
5. Each player locks one private vote on their own phone. No self-votes or changes after submission. When everyone has voted, scoring either resolves immediately or waits for the optional caught-imposter challenge. Results show aggregate counts, not individual ballot targets. Scoring is identical in both modes.
6. The host starts each next round and shows final standings. **Manage party**, near the top, remains available to run another game, replace the party, transfer hosting, save recovery credentials, or end the session.

Refreshing or switching away preserves a multiplayer seat in the same browser while the party remains active. If someone disconnects, wait for them to return; their role, vote, and score are retained. If they cannot return, the host can choose **New game, same players**, then remove that player from the reopened lobby. This ends the current game and clears its scores rather than changing the roster mid-round.

## Party management and host recovery

Only the current host can make these changes; every destructive action explains its scope and asks for confirmation:

| Manage party action    | Kept                                                                 | Cleared or changed                                                                                                       |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| New game, same players | Party, connected seats, PIN, settings, recovery code, recent words   | Scores, rounds, roles, votes; everyone returns to the lobby with a fresh game identity                                   |
| Start a fresh party    | Host name, settings, non-personal recent words                       | New party, game, PIN, recovery code and host session; every other player must rejoin and every old token is invalid      |
| End party              | Only non-personal recent-word history                                | All party names, seats, roles, ballots, scores, joining/recovery credentials; no new party starts                        |
| Transfer hosting       | Current game, private roles, votes, scores, and all admitted players | A chosen connected player becomes host; the former host stays as a regular player and their recovery code is invalidated |

Open **Manage party → Save your private host recovery code** and save the full code somewhere private. It has eight groups of four hexadecimal characters and is different from the six-digit joining PIN. The host can reveal/copy it or choose **Replace recovery code** to invalidate the previous one. The code hides when the dialog closes or the page loses focus. Anyone with the full recovery code can take over the host’s seat, including that player’s private role; do not share it with the group or put it in a URL.

On another browser or phone, select **Recover hosting** and paste the full private code. Case, spaces, and dashes are accepted. Recovery preserves the existing host identity, current roles, votes, and scores, signs out the old host browser’s sessions, and rotates the recovery code. Save the replacement afterward. The shared joining PIN cannot recover or grant hosting. Ordinary players still need their saved browser session; if they lose it, the host must reopen the lobby and remove the old seat before they join again.

Ending/replacing a party sends an explanatory notice to the old phones. New games have distinct game IDs, and every command carries the rendered game ID as well as relevant round/turn guards: delayed clicks or votes from an earlier game cannot alter a fresh one. A stale tab cannot delete a newer saved host credential created by another tab.

## Optional rules

Both options are available in both modes. Defaults remain **one clue cycle** and **last-chance guessing off**.

- **Two clue cycles:** every player gives two clues, in the same shuffled speaking order, before discussion. Each turn has a separate identity; repeated taps do not skip a future turn.
- **Last-chance imposter guess:** only an imposter caught by a unique highest vote gets one 30-second chance. The imposter enters one complete English or Nepali answer (1–80 characters); precise catalogue aliases also accept common transliterations/plurals. Case, punctuation, whitespace, and Unicode width differences are normalized; partial or fuzzy answers do not count. A correct answer gives the imposter 2 points and the other players none. A wrong answer, skip, or timeout gives each non-imposter 1 point. Wrong accusations and tied votes bypass this challenge and award the normal escape points.

The secret word is not publicly revealed and points are not awarded until the challenge resolves. The multiplayer server enforces the deadline and one-shot scoring even after a reconnect or delayed request; the host can explicitly end the chance without a guess. Pass & Play first shows a private handoff to the imposter, and its 30 seconds include that handoff. Leaving the shared-phone tab hides and clears the unfinished answer.

## Disconnections and abandoned parties

Authenticated WebSocket connections determine presence. Locking or backgrounding a phone alone is not a leave/reset command. If **all** admitted phones are disconnected continuously for **15 minutes**, the party expires and frees the single party slot. Reconnecting any admitted phone within the grace period cancels that abandonment deadline. There is also the existing **12-hour limit without a state-changing game action**, even if connections remain open. Expiry invalidates old sessions and clears personal party state; recent word IDs remain. Automatic cleanup never transfers host authority to another player.

## Multiplayer development and deployment

In one terminal:

```sh
npm run worker:dev
```

In another:

```sh
VITE_PARTY_API_URL=http://localhost:8787 npm run dev -- --port 5174
```

Open `http://localhost:5174/?mode=party`. Use separate browser profiles or private-browser contexts to simulate different phones; ordinary tabs in one profile intentionally share the same saved player identity. Worker state persists locally under the ignored `.wrangler/` directory. Ordinary `npm run dev` needs no backend for Pass & Play.

For production, sign in with `npx wrangler login` and deploy with `npm run worker:deploy`. The config uses Workers Free-compatible SQLite Durable Objects and does not activate a paid plan. Set the HTTPS URL printed by Wrangler as the GitHub repository variable `VITE_PARTY_API_URL` before pushing the frontend. This URL is public configuration, not a credential; no Cloudflare admin token belongs in the website or repository. For local work, credentials and `.env*` / `.dev.vars` files are ignored by Git.

`wrangler.jsonc` lists the allowed frontend origins. If you move hosting or use a LAN development origin, update `ALLOWED_ORIGINS` and deploy the Worker too. PIN entry is throttled after repeated failures. The party has a single persistent owner/referee, authenticated private snapshots, serialized state changes, and hibernating WebSockets; there is no separate database service to provision.

When upgrading the backend, persisted v1 parties are migrated in place: party/player IDs, credential hashes, roles, votes, scores, clue order, and current phase are kept. Old saved settings get the original default rules. Open tabs from the earlier protocol must refresh to send game IDs; the error explains that the seat is saved. Deploy the Worker, then publish the frontend using the same public API URL. Do not reset or delete a live party to upgrade it.

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

Edit `src/data.ts` to adjust words, Nepali labels, and exact optional guess aliases. IDs must stay unique, and descriptions must not reveal sample answers. Each mode retains up to 200 recent word IDs across games. Selection first avoids words in that history; when the selected pool has all been seen, it chooses the least-recently-used word. Local history stays on that browser; multiplayer history stays separately in the referee and survives New game, End party, and fresh parties without retaining personal data. Imposter selection is independent each round, so the same player may be assigned again.

## Privacy and persistence

**Pass & Play:** role and ballot handoffs remove private content from the rendered page. Leaving the tab or opening help/standings hides an exposed role or ballot. Only aggregate vote counts are displayed after voting, not individual ballots.

Local setup, appearance, device comforts, and recent word IDs are stored for Pass & Play. Its roles, votes, scores, and current match progress stay in memory; **refreshing or closing the page ends that shared-phone game**. This local mode is not a security boundary against someone inspecting the browser’s developer tools.

**Own Phones:** Cloudflare stores the party’s names, settings, roles, votes, scores, and progress until it ends or expires. Each device receives only its own role before the public result; individual ballot targets are never included in client snapshots. Only the current host receives the PIN and private recovery code. Server authorization checks the current credential, game identity, host status, phase, round, speaker, and duplicate votes. Recovery revokes old host tokens and WebSockets; transfer revokes the former host’s management authority without changing their player role.

A cryptographically random device token is saved in this browser’s local storage; only its hash is stored in the backend. Treat the full host recovery code as a credential too. Neither credential, nor the party PIN, belongs in a shared URL or QR code. There are no player email/password accounts. Names, scores, readiness, connection status, and whether someone has voted are visible to the admitted party.

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
- `src/RootApp.tsx`: mode switching and shareable `?mode=party` entry
- `src/PlayModeSwitch.tsx`: shared, guarded mode-selection control
- `src/Appearance.tsx`: system-aware theme preference and header toggle
- `src/theme.css`, `src/appearance.css`: light/dark palette and global controls
- `src/GameOptions.tsx`: shared optional rule controls
- `src/DeviceOptions.tsx`: opt-in wake locks and turn vibration with capability/status handling
- `src/InviteLink.tsx`, `src/clipboard.ts`, `src/party/joining.ts`: PIN-free QR invitations, truthful copy controls, secure PIN generation and code formatting
- `src/recentWords.ts`: bounded local recent-word storage
- `src/party/protocol.ts`: shared HTTP/WebSocket snapshots and commands
- `src/party/useParty.ts`: authenticated transport and saved-device reconnect
- `src/party/PartyApp.tsx`, `PartyScreens.tsx`, `party.css`: Own Phones UI
- `worker/model.ts`: authoritative multiplayer transitions and private projection
- `worker/index.ts`: Cloudflare API, persistence, and hibernating WebSockets
- `worker/security.ts`: session tokens, mutation serialization, and PIN throttling
- `worker/model.test.ts`: party behavior, privacy, permissions, and lifecycle tests
- `worker/roadmap.test.ts`: new game identities, recovery/transfer, abandonment, variants, word history and migration boundaries
- `wrangler.jsonc`: single-party SQLite Durable Object deployment
