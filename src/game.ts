import { PACKS, WORDS, type PackId, type Word } from "./data";

export interface Player {
  id: string;
  name: string;
  score: number;
}

export interface Settings {
  packIds: PackId[];
  rounds: number;
  discussionSeconds: number;
}

export interface Round {
  number: number;
  word: Word;
  imposterId: string;
  clueOrder: string[];
  votes: Record<string, string>;
}

export interface Outcome {
  caught: boolean;
  tied: boolean;
  accusedId: string | null;
  voteCounts: Record<string, number>;
  awards: Record<string, number>;
}

const validPackIds = new Set(PACKS.map((pack) => pack.id));
const own = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function validateNames(names: string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) {
      return "Every player needs a name.";
    }
    const trimmed = name.trim();
    if (trimmed.length > 24)
      return "Player names must be 24 characters or fewer.";
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized))
      return "Player names must be unique (ignoring case).";
    seen.add(normalized);
  }
  return null;
}

export function validateSetup(
  names: string[],
  settings: Settings,
): string | null {
  if (!Array.isArray(names) || names.length < 3 || names.length > 12) {
    return "Add between 3 and 12 players.";
  }
  const nameError = validateNames(names);
  if (nameError) return nameError;
  if (
    !settings ||
    !Array.isArray(settings.packIds) ||
    settings.packIds.length === 0 ||
    settings.packIds.some((id) => !validPackIds.has(id))
  ) {
    return "Choose at least one available word pack.";
  }
  if (![3, 5, 7].includes(settings.rounds)) return "Choose 3, 5, or 7 rounds.";
  if (![30, 60, 90, 120].includes(settings.discussionSeconds)) {
    return "Choose a discussion time of 30, 60, 90, or 120 seconds.";
  }
  return null;
}

function playerIds(players: Player[]): Set<string> {
  if (!Array.isArray(players)) throw new Error("Players must be a list.");
  const nameError = validateNames(players.map((player) => player?.name));
  if (nameError) throw new Error(nameError);
  const ids = new Set<string>();
  for (const player of players) {
    if (typeof player.id !== "string" || !player.id.trim()) {
      throw new Error("Every player needs a nonempty ID.");
    }
    if (ids.has(player.id)) throw new Error("Player IDs must be unique.");
    if (!Number.isSafeInteger(player.score) || player.score < 0) {
      throw new Error("Player scores must be nonnegative safe integers.");
    }
    ids.add(player.id);
  }
  return ids;
}

function randomIndex(length: number, random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(
      "Random values must be finite numbers from 0 (inclusive) to 1 (exclusive).",
    );
  }
  return Math.floor(value * length);
}

export function createRound(
  players: Player[],
  settings: Settings,
  roundNumber: number,
  usedWordIds: string[],
  random: () => number = Math.random,
): Round {
  playerIds(players);
  const setupError = validateSetup(
    players.map((player) => player.name),
    settings,
  );
  if (setupError) throw new Error(setupError);
  if (
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    roundNumber > settings.rounds
  ) {
    throw new Error(
      "The round number must be within the selected match length.",
    );
  }
  if (
    !Array.isArray(usedWordIds) ||
    usedWordIds.some((id) => typeof id !== "string")
  ) {
    throw new Error("Used word IDs must be a chronological list of strings.");
  }

  const selectedPacks = new Set(settings.packIds);
  const pool = WORDS.filter((word) => selectedPacks.has(word.packId));
  if (pool.length === 0)
    throw new Error("The selected packs contain no words.");
  const poolIds = new Set(pool.map((word) => word.id));
  const usedThisCycle = new Set<string>();
  // History spans the whole match. Replaying it preserves nonrepetition after a reset too.
  for (const id of usedWordIds) {
    if (!poolIds.has(id)) continue;
    usedThisCycle.add(id);
    if (usedThisCycle.size === poolIds.size) usedThisCycle.clear();
  }
  const available = pool.filter((word) => !usedThisCycle.has(word.id));
  const word = available[randomIndex(available.length, random)]!;
  const imposterId = players[randomIndex(players.length, random)]!.id;
  const clueOrder = players.map((player) => player.id);
  for (let index = clueOrder.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    const previous = clueOrder[index]!;
    clueOrder[index] = clueOrder[swapIndex]!;
    clueOrder[swapIndex] = previous;
  }
  return { number: roundNumber, word, imposterId, clueOrder, votes: {} };
}

