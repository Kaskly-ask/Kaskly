"use client";
// S3 SENT (brief §3.2): sent Asks with live status [awaiting reply |
// answered (+ the reply) | refunded], countdown, and explorer links for
// every referenced transaction (C4). The auto-refund rule (§8 rule 1) runs
// from useAsks; this screen shows its effects honestly.
import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useChain } from "@/lib/chain";
import { useAsks, type LiveAsk } from "@/lib/use-asks";
import { useDecrypted } from "@/lib/use-decrypted";
import { getNote } from "@/lib/local-notes";
import { cacheAsk, clearCache } from "@/lib/asks-client";
import {
  AskCard,
  CollapsibleText,
  ExplorerLink,
  HiddenSection,
} from "@/components/ask-card";
import { useHidden } from "@/lib/use-hidden";

function SentItem({
  ask,
  daaScore,
  hideAction,
}: {
  ask: LiveAsk;
  daaScore: bigint | null;
  /** F9 v1: pages pass this ONLY for settled cards (never while open). */
  hideAction?: React.ReactNode;
}) {
  // The on-chain message is encrypted to the RECIPIENT; the sender's own
  // plaintext comes from the local note written at compose time.
  const message = getNote(ask.askRef, "message");
  const replyText = useDecrypted(ask.replyCiphertext);

  return (
    <AskCard
      message={message}
      amountSompi={ask.amountSompi}
      counterpartyLabel="to"
      counterpartyAddress={ask.recipientAddress}
      deadline={ask.deadline}
      daaScore={daaScore}
      status={ask.status}
      footer={
        <>
          <ExplorerLink txid={ask.lockTxid} label="lock" />
          {ask.claimTxid && <ExplorerLink txid={ask.claimTxid} label="reply" />}
          {ask.refundTxid && <ExplorerLink txid={ask.refundTxid} label="refund" />}
          {hideAction}
        </>
      }
    >
      {ask.status === "answered" && (
        <div className="bg-card-raised rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs text-teal">They replied — the KAS is theirs:</p>
          {replyText !== null ? (
            <CollapsibleText
              text={replyText}
              className="text-[15px] leading-relaxed"
            />
          ) : (
            <p className="text-faint italic text-[15px]">decrypting reply…</p>
          )}
        </div>
      )}
      {ask.status === "expired_pending_refund" && (
        <p className="text-sm text-warn bg-card-raised rounded-lg px-4 py-3">
          No reply before the deadline. Broadcasting your refund — anyone can
          trigger it, and it can only pay you.
        </p>
      )}
      {ask.status === "refunded" && (
        <p className="text-sm text-muted bg-card-raised rounded-lg px-4 py-3">
          No reply came. Every sompi is back in your wallet.
        </p>
      )}
    </AskCard>
  );
}

function RebuildButton() {
  const { wallet } = useWallet();
  const { getRpc } = useChain();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [detail, setDetail] = useState("");

  const run = async () => {
    if (!wallet) return;
    setState("running");
    try {
      // §3.3 demonstration: drop the cache, then reconstruct it purely
      // from chain state. The page reload shows only what the chain says.
      const rpc = await getRpc();
      const { rebuildFromChain } = await import("@/lib/rebuild");
      await clearCache();
      const records = await rebuildFromChain(rpc, wallet.address);
      for (const r of records) await cacheAsk(r);
      setDetail(`${records.length} ask(s) reconstructed from chain`);
      setState("done");
      window.location.reload();
    } catch (e) {
      setDetail(String((e as Error)?.message ?? e));
      setState("error");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={state === "running" || !wallet}
        className="text-xs text-faint hover:text-teal underline decoration-dotted disabled:opacity-50"
        title="Drops the local cache and reconstructs every record from public chain data — the DB is disposable by design."
      >
        {state === "running" ? "rebuilding from chain…" : "rebuild from chain"}
      </button>
      {state === "error" && <span className="text-xs text-danger">{detail}</span>}
    </span>
  );
}

export default function SentPage() {
  const { wallet, status } = useWallet();
  const { asks, loading, error, daaScore } = useAsks("sender");
  const { hidden, hide, unhide } = useHidden();
  const active = asks.filter((a) => !hidden.has(a.askRef));
  const hiddenAsks = asks.filter((a) => hidden.has(a.askRef));
  // F9 v1 rule: only settled cards may be hidden.
  const settled = (a: LiveAsk) => a.status !== "open";

  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Sent</h1>
        <RebuildButton />
      </div>
      {status === "disconnected" && (
        <p className="text-warn text-sm border border-warn/30 rounded-lg px-4 py-3">
          Connect a wallet (top right) to see your sent Asks.
        </p>
      )}
      {wallet && loading && <p className="text-muted text-sm">Loading…</p>}
      {error && <p className="text-danger text-sm">{error}</p>}
      {wallet && !loading && asks.length === 0 && (
        <p className="text-muted text-sm">
          Nothing sent yet —{" "}
          <Link href="/" className="text-teal hover:underline">
            ask someone
          </Link>
          .
        </p>
      )}
      <div className="space-y-4">
        {active.map((a) => (
          <SentItem
            key={a.askRef}
            ask={a}
            daaScore={daaScore}
            hideAction={
              settled(a) ? (
                <button
                  onClick={() => hide(a.askRef)}
                  className="text-xs text-faint hover:text-muted underline decoration-dotted"
                >
                  hide
                </button>
              ) : undefined
            }
          />
        ))}
      </div>
      <HiddenSection count={hiddenAsks.length}>
        {hiddenAsks.map((a) => (
          <SentItem
            key={a.askRef}
            ask={a}
            daaScore={daaScore}
            hideAction={
              <button
                onClick={() => unhide(a.askRef)}
                className="text-xs text-teal hover:underline decoration-dotted"
              >
                unhide
              </button>
            }
          />
        ))}
      </HiddenSection>
    </section>
  );
}
