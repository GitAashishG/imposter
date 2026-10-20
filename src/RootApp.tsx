import { useCallback, useEffect, useState } from "react";
import App from "./App";
import PartyApp from "./party/PartyApp";
import { normalizeRoomCode, parseRoomInvitation } from "./party/joining";

function readLocation() {
  const parsed = parseRoomInvitation(window.location.href);
  if (parsed.cleanUrl !== window.location.href) window.history.replaceState(window.history.state, "", parsed.cleanUrl);
  return { mode: parsed.mode, roomCode: parsed.roomCode, initialPin: parsed.pin };
}

export default function RootApp() {
  const [route, setRoute] = useState(readLocation);

  useEffect(() => {
    const restore = () => setRoute(readLocation());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const navigateRoom = useCallback((code: string | null) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("mode", "party");
    const normalized = code ? normalizeRoomCode(code) : null;
    if (normalized) url.searchParams.set("room", normalized);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    else window.history.replaceState(window.history.state, "", url);
    setRoute({ mode: "party", roomCode: normalized, initialPin: null });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const navigateLocal = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({ mode: "local", roomCode: null, initialPin: null });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return route.mode === "party" ? (
    <PartyApp onLocal={navigateLocal} roomCode={route.roomCode} onRoomChange={navigateRoom} initialPin={route.initialPin} />
  ) : <App onParty={() => navigateRoom(null)} />;
}
