"use client";
// Hide/unhide view-state (gate finding F9, scoped 2026-08-04: only SETTLED
// cards — answered/refunded/expired — ever offer the affordance; live Asks
// with claimable funds cannot be hidden at all in v1, so nothing hidden
// ever holds claimable money). "Hide" is the honest name: nothing is
// stored anywhere new — a card is purely removed from view, locally.
// Strictly a browser-localStorage display preference: never touches the
// cache DB or the chain, always recoverable from the Hidden section.
// Rebuild-from-chain restores all data and respects these marks.
import { useCallback, useEffect, useState } from "react";

const KEY = "kaskly.hidden.v1";

function persist(next: Set<string>) {
  window.localStorage.setItem(KEY, JSON.stringify([...next]));
}

export function useHidden() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(KEY) ?? "[]"
        ) as string[];
        if (!cancelled) setHidden(new Set(stored));
      } catch {
        /* corrupted view-state — start fresh */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hide = useCallback((askRef: string) => {
    setHidden((cur) => {
      const next = new Set(cur);
      next.add(askRef);
      persist(next);
      return next;
    });
  }, []);

  const unhide = useCallback((askRef: string) => {
    setHidden((cur) => {
      const next = new Set(cur);
      next.delete(askRef);
      persist(next);
      return next;
    });
  }, []);

  return { hidden, hide, unhide };
}
