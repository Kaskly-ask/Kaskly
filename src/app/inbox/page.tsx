"use client";
// S2 INBOX (brief §3.2): Asks addressed to the connected wallet — message,
// amount, countdown; opening one shows the reply box, and SENDING THE REPLY
// IS CLAIMING THE MONEY (A3). Only §4-verified announcements appear here.
// Normative rule 2 (§8): once the deadline passes, this screen refuses to
// construct a claim and shows the clean "deadline passed" state instead.
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useAsks, type LiveAsk } from "@/lib/use-asks";
import { claimAsk, DeadlinePassedError } from "@/lib/asks-client";
import { useChain } from "@/lib/chain";
import { useDecrypted } from "@/lib/use-decrypted";
import { getNote, setNote } from "@/lib/local-notes";
import { formatKas } from "@/lib/config";
import { AskCard, ExplorerLink } from "@/components/ask-card";
import { MAX_MESSAGE_CHARS } from "@/lib/ask/protocol";

function InboxItem({
  ask,
  daaScore,
  onChanged,
}: {
  ask: LiveAsk;
  daaScore: bigint | null;
  onChanged: (a: LiveAsk) => void;
}) {
  const { wallet } = useWallet();
  const { getRpc } = useChain();
  const message = useDecrypted(ask.messageCiphertext);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pastDeadline = daaScore !== null && daaScore >= BigInt(ask.deadline);
  const myReply = getNote(ask.askRef, "reply");

  const sendReply = async () => {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const rpc = await getRpc();
      const claimTxid = await claimAsk(rpc, ask, wallet.privateKey, reply);
      setNote(ask.askRef, "reply", reply);
      onChanged({ ...ask, status: "answered", claimTxid });
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
      footer={
        <>
          <ExplorerLink txid={ask.lockTxid} label="lock" />
          {ask.claimTxid && <ExplorerLink txid={ask.claimTxid} label="your reply" />}
          {ask.refundTxid && <ExplorerLink txid={ask.refundTxid} label="refund" />}
        </>
      }
    >
      {ask.status === "answered" && (
        <div className="bg-card-raised rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs text-teal">
            You replied and claimed {formatKas(BigInt(ask.amountSompi))} TKAS.
          </p>
          {myReply && (
            <p className="whitespace-pre-wrap break-words text-sm text-muted">
              {myReply}
            </p>
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
            onChange={(e) => setReply(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            rows={3}
            placeholder="Type your reply…"
            className="w-full bg-card-raised border border-border rounded-md px-3 py-2 text-[15px] leading-relaxed focus:border-teal/50 focus:outline-none resize-y"
          />
          {error && <p className="text-danger text-sm">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              disabled={busy || !reply.trim()}
              onClick={sendReply}
              className="px-4 py-2 rounded-md bg-teal text-background font-semibold text-sm disabled:opacity-40"
            >
              {busy
                ? "Claiming…"
                : `Reply & claim ${formatKas(BigInt(ask.amountSompi))} TKAS`}
            </button>
            <span className="text-xs text-faint">
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
  const visible = asks.filter((a) => a.verified);

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
        {visible.map((a) => (
          <InboxItem
            key={a.askRef}
            ask={a}
            daaScore={daaScore}
            onChanged={upsertLocal}
          />
        ))}
      </div>
    </section>
  );
}
