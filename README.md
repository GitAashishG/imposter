# Ko Ho? — को हो?

A mobile-first imposter game for Nepali-American get-togethers. Choose **Pass & Play** on one shared phone, or **Own Phones** for a synchronized in-person party. The React/TypeScript/Vite website stays on GitHub Pages; a Cloudflare Worker and one SQLite-backed Durable Object run multiplayer. No player email/password accounts.

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
3. Each player gives one spoken clue in the displayed, shuffled order. Clues can be in English or Nepali, but cannot say, spell, or translate the word.
4. Discuss who is bluffing. Pause/resume the timer or end the discussion early. Expiry does not automatically advance the game.
5. Pass the phone again for private, irreversible votes. Every player votes once and cannot vote for themselves.
6. The unique highest vote count determines the accused; an absolute majority is not required. Catch the imposter and every non-imposter earns 1 point. Accuse someone else, or tie the highest vote count, and the imposter earns 2 points. Ties do not eliminate anyone.
7. Continue through the selected rounds. Highest total wins; tied leaders share the win. Play again returns to setup with the same names and fresh scores.

## Play: Own Phones

1. Everyone opens the Own Phones link on their own phone. One person chooses **Be the host**, enters their name, chooses a six-digit PIN, and selects settings. The host plays too. There is only one shared party, not a list of rooms.
2. Other players choose **Join the party** and enter a unique name and the shared PIN. If they opened the page before the host created the party, use **Refresh availability**. New players can join only in the lobby, with a maximum of 12.
3. Once 3–12 players are connected, the host starts. Each player privately reveals their own role, then taps **Hide & I’m ready**. Even the playing host receives only their own secret. The host starts clues after everyone is ready.
4. Follow the shuffled speaking order and give clues out loud. The speaker or host advances the turn. Discussion uses one shared countdown; the host can pause/resume it and open voting at any time. Timer expiry never automatically casts votes or advances the phase.
5. Each player locks one private vote on their own phone. No self-votes or changes after submission. When everyone has voted, the server reveals aggregate counts, the imposter, the word, and the scores. Scoring is identical to Pass & Play.
6. The host starts each next round and shows final standings. **One more game** returns everyone to the same lobby with fresh scores. **End party for everyone** clears the party and invalidates all its player sessions.

Refreshing or switching away preserves a multiplayer seat in the same browser. If someone disconnects, wait for them to reconnect; their role, vote, and score are retained. If they cannot return, the host can reset the match to the lobby and remove them. There is no automatic host takeover: the host must return using the same browser, end the party, or let it expire after 12 hours without a state-changing game action. Clearing site storage or using a different browser loses that saved identity.

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

## Content

128 bilingual words across four family-friendly packs:

- Food & daily life
- Nepal & culture
- Nepali-American life
- Party classics

Edit `src/data.ts` to adjust words and translations. IDs must stay unique. Words do not repeat within a match until the selected packs are exhausted. Imposter selection is independent each round, so the same player may receive that role more than once.

## Privacy and persistence

**Pass & Play:** role and ballot handoffs remove private content from the rendered page. Leaving the tab or opening help/standings hides an exposed role or ballot. Only aggregate vote counts are displayed after voting, not individual ballots.

Only local setup preferences are stored for Pass & Play. Its roles, votes, scores, and match progress stay in memory; **refreshing or closing the page ends that shared-phone match**. This local mode is not a security boundary against someone inspecting the browser’s developer tools.

**Own Phones:** Cloudflare stores the party’s names, settings, roles, votes, scores, and progress until the host ends it or it expires. Each device receives only its own role before the public result; individual ballot targets are never included in client snapshots. The host has management controls, not permission to read other players’ secrets. Server authorization checks every action, including host status, phase, round, speaker, and duplicate votes.

A cryptographically random device token is saved in this browser’s local storage; only its hash is stored in the backend. Protect that token like a session credential. There are no player email/password accounts. Names, scores, readiness, connection status, and whether someone has voted are visible to the admitted party. Keep the PIN within your group and do not put it or player tokens in shared URLs.

## Structure

- `src/data.ts`: bilingual packs and words
- `src/game.ts`: validation, word/role selection, voting, scoring, rankings
- `src/game.test.ts`: behavioral rule tests
- `src/useGame.ts`: local-only match transitions
- `src/Setup.tsx`: roster and settings
- `src/GameScreen.tsx`: private handoffs through final results
- `src/components.tsx`: shared controls, dialogs, rules, scoreboard
- `src/App.tsx`: Pass & Play shell and privacy events
- `src/styles.css`: responsive styling and reduced-motion support
- `src/RootApp.tsx`: mode switching and shareable `?mode=party` entry
- `src/party/protocol.ts`: shared HTTP/WebSocket snapshots and commands
- `src/party/useParty.ts`: authenticated transport and saved-device reconnect
- `src/party/PartyApp.tsx`, `PartyScreens.tsx`, `party.css`: Own Phones UI
- `worker/model.ts`: authoritative multiplayer transitions and private projection
- `worker/index.ts`: Cloudflare API, persistence, and hibernating WebSockets
- `worker/security.ts`: session tokens, mutation serialization, and PIN throttling
- `worker/model.test.ts`: party behavior, privacy, permissions, and lifecycle tests
- `wrangler.jsonc`: single-party SQLite Durable Object deployment
