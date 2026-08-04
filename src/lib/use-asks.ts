"use client";
// Shared live-ask state for the INBOX (S2) and SENT (S3) screens.
// Responsibilities:
//   - load cached records, then RE-DERIVE every status from chain state
//     (the cache is never trusted over the chain, brief §3.3);
//   - live discovery via the block firehose (ASKSPEC §7): incoming asks
//     for the recipient, incoming replies for the sender;
//   - §4 verification: an announcement only becomes an inbox item if its
//     parameters reproduce the funded P2SH (deriveStatusFromChain);
//   - normative rule 1 (§8): once the deadline passes, ATTEMPT the
//     anyone-can-trigger refund — from both roles' clients.
import { useCallback, useEffect, useRef, useState } from "react";
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
}

const RE_DERIVE_MS = 45_000;

export function useAsks(role: "sender" | "recipient") {
  const { wallet } = useWallet();
  const { getRpc, rpcStatus, daaScore } = useChain();
  const [asks, setAsks] = useState<LiveAsk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-session sets: asks we already tried to refund / are deriving.
  const refundAttempted = useRef<Set<string>>(new Set());
  const address = wallet?.address ?? null;

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
      };
      if (!d.verified) return live; // never cache/surface unverified as real
      if (
        d.status !== record.status ||
        live.claimTxid !== record.claimTxid ||
        live.refundTxid !== record.refundTxid
      ) {
        void cacheAsk({ ...record, status: live.status, claimTxid: live.claimTxid, refundTxid: live.refundTxid }).catch(() => {});
      }
      return live;
    },
    [getRpc]
  );

  // Initial load + periodic re-derivation.
  useEffect(() => {
    if (!address) return;
    let stop = false;
    const loadAll = async () => {
      try {
        const cached = await fetchCachedAsks(address);
        const mine = role === "sender" ? cached.sent : cached.received;
        if (stop) return;
        // Show cached rows immediately as "pending" (they were §4-verified
        // when first cached), then settle each against the chain.
        setAsks(
          mine.map((r) => ({
            ...r,
            verification: "pending" as const,
            replyCiphertext: null,
          }))
        );
        setLoading(false);
        for (const r of mine) {
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
  }, [address, role, deriveOne, upsertLocal]);

  // Live firehose discovery (needs an established connection).
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
        if (
          role === "recipient" &&
          parsed.kind === "ask" &&
          parsed.envelope.recipient === address
        ) {
          // Build a candidate record from the announcement, then §4-verify
          // against the chain before it may appear as an inbox item.
          const env = parsed.envelope;
          const candidate: AskRecordDto = {
            askRef: txid,
            senderAddress: env.sender,
            recipientAddress: env.recipient,
            amountSompi: (
              BigInt(env.minRefund) + REFUND_FEE_ALLOWANCE
            ).toString(),
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
        if (role === "sender" && parsed.kind === "reply") {
          const ref = parsed.envelope.ref.toLowerCase();
          const message = parsed.envelope.message;
          setAsks((cur) =>
            cur.map((a) =>
              a.lockTxid.toLowerCase() === ref
                ? {
                    ...a,
                    status: "answered",
                    claimTxid: txid,
                    replyCiphertext: message,
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
  }, [address, role, rpcStatus, getRpc, deriveOne, upsertLocal]);

  // Normative rule 1: attempt the open refund when a deadline has passed.
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

  return { asks, loading, error, daaScore, refresh: deriveOne, upsertLocal };
}
