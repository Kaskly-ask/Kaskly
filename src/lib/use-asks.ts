"use client";
// Per-screen view over the app-wide activity state (see activity.tsx —
// the F8 refactor moved discovery/derivation/auto-refund there so badges
// and the auto-refund rule work from any screen). This adapter keeps the
// original per-role API the Inbox/Sent pages were built against, and
// marks the role's items seen while the page is actually visible.
import { useEffect, useMemo } from "react";
import { useActivity, type LiveAsk } from "./activity";
import { useChain } from "./chain";
import { useWallet } from "./wallet";

export type { LiveAsk };

export function useAsks(role: "sender" | "recipient") {
  const { wallet } = useWallet();
  const { daaScore } = useChain();
  const { asks, loading, error, upsertLocal, markSeen } = useActivity();
  const address = wallet?.address ?? null;

  const mine = useMemo(
    () =>
      asks.filter((a) =>
        role === "sender"
          ? a.senderAddress === address
          : a.recipientAddress === address
      ),
    [asks, role, address]
  );

  // F8: viewing the page consumes its unread state — but only while the
  // tab is actually visible, so background tabs keep their title count.
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === "visible") markSeen(role);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [mine, role, markSeen]);

  return { asks: mine, loading, error, daaScore, upsertLocal };
}
