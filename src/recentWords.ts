import { WORDS } from "./data";
import { RECENT_WORD_LIMIT } from "./game";

const KEY = "ko-ho-recent-words-v1";
const validIds = new Set(WORDS.map((word) => word.id));

function knownHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === "string" && validIds.has(id))
    .slice(-RECENT_WORD_LIMIT);
}

export function loadRecentWords(): string[] {
  try {
    return knownHistory(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveRecentWords(history: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(knownHistory(history)));
  } catch {
    /* A game remains playable when this browser cannot save history. */
  }
}
