"use client";
// PWA wiring: registers the service worker (production only — a SW in dev
// causes confusing staleness) and handles the install prompt gracefully:
// Chromium fires beforeinstallprompt → we stash it and show a quiet
// footer link; iOS never fires it (manual Add to Home Screen — documented
// honestly in BETA.md); already-installed → nothing renders.
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaSetup() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration failure degrades to a normal website */
    });
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!installEvent) return null;
  return (
    <p>
      <button
        onClick={async () => {
          await installEvent.prompt();
          await installEvent.userChoice;
          setInstallEvent(null);
        }}
        className="text-teal hover:underline"
      >
        Install Kaskly as an app
      </button>
    </p>
  );
}