function validateRound(round: Round, players: Player[]): Set<string> {
  const ids = playerIds(players);
  if (players.length < 3 || players.length > 12) {
    throw new Error("A round needs between 3 and 12 players.");
  }
  if (!round || !Number.isInteger(round.number) || round.number < 1) {
    throw new Error("A round needs a positive whole round number.");
  }
  if (!ids.has(round.imposterId))
    throw new Error("The imposter must be a known player.");
  if (
    !Array.isArray(round.clueOrder) ||
    round.clueOrder.length !== players.length ||
    new Set(round.clueOrder).size !== players.length ||
    round.clueOrder.some((id) => !ids.has(id))
  ) {
    throw new Error("The clue order must contain every player exactly once.");
  }
  if (
    !round.votes ||
    typeof round.votes !== "object" ||
    Array.isArray(round.votes)
  ) {
    throw new Error("Round votes must be a voter-to-suspect record.");
  }
  for (const [voterId, suspectId] of Object.entries(round.votes)) {
    if (!ids.has(voterId) || !ids.has(suspectId)) {
      throw new Error("Votes must only refer to known players.");
    }
    if (voterId === suspectId)
      throw new Error("Players cannot vote for themselves.");
  }
  return ids;
}

export function recordVote(
  round: Round,
  players: Player[],
  voterId: string,
  suspectId: string,
): Round {
  const ids = validateRound(round, players);
  if (!ids.has(voterId) || !ids.has(suspectId)) {
    throw new Error("The voter and suspect must both be known players.");
  }
  if (voterId === suspectId)
    throw new Error("Players cannot vote for themselves.");
  if (own(round.votes, voterId))
    throw new Error("Each player can vote only once.");
  return { ...round, votes: { ...round.votes, [voterId]: suspectId } };
}

export function resolveRound(round: Round, players: Player[]): Outcome {
  validateRound(round, players);
  if (players.some((player) => !own(round.votes, player.id))) {
    throw new Error("Every player must vote before the round can be resolved.");
  }
  const voteCounts: Record<string, number> = Object.fromEntries(
    players.map((player) => [player.id, 0]),
  );
  for (const suspectId of Object.values(round.votes))
    voteCounts[suspectId]! += 1;
  const highestCount = Math.max(...Object.values(voteCounts));
  const leaders = players.filter(
    (player) => voteCounts[player.id] === highestCount,
  );
  const tied = leaders.length > 1;
  const accusedId = tied ? null : leaders[0]!.id;
  const caught = accusedId === round.imposterId;
  const awards: Record<string, number> = Object.fromEntries(
    players.map((player) => [
      player.id,
      caught
        ? player.id === round.imposterId
          ? 0
          : 1
        : player.id === round.imposterId
          ? 2
          : 0,
    ]),
  );
  return { caught, tied, accusedId, voteCounts, awards };
}

export function applyAwards(players: Player[], outcome: Outcome): Player[] {
  const ids = playerIds(players);
  if (
    !outcome?.awards ||
    Object.keys(outcome.awards).length !== players.length ||
    Object.keys(outcome.awards).some((id) => !ids.has(id))
  ) {
    throw new Error("Awards must include exactly the current players.");
  }
  return players.map((player) => {
    const award = outcome.awards[player.id];
    if (
      !own(outcome.awards, player.id) ||
      !Number.isSafeInteger(award) ||
      award! < 0 ||
      award! > 2
    ) {
      throw new Error("Every player needs a valid award of 0, 1, or 2 points.");
    }
    const score = player.score + award!;
    if (!Number.isSafeInteger(score))
      throw new Error("The resulting score is too large.");
    return { ...player, score };
  });
}

export function rankPlayers(players: Player[]): Player[] {
  playerIds(players);
  return [...players].sort((left, right) => right.score - left.score);
}
