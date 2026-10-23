import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaState {
  offlineReady: boolean;
  updateReady: boolean;
  offlineError: boolean;
  installed: boolean;
  installPromptAvailable: boolean;
  ios: boolean;
  installing: boolean;
  install(): Promise<void>;
}

const PwaContext = createContext<PwaState | null>(null);
let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;

function registerWorker() {
  // Share registration across StrictMode's effect replay, without registering in dev.
  registrationPromise ??= navigator.serviceWorker.register(
    `${import.meta.env.BASE_URL}sw.js`,
    { scope: import.meta.env.BASE_URL, updateViaCache: "none" },
  );
  return registrationPromise;
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [offlineError, setOfflineError] = useState(false);
  const [installed, setInstalled] = useState(isInstalled);
  const [installPromptAvailable, setInstallPromptAvailable] = useState(false);
  const [installing, setInstalling] = useState(false);
  const promptRef = useRef<InstallPromptEvent | null>(null);
  const prompting = useRef(false);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const displayChanged = () => setInstalled(isInstalled());
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
      setInstallPromptAvailable(true);
    };
    const appInstalled = () => {
      promptRef.current = null;
      setInstallPromptAvailable(false);
      setInstalled(true);
    };
    displayMode.addEventListener("change", displayChanged);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    return () => {
      displayMode.removeEventListener("change", displayChanged);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) {
      setOfflineError(true);
      return;
    }
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const register = () => {
      registerWorker().then((registration) => {
        if (disposed) return;
        const active = () => {
          if (registration.active?.state === "activated") {
            setOfflineReady(true);
            setOfflineError(false);
          }
        };
        const watch = (worker: ServiceWorker | null) => {
          if (!worker) return;
          const changed = () => {
            if (disposed) return;
            active();
            if (worker.state === "installed" && registration.active) {
              setUpdateReady(true);
            } else if (worker.state === "redundant" && !registration.active) {
              setOfflineError(true);
            }
          };
          worker.addEventListener("statechange", changed);
          cleanups.push(() => worker.removeEventListener("statechange", changed));
          changed();
        };
        active();
        setUpdateReady(!!registration.waiting);
        watch(registration.installing);
        // An existing active worker can still be finishing its first activation.
        if (registration.active?.state === "activating") watch(registration.active);
        const updateFound = () => watch(registration.installing);
        registration.addEventListener("updatefound", updateFound);
        cleanups.push(() => registration.removeEventListener("updatefound", updateFound));
        // Deliberately no skipWaiting, clients.claim, controllerchange reload or
        // update action: a new version waits until ALL controlled windows close.
      }).catch(() => {
        if (!disposed) setOfflineError(true);
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt || prompting.current) return;
    prompting.current = true;
    promptRef.current = null;
    setInstallPromptAvailable(false);
    setInstalling(true);
    try {
      // Keep prompt() in the user's click gesture, before the first await.
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // The one-shot prompt expired; the install control now offers menu steps.
    } finally {
      prompting.current = false;
      setInstalling(false);
    }
  }, []);

  return (
    <PwaContext.Provider value={{
      offlineReady, updateReady, offlineError, installed,
      installPromptAvailable, ios, installing, install,
    }}>
      {children}
    </PwaContext.Provider>
  );
}

export function usePwa() {
  const state = useContext(PwaContext);
  if (!state) throw new Error("PWA controls require PwaProvider.");
  return state;
}
