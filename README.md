# Ko Ho? — को हो?

A mobile-first, pass-one-phone imposter game for Nepali-American get-togethers. Built with React, TypeScript, and Vite; no backend or accounts.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To play on a phone on the same Wi-Fi, use the network URL Vite prints. The development server binds to your network; only run it on a trusted network.

```sh
npm run build    # Type-check and build dist/
npm run preview  # Serve the production build locally
npm test         # Run the game-rule tests; requires Bun
```

Deploy `dist/` to any static web host. Assets and fonts are bundled locally; there are no external runtime APIs or analytics.

## Play

1. Add 3–12 unique player names. Choose word packs, 3/5/7 rounds, and a 30/60/90/120-second discussion timer.
2. Pass the phone to each named player. They reveal their role, memorize it, and hide it before handing over the phone. Everyone gets the same English + Nepali-script word except the one imposter, who receives no word or category.
3. Each player gives one spoken clue in the displayed, shuffled order. Clues can be in English or Nepali, but cannot say, spell, or translate the word.
4. Discuss who is bluffing. Pause/resume the timer or end the discussion early. Expiry does not automatically advance the game.
5. Pass the phone again for private, irreversible votes. Every player votes once and cannot vote for themselves.
6. The unique highest vote count determines the accused; an absolute majority is not required. Catch the imposter and every non-imposter earns 1 point. Accuse someone else, or tie the highest vote count, and the imposter earns 2 points. Ties do not eliminate anyone.
7. Continue through the selected rounds. Highest total wins; tied leaders share the win. Play again returns to setup with the same names and fresh scores.

## Content

128 bilingual words across four family-friendly packs:

- Food & daily life
- Nepal & culture
- Nepali-American life
- Party classics

Edit `src/data.ts` to adjust words and translations. IDs must stay unique. Words do not repeat within a match until the selected packs are exhausted. Imposter selection is independent each round, so the same player may receive that role more than once.

## Privacy and persistence

Role and ballot handoffs remove private content from the rendered page. Leaving the tab or opening help/standings hides an exposed role or ballot. Only aggregate vote counts are displayed after voting, not individual ballots.

Only player names and setup preferences are stored in this browser’s local storage, when available. Roles, votes, scores, and match progress are kept in memory. **Refreshing or closing the page ends the current match.** This is a casual shared-device game, not a security boundary against someone inspecting browser developer tools.

## Structure

- `src/data.ts`: bilingual packs and words
- `src/game.ts`: validation, word/role selection, voting, scoring, rankings
- `src/game.test.ts`: behavioral rule tests
- `src/useGame.ts`: match transitions
- `src/Setup.tsx`: roster and settings
- `src/GameScreen.tsx`: private handoffs through final results
- `src/components.tsx`: shared controls, dialogs, rules, scoreboard
- `src/App.tsx`: application shell and privacy events
- `src/styles.css`: responsive styling and reduced-motion support
