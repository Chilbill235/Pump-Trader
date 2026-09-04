"use client";

import { useEffect, useState } from "react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    // iOS doesn't fire beforeinstallprompt — show a manual hint instead.
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!evt) return false;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setEvt(null);
    return outcome === "accepted";
  }

  return { canInstall: !!evt, install, installed };
}