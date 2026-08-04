"use client";
// App-wide live-ask state + activity awareness (Phase 3 gate finding F8).
// This provider owns what used to live in the per-page useAsks hook, so:
//   - discovery, status derivation and the §8 auto-refund rule run while
//     ANY screen is open (not just Inbox/Sent);
//   - the header can show unread badges and the document title can carry
//     a count for background tabs.
// "Seen" state lives in localStorage: askRef → last status the user saw.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AskRecordDto } from "./ask-record";
import {
  cacheAsk,
  deriveStatusFromChain,
  fetchCachedAsks,
  maybeAutoRefund,
} from "./asks-client";
import { useChain } from "./chain";
import { useWallet } from "./wallet";
import { REFUND_FEE_ALLOWANCE } from "./ask/protocol";

export interface LiveAsk extends AskRecordDto {
  /** §4 escrow verification, made visible to the UI:
   *  "pending" — cached row displayed while re-verification settles;
   *  "ok"      — announced parameters reproduce the funded P2SH;
   *  "failed"  — chain does not back this announcement (never surfaced).
   *  Firehose discoveries only ever enter the list as "ok". */
  verification: "pending" | "ok" | "failed";
  replyCiphertext: string | null;
  /** Net sompi the recipient received when answered (chain-derived). */
  claimNetSompi: string | null;
  /** When the claim/refund was mined, epoch ms (F10 resolution time). */
  resolvedAtMs: number | null;
}

const RE_DERIVE_MS = 45_000;
const SEEN_KEY = "kaskly.seen.v1";
const BASE_TITLE = "Kaskly — Just Ask Me";

type SeenMap = Record<string, string>;

function loadSeen(): SeenMap {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "{}") as SeenMap;
  } catch {
    return {};
  }
}

interface ActivityContextValue {
  /** Every live ask involving the connected wallet (either role). */
  asks: LiveAsk[];
  loading: boolean;
  error: string | null;
  upsertLocal: (a: LiveAsk) => void;
  /** Unseen incoming asks (recipient role). */
  unreadInbox: number;
  /** Sent asks whose terminal state (answered/refunded) is unseen. */
  unreadSent: number;
  /** Mark the given role's current items as seen (call from the pages). */
  markSeen: (role: "sender" | "recipient") => void;
  /** Total net sompi earned by replying — sum of the wallet's claim
   * outputs, chain-derived and rebuild-consistent ("Earned" widget). */
  earnedSompi: bigint;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { wallet } = useWallet();
  const { getRpc, rpcStatus, daaScore } = useChain();
  const [asks, setAsks] = useState<LiveAsk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<SeenMap>({});
  const refundAttempted = useRef<Set<string>>(new Set());
  const address = wallet?.address ?? null;

  useEffect(() => {
    // Restore seen-marks once the browser storage is available.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSeen(loadSeen());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const upsertLocal = useCallback((next: LiveAsk) => {
    setAsks((cur) => {
      const i = cur.findIndex((a) => a.askRef === next.askRef);
      if (i < 0) return [next, ...cur];
      const copy = [...cur];
      copy[i] = next;
      return copy;
    });
  }, []);

  /** Chain-derive one record; update UI + cache when status moved. */
  const deriveOne = useCallback(
    async (record: AskRecordDto): Promise<LiveAsk | null> => {
      const rpc = await getRpc();
      const d = await deriveStatusFromChain(rpc, record);
      const live: LiveAsk = {
        ...record,
        status: d.status,
        claimTxid: d.claimTxid ?? record.claimTxid,
        refundTxid: d.refundTxid ?? record.refundTxid,
        verification: d.verified ? "ok" : "failed",
        replyCiphertext: d.replyCiphertext,
        claimNetSompi: d.claimNetSompi,
        resolvedAtMs: d.resolvedAtMs,
      };
      if (!d.verified) return live; // never cache/surface unverified as real
      if (
        d.status !== record.status ||
        live.claimTxid !== record.claimTxid ||
        live.refundTxid !== record.refundTxid
      ) {
        void cacheAsk({
          ...record,
          status: live.status,
          claimTxid: live.claimTxid,
          refundTxid: live.refundTxid,
        }).catch(() => {});
      }
      return live;
    },
    [getRpc]
  );

