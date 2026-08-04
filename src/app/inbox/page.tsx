"use client";
// S2 INBOX (brief §3.2): Asks addressed to the connected wallet — message,
// amount, countdown; opening one shows the reply box, and SENDING THE REPLY
// IS CLAIMING THE MONEY (A3). Only §4-verified announcements appear here.
// Normative rule 2 (§8): once the deadline passes, this screen refuses to
// construct a claim and shows the clean "deadline passed" state instead.
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useAsks, type LiveAsk } from "@/lib/use-asks";
import {
  claimAsk,
  estimateReplyClaim,
  DeadlinePassedError,
} from "@/lib/asks-client";
import { useChain } from "@/lib/chain";
import { useDecrypted } from "@/lib/use-decrypted";
import { getNote, setNote } from "@/lib/local-notes";
import { formatKas } from "@/lib/config";
import {
  AskCard,
  CollapsibleText,
  ExplorerLink,
  HiddenSection,
} from "@/components/ask-card";
import { useHidden } from "@/lib/use-hidden";
import { MAX_MESSAGE_BYTES, messageByteLength } from "@/lib/ask/protocol";

/** Debounced mass-based fee/net quote for the current reply draft (F7). */
function useClaimQuote(ask: LiveAsk, reply: string, enabled: boolean) {
  const [quote, setQuote] = useState<{
    key: string;
    fee: bigint;
    net: bigint;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !reply.trim()) return;
    const id = setTimeout(() => {
      estimateReplyClaim(ask, reply)
        .then(({ fee, net }) => setQuote({ key: reply, fee, net }))
        .catch(() => {
          /* keep last quote; button falls back to gross amount */
        });
    }, 350);
    return () => clearTimeout(id);
  }, [ask, reply, enabled]);

  return quote?.key === reply ? quote : null;
}

