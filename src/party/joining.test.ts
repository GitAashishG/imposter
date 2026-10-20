import { describe, expect, test } from "bun:test";
import { buildInvitationUrl, normalizeRoomCode, parseRoomInvitation } from "./joining";

describe("room invitations", () => {
  test("puts only room routing in the query and the joining PIN in the removable fragment", () => {
    const value = buildInvitationUrl("https://example.com/imposter/?token=private&admin=true#recovery=private", "abcd2345", "012345");
    const url = new URL(value);
    expect(url.pathname).toBe("/imposter/");
    expect([...url.searchParams.entries()]).toEqual([["mode", "party"], ["room", "ABCD2345"]]);
    expect(url.hash).toBe("#pin=012345");
    expect(value).not.toContain("private");
    expect(value).not.toContain("admin");
  });

  test("consumes a valid fragment once and produces a credential-free history URL", () => {
    const parsed = parseRoomInvitation("https://example.com/imposter/?mode=party&room=abcd2345&pin=999999&token=secret#pin=012345");
    expect(parsed.roomCode).toBe("ABCD2345");
    expect(parsed.pin).toBe("012345");
    expect(parsed.mode).toBe("party");
    expect(parsed.cleanUrl).toBe("https://example.com/imposter/?mode=party&room=ABCD2345");
    expect(parseRoomInvitation(parsed.cleanUrl).pin).toBeNull();
  });

  test("a PIN-free link still selects the correct room without granting entry", () => {
    const parsed = parseRoomInvitation(buildInvitationUrl("https://example.com/imposter/", "ABCD2345"));
    expect(parsed.roomCode).toBe("ABCD2345");
    expect(parsed.pin).toBeNull();
  });

  test("does not accept a query PIN, malformed fragment, or a PIN without a valid room", () => {
    for (const value of [
      "https://example.com/?room=ABCD2345&pin=123456",
      "https://example.com/?room=ABCD2345#pin=1234",
      "https://example.com/?room=ABCD2345#pin=abcdef",
      "https://example.com/?mode=party#pin=123456",
      "https://example.com/?room=IIIIIIII#pin=123456",
    ]) expect(parseRoomInvitation(value).pin).toBeNull();
    expect(() => buildInvitationUrl("https://example.com/", "IIIIIIII", "123456")).toThrow();
    expect(() => buildInvitationUrl("https://example.com/", "ABCD2345", "1234")).toThrow();
  });

  test("normalizes readable room codes without accepting path or ambiguous characters", () => {
    expect(normalizeRoomCode(" abcd2345 ")).toBe("ABCD2345");
    for (const value of ["", "ABCD234", "ABCD23456", "ABCD/345", "ABCDI345", "ABCDO345", "ABCD0345", "ABCD1345"]) expect(normalizeRoomCode(value)).toBe("");
  });
});