  // Initial load + periodic re-derivation, both roles at once.
  useEffect(() => {
    if (!address) return;
    let stop = false;
    const loadAll = async () => {
      try {
        const cached = await fetchCachedAsks(address);
        const merged = new Map<string, AskRecordDto>();
        for (const r of [...cached.sent, ...cached.received]) {
          merged.set(r.askRef, r);
        }
        if (stop) return;
        setAsks(
          [...merged.values()].map((r) => ({
            ...r,
            verification: "pending" as const,
            replyCiphertext: null,
            claimNetSompi: null,
            resolvedAtMs: null,
          }))
        );
        setLoading(false);
        for (const r of merged.values()) {
          if (stop) return;
          try {
            const live = await deriveOne(r);
            if (live && !stop) upsertLocal(live);
          } catch {
            /* keep cached status for this row; next cycle retries */
          }
        }
      } catch (e) {
        if (!stop) {
          setError(String((e as Error)?.message ?? e));
          setLoading(false);
        }
      }
    };
    void loadAll();
    const id = setInterval(loadAll, RE_DERIVE_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [address, deriveOne, upsertLocal]);

  // App-wide firehose: incoming asks (recipient role) and incoming
  // replies (sender role), regardless of which screen is open.
  useEffect(() => {
    if (!address || rpcStatus !== "connected") return;
    let cleanup: (() => Promise<void>) | null = null;
    let stop = false;
    (async () => {
      const rpc = await getRpc();
      const { startAskScanner } = await import("./ask");
      if (stop) return;
      cleanup = startAskScanner(rpc, (parsed, txid) => {
        if (!parsed) return;
        if (parsed.kind === "ask" && parsed.envelope.recipient === address) {
          const env = parsed.envelope;
          // V2 announces minRefund with a FIXED allowance; V3 announces a
          // PER-ASK refundAllowance instead (F13). Both describe the same
          // locked amount, reached from opposite directions — so the
          // announced total must be derived per version, never assumed.
          const amountSompi =
            "amountSompi" in env
              ? env.amountSompi // V3 announces it explicitly
              : (BigInt(env.minRefund) + REFUND_FEE_ALLOWANCE).toString();
          const candidate: AskRecordDto = {
            askRef: txid,
            senderAddress: env.sender,
            recipientAddress: env.recipient,
            amountSompi,
            messageCiphertext: env.message,
            deadline: env.deadlineDaa,
            lockTxid: txid,
            claimTxid: null,
            refundTxid: null,
            status: "open",
          };
          void (async () => {
            try {
              const live = await deriveOne(candidate);
              if (live?.verification === "ok") {
                await cacheAsk(candidate).catch(() => {});
                upsertLocal(live);
              }
            } catch {
              /* verification failed — never surfaced */
            }
          })();
        }
        if (parsed.kind === "reply") {
          const ref = parsed.envelope.ref.toLowerCase();
          const message = parsed.envelope.message;
          setAsks((cur) =>
            cur.map((a) =>
              a.lockTxid.toLowerCase() === ref && a.senderAddress === address
                ? {
                    ...a,
                    status: "answered" as const,
                    claimTxid: txid,
                    replyCiphertext: message,
                    resolvedAtMs: Date.now(),
                  }
                : a
            )
          );
        }
      });
    })().catch(() => {});
    return () => {
      stop = true;
      void cleanup?.();
    };
  }, [address, rpcStatus, getRpc, deriveOne, upsertLocal]);

  // Normative rule 1 (§8): any aware client attempts the open refund once
  // a deadline passes — now app-wide, from either role.
  useEffect(() => {
    if (!address || daaScore === null) return;
    for (const ask of asks) {
      const pastDeadline = daaScore >= BigInt(ask.deadline);
      const closable =
        ask.status === "open" || ask.status === "expired_pending_refund";
      if (!pastDeadline || !closable) continue;
      if (refundAttempted.current.has(ask.askRef)) continue;
      refundAttempted.current.add(ask.askRef);
      void (async () => {
        try {
          const rpc = await getRpc();
          const refundTxid = await maybeAutoRefund(rpc, ask);
          const live = await deriveOne(ask);
          if (live) upsertLocal(refundTxid ? { ...live, refundTxid } : live);
        } catch {
          refundAttempted.current.delete(ask.askRef); // retry next cycle
        }
      })();
    }
  }, [asks, daaScore, address, getRpc, deriveOne, upsertLocal]);

  // Unread math (F8): inbox = incoming asks never seen at all; sent =
  // terminal states (answered/refunded) the user hasn't seen yet.
  const { unreadInbox, unreadSent } = useMemo(() => {
    if (!address) return { unreadInbox: 0, unreadSent: 0 };
    let inbox = 0;
    let sent = 0;
    for (const a of asks) {
      if (a.verification === "failed") continue;
      if (a.recipientAddress === address && seen[a.askRef] === undefined) {
        inbox++;
      }
      if (
        a.senderAddress === address &&
        (a.status === "answered" || a.status === "refunded") &&
        seen[a.askRef] !== a.status
      ) {
        sent++;
      }
    }
    return { unreadInbox: inbox, unreadSent: sent };
  }, [asks, seen, address]);

  const markSeen = useCallback(
    (role: "sender" | "recipient") => {
      if (!address) return;
      setSeen((cur) => {
        const next = { ...cur };
        let changed = false;
        for (const a of asks) {
          const mine =
            role === "sender"
              ? a.senderAddress === address
              : a.recipientAddress === address;
          if (!mine) continue;
          if (next[a.askRef] !== a.status) {
            next[a.askRef] = a.status;
            changed = true;
          }
        }
        if (changed) window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
        return changed ? next : cur;
      });
    },
    [asks, address]
  );

  // Chain-derived Earned total. Display nuance: derivation takes a few
  // seconds after a reload (REST lookups), and a proof-of-earnings surface
  // must not flash 0 in the meantime — so the last chain-derived value is
  // kept per-address in localStorage and shown until fresh derivation
  // replaces it. The chain remains the only WRITER of this value.
  const [seedEarned, setSeedEarned] = useState<bigint>(0n);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    queueMicrotask(() => {
      try {
        const v = window.localStorage.getItem(`kaskly.earned.v1.${address}`);
        if (!cancelled && v) setSeedEarned(BigInt(v));
      } catch {
        /* corrupted seed — chain derivation will supply it */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const earnedSompi = useMemo(() => {
    if (!address) return 0n;
    let sum = 0n;
    let anyDerived = false;
    for (const a of asks) {
      if (
        a.recipientAddress === address &&
        a.status === "answered" &&
        a.verification !== "failed" &&
        a.claimNetSompi
      ) {
        sum += BigInt(a.claimNetSompi);
        anyDerived = true;
      }
    }
    return anyDerived || sum > seedEarned ? sum : seedEarned;
  }, [asks, address, seedEarned]);

  useEffect(() => {
    if (!address || earnedSompi === 0n) return;
    window.localStorage.setItem(
      `kaskly.earned.v1.${address}`,
      earnedSompi.toString()
    );
  }, [address, earnedSompi]);

  // Background-tab awareness: unread count in the document title.
  useEffect(() => {
    const total = unreadInbox + unreadSent;
    document.title = total > 0 ? `(${total}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unreadInbox, unreadSent]);

  return (
    <ActivityContext.Provider
      value={{
        asks,
        loading,
        error,
        upsertLocal,
        unreadInbox,
        unreadSent,
        markSeen,
        earnedSompi,
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity outside ActivityProvider");
  return ctx;
}
