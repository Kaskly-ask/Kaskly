"use client";
// S1 COMPOSE (brief §3.2): recipient (address or .kas), message, amount,
// deadline picker (7-day default), TESTNET badge in header, honesty line
// sourced from TRUST.md. There is deliberately no fee line (D2).
import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { useChain } from "@/lib/chain";
import { sendAsk } from "@/lib/asks-client";
import { isKnsName, resolveKns } from "@/lib/kns";
import { setNote } from "@/lib/local-notes";
import { DAA_PER_SECOND, parseKas } from "@/lib/config";
import { ExplorerLink } from "@/components/ask-card";
import { MAX_MESSAGE_CHARS } from "@/lib/ask/protocol";

const DEADLINE_CHOICES = [
  { label: "1 hour", seconds: 3600n },
  { label: "24 hours", seconds: 86400n },
  { label: "3 days", seconds: 259200n },
  { label: "7 days", seconds: 604800n },
  { label: "14 days", seconds: 1209600n },
] as const;
const DEFAULT_DEADLINE = 3; // 7 days (D9 default)

export default function ComposePage() {
  const { wallet, status: walletStatus } = useWallet();
  const { getRpc } = useChain();
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [deadlineIdx, setDeadlineIdx] = useState(DEFAULT_DEADLINE);
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sentTxid, setSentTxid] = useState<string | null>(null);

  const send = async () => {
    if (!wallet) return;
    setPhase("sending");
    setError(null);
    try {
      const amountSompi = parseKas(amount);
      let recipientAddress = recipient.trim();
      if (isKnsName(recipientAddress)) {
        const resolved = await resolveKns(recipientAddress.toLowerCase());
        if (!resolved) throw new Error(`${recipientAddress} is not registered`);
        recipientAddress = resolved;
      }
      if (recipientAddress === wallet.address) {
        throw new Error("that is your own address");
      }
      const rpc = await getRpc();
      const { currentDaaScore } = await import("@/lib/ask");
      const daa = await currentDaaScore(rpc);
      const deadlineDaa =
        daa + DEADLINE_CHOICES[deadlineIdx].seconds * DAA_PER_SECOND;
      const record = await sendAsk(rpc, {
        senderAddress: wallet.address,
        senderPrivateKeyHex: wallet.privateKey,
        recipientAddress,
        amountSompi,
        message,
        deadlineDaa,
      });
      // The chain copy is encrypted to the recipient — keep the author's
      // plaintext locally so Sent can display it (never server-side).
      setNote(record.askRef, "message", message);
      setSentTxid(record.lockTxid);
      setPhase("done");
      setMessage("");
      setAmount("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setPhase("idle");
    }
  };

  if (phase === "done" && sentTxid) {
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Ask sent</h1>
        <p className="text-muted text-sm leading-relaxed">
          Your KAS is locked to the message. A reply claims it; if the
          deadline passes silently, every cent comes back to you.
        </p>
        <div className="flex items-center gap-4">
          <ExplorerLink txid={sentTxid} label="lock transaction" />
          <Link href="/sent" className="text-sm text-teal hover:underline">
            Track it in Sent →
          </Link>
        </div>
        <button
          onClick={() => setPhase("idle")}
          className="text-sm text-muted hover:text-foreground underline"
        >
          Ask someone else
        </button>
      </section>
    );
  }

  const disabled =
    phase === "sending" ||
    !wallet ||
    !recipient.trim() ||
    !message.trim() ||
    !amount.trim();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask someone</h1>
        <p className="text-muted text-sm mt-1">
          Attach KAS to a message. They reply, they get it. They don&apos;t,
          you get every cent back.
        </p>
      </div>

      {walletStatus === "disconnected" && (
        <p className="text-warn text-sm border border-warn/30 rounded-lg px-4 py-3">
          Connect a wallet (top right) to send an Ask.
        </p>
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">To — Kaspa address or .kas name</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="kaspatest:… or a .kas name (like kaskly.kas)"
            className="w-full bg-card-raised border border-border rounded-md px-3 py-2 font-mono text-sm focus:border-teal/50 focus:outline-none"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">
            Your message{" "}
            <span className="text-faint">
              ({message.length.toLocaleString()}/{MAX_MESSAGE_CHARS.toLocaleString()},
              encrypted — only the recipient can read it)
            </span>
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            rows={5}
            placeholder="What do you want to ask?"
            className="w-full bg-card-raised border border-border rounded-md px-3 py-2 text-[15px] leading-relaxed focus:border-teal/50 focus:outline-none resize-y"
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="space-y-1.5">
            <span className="text-xs text-muted block">Amount (TKAS)</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1.0"
              inputMode="decimal"
              className="w-36 bg-card-raised border border-border rounded-md px-3 py-2 amount text-sm focus:border-teal/50 focus:outline-none"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted block">
              Reply deadline — silence refunds you
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {DEADLINE_CHOICES.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setDeadlineIdx(i)}
                  className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                    i === deadlineIdx
                      ? "border-teal/60 text-teal bg-teal/10"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </label>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <button
          disabled={disabled}
          onClick={send}
          className="px-4 py-2 rounded-md bg-teal text-background font-semibold text-sm disabled:opacity-40"
        >
          {phase === "sending" ? "Locking funds…" : "Send Ask"}
        </button>

        {/* Honesty line — mirrors TRUST.md; what the chain actually enforces. */}
        <p className="text-xs text-faint leading-relaxed pt-1 border-t border-border/60">
          Enforced on-chain: only the recipient can claim, and only with a
          transaction that carries a reply. After the deadline, the refund
          needs nobody&apos;s permission and can only pay you back — a reply,
          or your money back; late replies lose to the refund. No protocol
          fees, ever. Message text is encrypted; addresses, amount and
          deadline are public on-chain.
        </p>
      </div>
    </section>
  );
}