function InboxItem({
  ask,
  daaScore,
  onChanged,
  hideAction,
}: {
  ask: LiveAsk;
  daaScore: bigint | null;
  onChanged: (a: LiveAsk) => void;
  /** F9 v1: pages pass this ONLY for settled cards (never while open). */
  hideAction?: React.ReactNode;
}) {
  const { wallet } = useWallet();
  const { getRpc } = useChain();
  const message = useDecrypted(ask.messageCiphertext);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pastDeadline = daaScore !== null && daaScore >= BigInt(ask.deadline);
  const myReply = getNote(ask.askRef, "reply");
  const replyBytes = messageByteLength(reply);
  const overLimit = replyBytes > MAX_MESSAGE_BYTES;
  const quote = useClaimQuote(ask, reply, ask.status === "open" && !overLimit);

  const sendReply = async () => {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const rpc = await getRpc();
      const { claimTxid, net } = await claimAsk(rpc, ask, wallet.privateKey, reply);
      setNote(ask.askRef, "reply", reply);
      // Feeds the Earned widget tick-up + the "answered just now" state.
      onChanged({
        ...ask,
        status: "answered",
        claimTxid,
        claimNetSompi: net.toString(),
        resolvedAtMs: Date.now(),
      });
      setReply("");
    } catch (e) {
      setError(
        e instanceof DeadlinePassedError
          ? "deadline passed — funds have been returned to the sender"
          : String((e as Error)?.message ?? e)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AskCard
      message={message}
      amountSompi={ask.amountSompi}
      counterpartyLabel="from"
      counterpartyAddress={ask.senderAddress}
      deadline={ask.deadline}
      daaScore={daaScore}
      status={ask.status}
      resolvedAtMs={ask.resolvedAtMs}
      badge={
        ask.verification === "ok" ? (
          <span
            className="text-[10px] tracking-wide text-teal border border-teal/30 rounded px-1.5 py-0.5"
            title="Verified on-chain: the announced sender, amount and deadline reproduce exactly the escrow address this Ask funded (ASKSPEC §4). The money is really there, under the covenant's rules."
          >
            ✓ escrowed
          </span>
        ) : (
          <span className="text-[10px] text-faint italic">
            verifying escrow…
          </span>
        )
      }
      footer={
        <>
          <ExplorerLink txid={ask.lockTxid} label="lock" />
          {ask.claimTxid && <ExplorerLink txid={ask.claimTxid} label="your reply" />}
          {ask.refundTxid && <ExplorerLink txid={ask.refundTxid} label="refund" />}
          {hideAction}
        </>
      }
    >
      {ask.status === "answered" && (
        <div className="bg-card-raised rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs text-teal">
            You replied and claimed {formatKas(BigInt(ask.amountSompi))} TKAS.
          </p>
          {myReply && (
            <CollapsibleText text={myReply} className="text-sm text-muted" />
          )}
        </div>
      )}

      {(ask.status === "refunded" ||
        ask.status === "expired_pending_refund" ||
        (ask.status === "open" && pastDeadline)) && (
        <p className="text-sm text-warn bg-card-raised rounded-lg px-4 py-3">
          Deadline passed — funds {ask.status === "refunded" ? "have been" : "are being"}{" "}
          returned to the sender. Replying is no longer possible.
        </p>
      )}

      {ask.status === "open" && !pastDeadline && (
        <div className="space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Type your reply…"
            className={`w-full bg-card-raised border rounded-md px-3 py-2 text-[15px] leading-relaxed focus:outline-none resize-y ${
              overLimit
                ? "border-danger/60 focus:border-danger"
                : "border-border focus:border-teal/50"
            }`}
          />
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={`text-xs amount ${overLimit ? "text-danger" : "text-faint"}`}
            >
              {replyBytes.toLocaleString()} / {MAX_MESSAGE_BYTES.toLocaleString()}
            </span>
            {overLimit && (
              <span className="text-xs text-danger">
                Reply too long — max ~{MAX_MESSAGE_BYTES.toLocaleString()}{" "}
                characters (less with emoji or accented text)
              </span>
            )}
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              disabled={busy || !reply.trim() || overLimit}
              onClick={sendReply}
              className="px-4 py-2 rounded-md bg-teal text-background font-semibold text-sm disabled:opacity-40"
            >
              {busy
                ? "Claiming…"
                : `Reply & claim ${quote ? `~${formatKas(quote.net)}` : formatKas(BigInt(ask.amountSompi))} TKAS`}
            </button>
            <span className="text-xs text-faint">
              {quote
                ? `Network fee ~${formatKas(quote.fee)} TKAS comes out of the claim. `
                : ""}
              Your reply is encrypted — only the sender can read it. Sending
              it claims the money in the same transaction.
            </span>
          </div>
        </div>
      )}
    </AskCard>
  );
}

export default function InboxPage() {
  const { wallet, status } = useWallet();
  const { asks, loading, error, daaScore, upsertLocal } = useAsks("recipient");
  const { hidden, hide, unhide } = useHidden();
  // "failed" rows are never surfaced (§4); "pending" rows show with the
  // verifying indicator until the chain settles them.
  const visible = asks.filter((a) => a.verification !== "failed");
  const active = visible.filter((a) => !hidden.has(a.askRef));
  const hiddenAsks = visible.filter((a) => hidden.has(a.askRef));
  // F9 v1 rule: only settled cards may be hidden — open Asks hold
  // claimable money and get no affordance at all.
  const settled = (a: LiveAsk) => a.status !== "open";

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      {status === "disconnected" && (
        <p className="text-warn text-sm border border-warn/30 rounded-lg px-4 py-3">
          Connect a wallet (top right) to see Asks addressed to you.
        </p>
      )}
      {wallet && loading && <p className="text-muted text-sm">Loading…</p>}
      {error && <p className="text-danger text-sm">{error}</p>}
      {wallet && !loading && visible.length === 0 && (
        <p className="text-muted text-sm">
          No Asks yet. New ones appear here automatically while this tab is
          open — leave it running to listen.
        </p>
      )}
      <div className="space-y-4">
        {active.map((a) => (
          <InboxItem
            key={a.askRef}
            ask={a}
            daaScore={daaScore}
            onChanged={upsertLocal}
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
          <InboxItem
            key={a.askRef}
            ask={a}
            daaScore={daaScore}
            onChanged={upsertLocal}
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
