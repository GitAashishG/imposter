export function generatePin(): string {
  const values = new Uint32Array(1);
  const unbiasedLimit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  do {
    crypto.getRandomValues(values);
  } while (values[0]! >= unbiasedLimit);
  return (values[0]! % 1_000_000).toString().padStart(6, "0");
}

export function normalizeRecoveryCode(value: string): string {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[0-9A-F]{32}$/.test(normalized) ? normalized : "";
}

export function formatRecoveryCode(value: string): string {
  const normalized = normalizeRecoveryCode(value);
  return normalized ? normalized.match(/.{4}/g)!.join("-") : "";
}

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeRoomCode(value: string): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(normalized) ? normalized : "";
}

export function buildInvitationUrl(base: string, roomCode: string, pin?: string): string {
  const code = normalizeRoomCode(roomCode);
  if (!code) throw new Error("A valid eight-character room code is required.");
  const source = new URL(base);
  const url = new URL(source.origin + source.pathname);
  url.searchParams.set("mode", "party");
  url.searchParams.set("room", code);
  if (pin !== undefined) {
    if (!/^[0-9]{6}$/.test(pin)) throw new Error("Invitation PINs must contain six digits.");
    url.hash = new URLSearchParams({ pin }).toString();
  }
  return url.href;
}

export function parseRoomInvitation(value: string): {
  mode: "local" | "party";
  roomCode: string | null;
  pin: string | null;
  cleanUrl: string;
} {
  const source = new URL(value);
  const rawCode = source.searchParams.get("room");
  const roomCode = rawCode ? normalizeRoomCode(rawCode) || rawCode.trim().toUpperCase() : null;
  const mode = source.searchParams.get("mode") === "party" || roomCode ? "party" : "local";
  const fragmentPin = new URLSearchParams(source.hash.slice(1)).get("pin");
  const pin = roomCode && normalizeRoomCode(roomCode) && fragmentPin && /^[0-9]{6}$/.test(fragmentPin) ? fragmentPin : null;
  const clean = new URL(source.origin + source.pathname);
  if (mode === "party") clean.searchParams.set("mode", "party");
  if (roomCode) clean.searchParams.set("room", roomCode);
  return { mode, roomCode, pin, cleanUrl: clean.href };
}
