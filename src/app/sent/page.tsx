"use client";
// S3 SENT (brief §3.2): sent Asks with live status [awaiting reply |
// answered (+ the reply) | refunded], countdown, and explorer links for
// every referenced transaction (C4). The auto-refund rule (§8 rule 1) runs
// from useAsks; this screen shows its effects honestly.
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { useAsks, type LiveAsk } from "@/lib/use-asks";
import { useDecrypted } from "@/lib/use-decrypted";
import { getNote } from "@/lib/local-notes";
import { AskCard, ExplorerLink } from "@/components/ask-card";

function SentItem({ ask, daaScore }: { ask: LiveAsk; daaScore: bigint | null }) {
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
        </>
      }
    >
      {ask.status === "answered" && (
        <div className="bg-card-raised rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs text-teal">They replied — the KAS is theirs:</p>
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
            {replyText ?? (
              <span className="text-faint italic">decrypting reply…</span>
            )}
          </p>
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

export default function SentPage() {
  const { wallet, status } = useWallet();
  const { asks, loading, error, daaScore } = useAsks("sender");

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Sent</h1>
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
        {asks.map((a) => (
          <SentItem key={a.askRef} ask={a} daaScore={daaScore} />
        ))}
      </div>
    </section>
  );
}
