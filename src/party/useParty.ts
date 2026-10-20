import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "../game";
import type {
  PartyAction,
  PartyEntry,
  PartyErrorBody,
  PartyEvent,
  PartyPublicInfo,
  PartySession,
  PartySnapshot,
} from "./protocol";

function backendUrl(): string {
  const configured = import.meta.env.VITE_PARTY_API_URL?.trim();
  if (!configured) return "";
  try {
    const url = new URL(configured);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
      return "";
    if (url.username || url.password || url.search || url.hash) return "";
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

const API = backendUrl();
const SESSION_KEY = `ko-ho-party-session-v1:${API}`;
const NETWORK_ERROR =
  "Connection lost. We’ll reconnect automatically; keep this page open.";

function readSession(): PartySession | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(SESSION_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return null;
    const session = value as PartySession;
    return [session.partyId, session.playerId, session.token].every(
      (part) => typeof part === "string" && part.length > 0,
    )
      ? session
      : null;
  } catch {
    return null;
  }
}

function storeSession(session: PartySession | null): boolean {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}/api/party${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new RequestError(
      "Can’t reach the party service. Check your internet connection and try again.",
      "NETWORK",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(
      "The party service returned an unexpected response. Please try again.",
      "RESPONSE",
    );
  }
  if (!response.ok) {
    const error = data as Partial<PartyErrorBody> | null;
    throw new RequestError(
      error?.error ?? "The party service could not complete that action.",
      error?.code ?? "REQUEST",
    );
  }
  return data as T;
}

export interface PartyClient {
  configured: boolean;
  snapshot: PartySnapshot | null;
  session: PartySession | null;
  publicParty: PartyPublicInfo | null;
  status: "checking" | "idle" | "connecting" | "online" | "offline";
  busy: boolean;
  error: string | null;
  create(name: string, pin: string, settings: Settings): Promise<void>;
  join(name: string, pin: string): Promise<void>;
  act(action: PartyAction): Promise<void>;
  reconnect(): void;
  forget(): void;
  clearError(): void;
  refreshParty(): Promise<void>;
}

export function useParty(): PartyClient {
  const [session, setSession] = useState<PartySession | null>(readSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [publicParty, setPublicParty] = useState<PartyPublicInfo | null>(null);
  const [status, setStatus] = useState<PartyClient["status"]>(
    API ? "checking" : "idle",
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  const replaceSession = useCallback((next: PartySession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (!storeSession(next) && next) {
      setError(
        "Your browser can’t save this player session. Keep this tab open to avoid losing your seat.",
      );
    }
  }, []);

  const acceptSnapshot = useCallback((next: PartySnapshot) => {
    if (
      next.id !== sessionRef.current?.partyId ||
      next.selfId !== sessionRef.current?.playerId
    )
      return;
    setSnapshot((previous) => {
      if (
        !previous ||
        previous.id !== next.id ||
        next.revision > previous.revision
      )
        return next;
      if (
        next.revision === previous.revision &&
        next.serverNow >= previous.serverNow
      )
        return next;
      return previous;
    });
  }, []);

  const refreshParty = useCallback(async () => {
    if (!API) return;
    try {
      const next = await request<PartyPublicInfo>("");
      setPublicParty(next);
      if (!sessionRef.current) setStatus("idle");
    } catch (cause) {
      if (!sessionRef.current) {
        setStatus("offline");
        setError(
          cause instanceof Error
            ? cause.message
            : "Can’t check the party right now.",
        );
      }
    }
  }, []);

  useEffect(() => {
    if (!session) void refreshParty();
  }, [session, refreshParty]);

  useEffect(() => {
    if (!API || !session) return;
    let disposed = false;
    let terminated = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let current: WebSocket | null = null;
    const expected = session;

    const connect = () => {
      if (disposed || terminated) return;
      setStatus(attempt ? "offline" : "connecting");
      const url = new URL(`${API}/api/party/socket`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      current = socket;
      socketRef.current = socket;
      socket.onopen = () => {
        if (!disposed)
          socket.send(JSON.stringify({ type: "auth", token: expected.token }));
      };
      socket.onmessage = (event) => {
        if (disposed || socket !== current || event.data === "pong") return;
        let message: PartyEvent;
        try {
          message = JSON.parse(String(event.data)) as PartyEvent;
        } catch {
          socket.close(1002, "Invalid response");
          return;
        }
        if (message.type === "snapshot") {
          acceptSnapshot(message.snapshot);
          setStatus("online");
          setError((previous) =>
            previous === NETWORK_ERROR ? null : previous,
          );
          attempt = 0;
        } else if (
          message.type === "ended" ||
          (message.type === "error" && message.code === "SESSION_ENDED")
        ) {
          terminated = true;
          setError(message.type === "ended" ? message.message : message.error);
          replaceSession(null);
          setSnapshot(null);
          setStatus("idle");
          socket.close();
        } else if (message.type === "error") {
          setError(message.error);
        }
      };
      socket.onerror = () => {
        if (!disposed) setError(NETWORK_ERROR);
      };
      socket.onclose = () => {
        if (disposed || terminated || socket !== current) return;
        setStatus("offline");
        setError(NETWORK_ERROR);
        attempt += 1;
        retry = setTimeout(
          connect,
          Math.min(1000 * 2 ** Math.min(attempt - 1, 4), 10000),
        );
      };
    };

    queueMicrotask(() => {
      if (!disposed) connect();
    });
    heartbeat = setInterval(() => {
      if (current?.readyState === WebSocket.OPEN) current.send("ping");
    }, 25000);

    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      if (socketRef.current === current) socketRef.current = null;
      if (current) {
        current.onclose = null;
        current.onerror = null;
        if (
          current.readyState === WebSocket.OPEN ||
          current.readyState === WebSocket.CONNECTING
        )
          current.close();
      }
    };
  }, [session, connectionAttempt, acceptSnapshot, replaceSession]);

  const reconnect = useCallback(() => {
    if (sessionRef.current) setConnectionAttempt((value) => value + 1);
    else void refreshParty();
  }, [refreshParty]);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      const socket = socketRef.current;
      if (
        !socket ||
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
      ) {
        reconnect();
        return;
      }
      const actor = sessionRef.current;
      if (socket.readyState !== WebSocket.OPEN || !actor) return;
      // Mobile browsers may suspend their clocks while backgrounded. Get a fresh
      // server timestamp without dropping an otherwise healthy connection.
      void request<PartySnapshot>("/state", {}, actor.token)
        .then((next) => {
          if (sessionRef.current?.token === actor.token) acceptSnapshot(next);
        })
        .catch((cause: unknown) => {
          if (sessionRef.current?.token !== actor.token) return;
          if (cause instanceof RequestError && cause.code === "SESSION_ENDED") {
            replaceSession(null);
            setSnapshot(null);
            setStatus("idle");
            setError(cause.message);
          } else {
            setError(NETWORK_ERROR);
            socket.close();
          }
        });
    };
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [reconnect, acceptSnapshot, replaceSession]);

  const forget = useCallback(() => {
    replaceSession(null);
    setSnapshot(null);
    setStatus("idle");
    setError(null);
  }, [replaceSession]);

  const enter = useCallback(
    async (path: "/create" | "/join", body: object) => {
      if (!API || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const entry = await request<PartyEntry>(path, {
          method: "POST",
          body: JSON.stringify(body),
        });
        replaceSession(entry.session);
        setSnapshot(entry.snapshot);
        setPublicParty({
          exists: true,
          phase: entry.snapshot.phase,
          playerCount: entry.snapshot.players.length,
        });
        setStatus("connecting");
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not enter the party.",
        );
        void refreshParty();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [replaceSession, refreshParty],
  );

  const act = useCallback(
    async (action: PartyAction) => {
      const actor = sessionRef.current;
      if (
        !actor ||
        busyRef.current ||
        socketRef.current?.readyState !== WebSocket.OPEN
      )
        return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const next = await request<PartySnapshot | null>(
          "/action",
          {
            method: "POST",
            body: JSON.stringify({ action }),
          },
          actor.token,
        );
        if (sessionRef.current?.token !== actor.token) return;
        if (next) acceptSnapshot(next);
        else {
          replaceSession(null);
          setSnapshot(null);
          setStatus("idle");
        }
      } catch (cause) {
        if (cause instanceof RequestError && cause.code === "SESSION_ENDED") {
          replaceSession(null);
          setSnapshot(null);
          setStatus("idle");
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "That action could not be completed.",
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [acceptSnapshot, replaceSession],
  );

  const create = useCallback(
    (name: string, pin: string, settings: Settings) =>
      enter("/create", { name, pin, settings }),
    [enter],
  );
  const join = useCallback(
    (name: string, pin: string) => enter("/join", { name, pin }),
    [enter],
  );
  const clearError = useCallback(() => setError(null), []);

  return {
    configured: Boolean(API),
    snapshot,
    session,
    publicParty,
    status,
    busy,
    error,
    create,
    join,
    act,
    reconnect,
    forget,
    clearError,
    refreshParty,
  };
}
