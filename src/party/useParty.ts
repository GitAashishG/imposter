import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "../game";
import type { GameHistory } from "../history";
import type {
  PartyAction, PartyActionResponse, PartyEntry, PartyErrorBody, PartyEvent,
  PartyHistoryResponse, PartyPublicInfo, PartySession, PartySnapshot,
  RecentRoom, RoomDirectoryInfo,
} from "./protocol";
import { normalizeRoomCode } from "./joining";
import {
  readLegacySession, readRecentRooms, readRoomSession, rememberRoom,
  removeRecentRoom, retireLegacySession, retireRoomSession, saveRoomSession,
} from "./roomStorage";

function backendUrl(): string {
  const configured = import.meta.env.VITE_PARTY_API_URL?.trim();
  if (!configured) return "";
  try {
    const url = new URL(configured);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    return url.href.replace(/\/$/, "");
  } catch { return ""; }
}

export const PARTY_API_URL = backendUrl();
const NETWORK_ERROR = "Connection lost. Your room seat is saved; we’ll reconnect automatically.";

class RequestError extends Error {
  constructor(message: string, readonly code: string, readonly status = 0) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    let response: Response;
    try {
      response = await fetch(`${PARTY_API_URL}${path}`, {
        ...options, signal: controller.signal, cache: "no-store",
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
    } catch {
      throw new RequestError(controller.signal.aborted ? "The room service took too long to respond. Check your connection, then try again." : "Can’t reach the room service. Check your internet connection and try again.", "NETWORK");
    }
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new RequestError("The room service returned an unexpected response. Refresh to check for an update.", "RESPONSE", response.status); }
    if (!response.ok) {
      const error = data as Partial<PartyErrorBody> | null;
      throw new RequestError(error?.error ?? "The room service could not complete that action.", error?.code ?? "REQUEST", response.status);
    }
    return data as T;
  } finally { window.clearTimeout(timeout); }
}

function roomPath(code: string, operation = ""): string { return `/api/rooms/${code}${operation}`; }

export interface PartyClient {
  configured: boolean;
  adminUrl: string | null;
  snapshot: PartySnapshot | null;
  session: PartySession | null;
  publicParty: PartyPublicInfo | null;
  directory: RoomDirectoryInfo | null;
  recentRooms: RecentRoom[];
  status: "checking" | "idle" | "connecting" | "online" | "offline";
  busy: boolean;
  error: string | null;
  notice: string | null;
  history: GameHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  create(name: string, pin: string, settings: Settings): Promise<boolean>;
  join(code: string, name: string, pin: string): Promise<boolean>;
  recover(code: string, recoveryCode: string): Promise<boolean>;
  act(action: PartyAction): Promise<boolean>;
  reconnect(): void;
  forget(): void;
  clearError(): void;
  clearNotice(): void;
  refreshParty(): Promise<void>;
  loadHistory(): Promise<void>;
  removeRecent(code: string): void;
}

