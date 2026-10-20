import { useEffect, useState } from "react";
import App from "./App";
import PartyApp from "./party/PartyApp";

function currentMode(): "local" | "party" {
  return new URLSearchParams(window.location.search).get("mode") === "party"
    ? "party"
    : "local";
}

export default function RootApp() {
  const [mode, setMode] = useState(currentMode);

  useEffect(() => {
    const restore = () => setMode(currentMode());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function navigate(next: "local" | "party") {
    const url = new URL(window.location.href);
    if (next === "party") url.searchParams.set("mode", "party");
    else url.searchParams.delete("mode");
    window.history.pushState(null, "", url);
    setMode(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return mode === "party" ? (
    <PartyApp onLocal={() => navigate("local")} />
  ) : (
    <App onParty={() => navigate("party")} />
  );
}