export function useParty({ roomCode, onRoomChange }: { roomCode: string | null; onRoomChange: (code: string | null) => void }): PartyClient {
  const code = roomCode ? normalizeRoomCode(roomCode) : "";
  const [session, setSession] = useState<PartySession | null>(() => code ? readRoomSession(PARTY_API_URL, code) : null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const routeRef = useRef(roomCode);
  const codeRef = useRef(code);
  const epoch = useRef(0);
  if (routeRef.current !== roomCode) { routeRef.current = roomCode; epoch.current += 1; }
  codeRef.current = code;
  const onRoomChangeRef = useRef(onRoomChange);
  onRoomChangeRef.current = onRoomChange;
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [publicParty, setPublicParty] = useState<PartyPublicInfo | null>(null);
  const [directory, setDirectory] = useState<RoomDirectoryInfo | null>(null);
  const [recentRooms, setRecentRooms] = useState(() => readRecentRooms(PARTY_API_URL));
  const [status, setStatus] = useState<PartyClient["status"]>(PARTY_API_URL ? "checking" : "idle");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<GameHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyEpoch = useRef(0);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const clearHistory = useCallback(() => {
    historyEpoch.current += 1;
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(false);
  }, []);

  const currentActor = useCallback((actor: PartySession) => {
    const current = sessionRef.current;
    return mounted.current && codeRef.current === actor.roomCode && current?.roomCode === actor.roomCode && current.token === actor.token && current.partyId === actor.partyId;
  }, []);

  const activate = useCallback((next: PartySession | null, nextSnapshot: PartySnapshot | null = null) => {
    sessionRef.current = next;
    setSession(next);
    setSnapshot(nextSnapshot);
    clearHistory();
    setStatus(next ? "connecting" : "idle");
  }, [clearHistory]);

  const retire = useCallback((actor: PartySession, message: string) => {
    const removed = retireRoomSession(PARTY_API_URL, actor);
    if (removed && mounted.current) setRecentRooms(removeRecentRoom(PARTY_API_URL, actor.roomCode));
    if (!currentActor(actor)) return;
    activate(null);
    setError(null);
    setNotice(message);
  }, [activate, currentActor]);

  const acceptSnapshot = useCallback((next: PartySnapshot) => {
    const actor = sessionRef.current;
    if (!mounted.current || !actor || actor.roomCode !== codeRef.current || next.roomCode !== actor.roomCode || next.id !== actor.partyId || next.selfId !== actor.playerId) return;
    setSnapshot((previous) => {
      if (!previous || previous.id !== next.id || previous.roomCode !== next.roomCode || next.revision > previous.revision || (next.revision === previous.revision && next.serverNow >= previous.serverNow)) return next;
      return previous;
    });
  }, []);

  const installEntry = useCallback((entry: PartyEntry, expectedToken: string | null, show: boolean): boolean => {
    const actor = entry.session;
    if (!normalizeRoomCode(actor.roomCode) || actor.roomCode !== entry.snapshot.roomCode || actor.partyId !== entry.snapshot.id || actor.playerId !== entry.snapshot.selfId || !/^[A-Za-z0-9_-]{43}$/.test(actor.token)) {
      if (show) setError("The room service and this page need the same update. Refresh and try again.");
      return false;
    }
    const saved = saveRoomSession(PARTY_API_URL, actor, expectedToken);
    if (saved === "changed") {
      if (show) { setRecentRooms(readRecentRooms(PARTY_API_URL)); setError("Another tab saved a newer seat for this room. Reopen it from Recent rooms or refresh to use that seat."); }
      return false;
    }
    const name = entry.snapshot.players.find((player) => player.id === actor.playerId)?.name;
    const recents = rememberRoom(PARTY_API_URL, actor.roomCode, name);
    if (mounted.current) setRecentRooms(recents);
    if (!show) return true;
    activate(actor, entry.snapshot);
    setPublicParty({ exists: true, roomCode: actor.roomCode, phase: entry.snapshot.phase, playerCount: entry.snapshot.players.length, abandonedExpiresAt: entry.snapshot.abandonedExpiresAt });
    setNotice(null);
    if (saved === "unavailable") setError("This browser can’t save your room seat. Keep this tab open so you do not lose your identity.");
    onRoomChangeRef.current(actor.roomCode);
    return true;
  }, [activate]);

  const refreshParty = useCallback(async () => {
    if (!PARTY_API_URL) return;
    const expectedEpoch = epoch.current;
    const selected = codeRef.current;
    const results = await Promise.allSettled([
      request<RoomDirectoryInfo>("/api/rooms"),
      selected ? request<PartyPublicInfo>(roomPath(selected)) : Promise.resolve(null),
    ]);
    if (!mounted.current || epoch.current !== expectedEpoch) return;
    if (results[0].status === "fulfilled") setDirectory(results[0].value);
    if (results[1].status === "fulfilled") {
      setPublicParty(results[1].value);
      if (!sessionRef.current) setStatus("idle");
    } else {
      const cause = results[1].reason;
      if (cause instanceof RequestError && cause.status === 404 && selected) {
        setPublicParty({ exists: false, roomCode: selected });
        const actor = sessionRef.current;
        if (actor?.roomCode === selected) retire(actor, "This room has closed or expired. Choose another room or create a new one.");
        else { setStatus("idle"); setError(cause.message); clearHistory(); }
      } else if (!sessionRef.current) {
        setStatus("offline");
        setError(cause instanceof Error ? cause.message : "Could not check this room.");
      }
    }
    if (results[0].status === "rejected" && !sessionRef.current) {
      setStatus("offline");
      setError(results[0].reason instanceof Error ? results[0].reason.message : "Could not check room capacity.");
    }
  }, [retire, clearHistory]);

  useEffect(() => {
    let disposed = false;
    const expectedEpoch = epoch.current;
    const selected = code;
    const previous = sessionRef.current;
    if (previous?.roomCode !== selected) activate(selected ? readRoomSession(PARTY_API_URL, selected) : null);
    setPublicParty(null);
    setRecentRooms(readRecentRooms(PARTY_API_URL));
    if (previous?.roomCode !== selected) setError(null);
    setNotice(null);
    if (!PARTY_API_URL) { setStatus("idle"); return; }
    if (roomCode && !selected) {
      setError("Room codes contain eight letters or digits. Check the invitation, or return Home.");
      setStatus("idle");
      void refreshParty();
      return;
    }
    if (!sessionRef.current) setStatus("checking");
    const start = async () => {
      const legacy = !selected ? readLegacySession(PARTY_API_URL) : null;
      if (legacy) {
        try {
          if (!disposed) setStatus("connecting");
          const entry = await request<PartyEntry>("/api/rooms/restore", { method: "POST", body: "{}" }, legacy.token);
          const show = !disposed && mounted.current && epoch.current === expectedEpoch;
          const migrated = installEntry(entry, null, show);
          if (migrated) retireLegacySession(PARTY_API_URL, legacy.token);
          if (show && migrated) return;
        } catch (cause) {
          if (cause instanceof RequestError && cause.code === "SESSION_ENDED") retireLegacySession(PARTY_API_URL, legacy.token);
          else if (!disposed && epoch.current === expectedEpoch) setError(cause instanceof Error ? cause.message : "Could not restore the previous party.");
        }
      }
      if (!disposed && epoch.current === expectedEpoch) await refreshParty();
    };
    void start();
    return () => { disposed = true; };
  }, [code, roomCode, activate, installEntry, refreshParty]);

  useEffect(() => {
    if (!PARTY_API_URL || !session) return;
    let disposed = false;
    let terminated = false;
    let attempts = 0;
    let current: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const expected = session;
    const connect = () => {
      if (disposed || terminated || !currentActor(expected)) return;
      setStatus(attempts ? "offline" : "connecting");
      const url = new URL(`${PARTY_API_URL}${roomPath(expected.roomCode, "/socket")}`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      current = socket;
      socketRef.current = socket;
      socket.onopen = () => { if (!disposed) socket.send(JSON.stringify({ type: "auth", token: expected.token })); };
      socket.onmessage = (event) => {
        if (disposed || socket !== current || !currentActor(expected) || event.data === "pong") return;
        let message: PartyEvent;
        try { message = JSON.parse(String(event.data)) as PartyEvent; }
        catch { socket.close(1002, "Invalid response"); return; }
        if (message.type === "snapshot") {
          acceptSnapshot(message.snapshot);
          setStatus("online");
          setError((previous) => previous === NETWORK_ERROR ? null : previous);
          attempts = 0;
        } else if (message.type === "ended" || (message.type === "error" && message.code === "SESSION_ENDED")) {
          if (message.type === "ended" && ((message.roomCode && message.roomCode !== expected.roomCode) || (message.partyId && message.partyId !== expected.partyId))) return;
          terminated = true;
          retire(expected, message.type === "ended" ? message.message : message.error);
          socket.close();
        } else if (message.type === "error") setError(message.error);
      };
      socket.onerror = () => { if (!disposed && currentActor(expected)) setError(NETWORK_ERROR); };
      socket.onclose = () => {
        if (disposed || terminated || socket !== current || !currentActor(expected)) return;
        setStatus("offline");
        setError(NETWORK_ERROR);
        attempts += 1;
        void refreshParty();
        retry = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts - 1, 4), 10000));
      };
    };
    queueMicrotask(() => { if (!disposed) connect(); });
    const heartbeat = setInterval(() => { if (current?.readyState === WebSocket.OPEN) current.send("ping"); }, 25000);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      if (socketRef.current === current) socketRef.current = null;
      if (current) { current.onclose = null; current.onerror = null; if (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING) current.close(); }
    };
  }, [session, connectionAttempt, currentActor, acceptSnapshot, retire, refreshParty]);

  const reconnect = useCallback(() => {
    if (sessionRef.current) setConnectionAttempt((value) => value + 1);
    else void refreshParty();
  }, [refreshParty]);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      const actor = sessionRef.current;
      const socket = socketRef.current;
      if (!actor || !socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) { reconnect(); return; }
      if (socket.readyState !== WebSocket.OPEN) return;
      void request<PartySnapshot>(roomPath(actor.roomCode, "/state"), {}, actor.token).then((next) => {
        if (currentActor(actor)) acceptSnapshot(next);
      }).catch((cause: unknown) => {
        if (!currentActor(actor)) return;
        if (cause instanceof RequestError && cause.code === "SESSION_ENDED") retire(actor, cause.message);
        else { setError(NETWORK_ERROR); socket.close(); }
      });
    };
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { window.removeEventListener("online", wake); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [reconnect, currentActor, acceptSnapshot, retire]);

  const enter = useCallback(async (path: string, body: object, targetCode?: string): Promise<boolean> => {
    if (!PARTY_API_URL || busyRef.current) return false;
    const expectedEpoch = epoch.current;
    const expectedToken = targetCode ? readRoomSession(PARTY_API_URL, targetCode)?.token ?? null : null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const entry = await request<PartyEntry>(path, { method: "POST", body: JSON.stringify(body) });
      return installEntry(entry, expectedToken, mounted.current && expectedEpoch === epoch.current);
    } catch (cause) {
      if (mounted.current && expectedEpoch === epoch.current) {
        setError(cause instanceof Error ? cause.message : "Could not enter this room.");
        void refreshParty();
      }
      return false;
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }, [installEntry, refreshParty]);

  const create = useCallback((name: string, pin: string, settings: Settings) => enter("/api/rooms", { name, pin, settings }), [enter]);
  const join = useCallback(async (value: string, name: string, pin: string) => {
    const selected = normalizeRoomCode(value);
    if (!selected) { setError("Enter the eight-character room code from your host’s invitation."); return false; }
    return enter(roomPath(selected, "/join"), { name, pin }, selected);
  }, [enter]);
  const recover = useCallback(async (value: string, recoveryCode: string) => {
    const selected = normalizeRoomCode(value);
    if (!selected) { setError("Enter the room code alongside your private host recovery code."); return false; }
    return enter(roomPath(selected, "/recover"), { recoveryCode }, selected);
  }, [enter]);

  const act = useCallback(async (action: PartyAction): Promise<boolean> => {
    const actor = sessionRef.current;
    const expectedEpoch = epoch.current;
    if (!actor || actor.roomCode !== codeRef.current || busyRef.current || socketRef.current?.readyState !== WebSocket.OPEN) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await request<PartyActionResponse>(roomPath(actor.roomCode, "/action"), { method: "POST", body: JSON.stringify({ action }) }, actor.token);
      if (next.session && next.snapshot) return installEntry({ session: next.session, snapshot: next.snapshot }, actor.token, mounted.current && expectedEpoch === epoch.current);
      if (!currentActor(actor)) return next.snapshot === null;
      if (next.snapshot) acceptSnapshot(next.snapshot);
      else retire(actor, "This party session has ended. Join or create another room when you’re ready.");
      return true;
    } catch (cause) {
      if (currentActor(actor)) {
        if (cause instanceof RequestError && cause.code === "SESSION_ENDED") retire(actor, cause.message);
        else setError(cause instanceof Error ? cause.message : "That room action could not be completed.");
      }
      return false;
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }, [installEntry, currentActor, acceptSnapshot, retire]);

  const loadHistory = useCallback(async () => {
    const actor = sessionRef.current;
    if (!actor || actor.roomCode !== codeRef.current) return;
    const sequence = ++historyEpoch.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await request<PartyHistoryResponse>(roomPath(actor.roomCode, "/history"), {}, actor.token);
      if (!currentActor(actor) || sequence !== historyEpoch.current) return;
      if (response.partyId !== actor.partyId || response.roomCode !== actor.roomCode) throw new Error("The party changed before its history arrived. Open history again.");
      setHistory(response.history);
    } catch (cause) {
      if (!currentActor(actor) || sequence !== historyEpoch.current) return;
      if (cause instanceof RequestError && cause.code === "SESSION_ENDED") retire(actor, cause.message);
      else setHistoryError(cause instanceof Error ? cause.message : "Could not load this party’s history.");
    } finally { if (mounted.current && sequence === historyEpoch.current) setHistoryLoading(false); }
  }, [currentActor, retire]);

  const forget = useCallback(() => {
    const actor = sessionRef.current;
    if (actor) retireRoomSession(PARTY_API_URL, actor);
    activate(null);
    setError(null);
    setNotice(null);
  }, [activate]);
  const removeRecent = useCallback((selected: string) => setRecentRooms(removeRecentRoom(PARTY_API_URL, selected)), []);
  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  // Route changes render before passive effects retire the old connection.
  // Never expose the preceding room's snapshot or history during that commit.
  const visibleSession = session?.roomCode === code ? session : null;
  const visibleSnapshot = visibleSession && snapshot?.roomCode === code && snapshot.id === visibleSession.partyId ? snapshot : null;
  const switchingRoom = Boolean(session && session.roomCode !== code);

  return {
    configured: Boolean(PARTY_API_URL), adminUrl: PARTY_API_URL ? new URL("/admin", PARTY_API_URL).href : null,
    snapshot: visibleSnapshot, session: visibleSession,
    publicParty: publicParty?.roomCode === code ? publicParty : null,
    directory, recentRooms, status: switchingRoom ? "checking" : status, busy, error, notice,
    history: visibleSnapshot ? history : null, historyLoading, historyError, create, join, recover, act, reconnect,
    forget, clearError, clearNotice, refreshParty, loadHistory, removeRecent,
  };
}
