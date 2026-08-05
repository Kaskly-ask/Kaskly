"use client";
// The Ask card — the hero object (brief §5): message-first, amount as a
// bold tabular figure, countdown always visible. Message/reply text renders
// through React text nodes only (XSS-inert by construction — never
// dangerouslySetInnerHTML).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DAA_PER_SECOND, explorerTxUrl, formatKas } from "@/lib/config";
import type { AskStatus } from "@/lib/ask-record";
import { ContactName } from "./contact-name";

/** Long text collapses to ~3 lines with an expander (F9: one huge card
 * must not destroy list scannability). Heuristic trigger — CSS clamps the
 * actual rendering. */
export function CollapsibleText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible =
    text.length > 280 || (text.match(/\n/g)?.length ?? 0) >= 3;
  return (
    <div className="min-w-0">
      <p
        className={`whitespace-pre-wrap break-words ${className} ${
          collapsible && !expanded ? "line-clamp-3" : ""
        }`}
      >
        {text}
      </p>
      {collapsible && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-teal hover:underline mt-1"
        >
          {expanded ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}

/** Displayed times are ESTIMATES over a DAA-denominated deadline (the
 * chain counts DAA score, ~10/s — ASKSPEC §8); small drift against real
 * block pace is expected. Display smoothing (post-tag queue item 3): the
 * countdown ticks locally at 1/s; when the chain clock resyncs, small
 * corrections are absorbed by pausing (upward drift) or double-stepping
 * (downward drift) rather than jumping the number — only drift beyond 60s
 * resyncs visibly. (Docblock for `Countdown`, below — the viewer types
 * and helpers between here and it were added for the deadline treatment.)
 */

/** Whose card this is. The deadline means OPPOSITE things to the two
 * sides, so it cannot look the same to both:
 *
 *   recipient — the window to earn is closing. Mild, fair urgency.
 *   asker     — the refund is arriving. "A reply or your money back" is the
 *               promise; the deadline is the half that keeps it. Nothing is
 *               being lost, so nothing may look like loss.
 */
export type CardViewer = "recipient" | "asker";

/** How long before the deadline the card starts changing temperature.
 * Beyond this it sits at rest — a 7-day Ask should not spend six days
 * looking like it is about to do something. */
const APPROACH_WINDOW_SECS = 48 * 60 * 60;

/** 0 while the deadline is far away, easing to 1 as it arrives. */
function approachHeat(remainingSecs: number | null): number {
  if (remainingSecs === null) return 0;
  if (remainingSecs <= 0) return 1;
  const linear = 1 - Math.min(1, remainingSecs / APPROACH_WINDOW_SECS);
  // Ease-in: the last hours move far more than the first, so the change is
  // felt when it matters instead of being a slow constant drift.
  return linear * linear;
}

/** The rail colour for a given side and heat.
 *
 * THE AXIS IS BRIGHTNESS, NOT HUE — and that is a correction. The first
 * version moved the recipient's card toward `--warn`, which is wrong for
 * the same reason it is wrong for the asker: amber is this palette's
 * WARNING colour. An approaching deadline is not a fault in the Ask. To
 * the recipient it is an opportunity closing ("you can still claim this"),
 * and dressing that as a warning would say "something is broken here".
 *
 * So both sides start at teal and separate along LIGHT:
 *
 *   recipient -> --foreground. The card lights up. Louder, not alarmed.
 *   asker     -> --cool (blue-slate). The card settles. Quieter, at rest.
 *
 * Attention without alarm for one, calm for the other, and neither borrows
 * a meaning the palette already spends on real warnings.
 */
function railColor(viewer: CardViewer, heat: number): string {
  const pct = Math.round((1 - heat) * 100);
  const target = viewer === "asker" ? "var(--cool)" : "var(--foreground)";
  return `color-mix(in oklab, var(--teal) ${pct}%, ${target})`;
}

/** Only the recipient's card glows, and only late. Brightness is the
 * urgency signal; the asker's card must never gain presence as its
 * deadline nears, because for them nothing is at stake. */
function railGlow(viewer: CardViewer, heat: number): string | undefined {
  if (viewer === "asker" || heat < 0.45) return undefined;
  const alpha = Math.round((heat - 0.45) * 60); // 0 -> ~33%
  return `color-mix(in oklab, var(--teal) ${alpha}%, transparent)`;
}

export function Countdown({
  deadline,
  daaScore,
  viewer = "recipient",
  onRemaining,
}: {
  deadline: string;
  daaScore: bigint | null;
  viewer?: CardViewer;
  /** Lifts the ticking value to the card so the rail can use it. */
  onRemaining?: (secs: number | null) => void;
}) {
  const [displaySecs, setDisplaySecs] = useState<number | null>(null);
  const targetRef = useRef<number | null>(null);

  useEffect(() => {
    if (daaScore === null) return;
    const remainingDaa = BigInt(deadline) - daaScore;
    const target = remainingDaa <= 0n ? 0 : Number(remainingDaa / DAA_PER_SECOND);
    targetRef.current = target;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDisplaySecs((cur) => {
        if (cur === null) return target; // first sync
        if (target === 0) return 0; // deadline passed — never smoothed
        if (Math.abs(target - cur) > 60) return target; // visible resync
        return cur; // small drift — absorbed by the tick below
      });
    });
    return () => {
      cancelled = true;
    };
  }, [daaScore, deadline]);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplaySecs((cur) => {
        if (cur === null || cur <= 0) return cur;
        const target = targetRef.current ?? cur;
        const drift = target - cur;
        if (drift > 2) return cur; // clock gained on us — hold, don't tick up
        if (drift < -2) return Math.max(0, cur - 2); // catch down gently
        return cur - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Report upward so the card can colour its rail from the same value the
  // user is reading — one source of truth for "how close is this".
  useEffect(() => {
    onRemaining?.(displaySecs);
  }, [displaySecs, onRemaining]);

  if (displaySecs === null) {
    return <span className="text-faint text-xs">countdown syncing…</span>;
  }
  if (displaySecs <= 0) {
    // Same instant, two meanings. For the asker this is the refund
    // arriving — the promise being kept — so it must not wear the warning
    // colour or the word "passed".
    return viewer === "asker" ? (
      <span className="text-cool text-xs">refund due</span>
    ) : (
      <span className="text-warn text-xs">deadline passed</span>
    );
  }
  const secs = displaySecs;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const text =
    d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  // "2h left" is a loss frame; the asker is not losing anything, so their
  // clock counts toward the refund instead of away from the reply.
  const heat = approachHeat(secs);
  // Recipient brightens toward full foreground (louder); asker settles to
  // slate (quieter). Neither uses --warn: nothing is wrong while a
  // deadline is merely approaching.
  const tone =
    viewer === "asker"
      ? heat > 0.5
        ? "text-cool"
        : "text-teal"
      : heat > 0.5
        ? "text-foreground"
        : "text-teal";
  return (
    <span
      className={`${tone} text-xs amount transition-colors duration-700`}
      title={`Estimated from the DAA-score deadline (${deadline}); the chain counts blocks, not clocks.`}
    >
      {viewer === "asker" ? `refunds in ${text}` : `${text} left`}
    </span>
  );
}

/** Resolution-relative time for settled cards (F10): terminal states take
 * absolute precedence — no countdown ever ticks on an answered/refunded
 * card. Freshness comes from the parent's regular re-renders (DAA poll). */
export function ResolvedAgo({ resolvedAtMs }: { resolvedAtMs: number | null }) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    queueMicrotask(tick);
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  if (resolvedAtMs === null || nowMs === null) return null;
  const secs = Math.max(0, Math.floor((nowMs - resolvedAtMs) / 1000));
  const text =
    secs < 60
      ? "just now"
      : secs < 3600
        ? `${Math.floor(secs / 60)}m ago`
        : secs < 86400
          ? `${Math.floor(secs / 3600)}h ago`
          : `${Math.floor(secs / 86400)}d ago`;
  return (
    <span
      className="text-muted text-xs amount"
      // Deliberately NOT locale-pinned, unlike the byte-limit numbers. This
      // is a timestamp shown to the reader, so their locale is the correct
      // one; and it cannot cause a hydration mismatch because this
      // component returns null until an effect sets `nowMs`, so it never
      // server-renders.
      title={new Date(resolvedAtMs).toLocaleString()}
    >
      {text}
    </span>
  );
}

const STATUS_LABELS: Record<AskStatus, { label: string; cls: string }> = {
  open: { label: "awaiting reply", cls: "text-teal border-teal/30" },
  answered: { label: "answered", cls: "text-teal border-teal/60 bg-teal/10" },
  refunded: { label: "refunded", cls: "text-muted border-border" },
  expired_pending_refund: {
    label: "expired — refund pending",
    cls: "text-warn border-warn/40",
  },
  // F14: the money moved to the recipient, but the reply could not be
  // read. Never render this as "refunded" — that was the bug.
  claimed_unreadable: {
    label: "claimed — reply unreadable",
    cls: "text-warn border-warn/60 bg-warn/10",
  },
};

export function StatusChip({ status }: { status: AskStatus }) {
  const s = STATUS_LABELS[status];
  return (
    <span className={`text-[10px] tracking-wide border rounded px-1.5 py-0.5 ${s.cls}`}>
      {s.label}
    </span>
  );
}

/** Collapsed, always-recoverable container for hidden cards (F9 v1: only
 * settled cards can land here — the pages enforce that rule). */
export function HiddenSection({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted hover:text-foreground select-none">
        Hidden ({count})
      </summary>
      <div className="space-y-4 mt-4 opacity-75">{children}</div>
    </details>
  );
}

export function ExplorerLink({ txid, label }: { txid: string; label: string }) {
  return (
    <a
      href={explorerTxUrl(txid)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-faint hover:text-teal underline decoration-dotted"
      title={txid}
    >
      {label} ↗
    </a>
  );
}

export function AskCard({
  message,
  amountSompi,
  counterpartyLabel,
  counterpartyAddress,
  counterpartyEditable = true,
  deadline,
  daaScore,
  status,
  resolvedAtMs = null,
  viewer = "recipient",
  badge,
  footer,
  children,
}: {
  /** Decrypted plaintext, or null while locked/undecryptable. */
  message: string | null;
  amountSompi: string;
  counterpartyLabel: string;
  counterpartyAddress: string;
  /** Landing-page mock cards disable the naming affordance. */
  counterpartyEditable?: boolean;
  deadline: string;
  daaScore: bigint | null;
  status: AskStatus;
  /** Epoch ms when the claim/refund was mined (settled cards, F10). */
  resolvedAtMs?: number | null;
  /** Which side is looking. Changes tone only — never status or money. */
  viewer?: CardViewer;
  /** Extra chip(s) in the status row (e.g. the §4 escrow-verified badge). */
  badge?: ReactNode;
  /** Explorer links row. */
  footer?: ReactNode;
  /** Expanded content (reply box, reply text, actions). */
  children?: ReactNode;
}) {
  const [remainingSecs, setRemainingSecs] = useState<number | null>(null);
  const live = status === "open" || status === "expired_pending_refund";
  const heat = live ? approachHeat(remainingSecs) : 0;

  // "Caught it" fires ONLY on the open -> answered transition, never on the
  // first render of an already-answered card. Reloading a page is not an
  // event worth celebrating, and a bloom on every mount would turn a
  // moment into wallpaper.
  const prevStatus = useRef<AskStatus | null>(null);
  const [caught, setCaught] = useState(false);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (was === null) return; // first render — no transition happened
    if (was !== "answered" && status === "answered") {
      setCaught(true);
      const id = setTimeout(() => setCaught(false), 2600);
      return () => clearTimeout(id);
    }
  }, [status]);

  return (
    <article
      className={`glass-clear rounded-xl p-5 space-y-4 animate-card-in ${
        live && heat > 0 ? "deadline-rail" : ""
      } ${caught ? "animate-caught" : ""}`}
      style={
        live && heat > 0
          ? ({
              "--card-accent": railColor(viewer, heat),
              "--card-glow": railGlow(viewer, heat) ?? "transparent",
              "--card-glow-blur": railGlow(viewer, heat)
                ? `${Math.round(heat * 22)}px`
                : "0px",
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {message !== null ? (
            <CollapsibleText text={message} className="text-[15px] leading-relaxed" />
          ) : (
            <p className="text-faint italic text-[15px]">encrypted message</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="amount text-xl font-bold">
            {formatKas(BigInt(amountSompi))}
            <span className="text-xs font-medium text-muted ml-1">TKAS</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusChip status={status} />
        {badge}
        {/* F10 precedence: terminal states never show a ticking countdown —
            deadline logic applies only while a reply is still possible. */}
        {status === "answered" || status === "refunded" ? (
          <ResolvedAgo resolvedAtMs={resolvedAtMs} />
        ) : (
          <Countdown
            deadline={deadline}
            daaScore={daaScore}
            viewer={viewer}
            onRemaining={setRemainingSecs}
          />
        )}
        {caught && (
          <span className="text-[10px] tracking-wide text-teal border border-teal/60 bg-teal/10 rounded px-1.5 py-0.5 animate-fade-in">
            caught it
          </span>
        )}
        {/* The refund, said out loud, and only to the person it happened
            to. "A reply or your money back" is the promise — this is the
            moment it is kept, so it should read as the product working. To
            the recipient the same event is just "the sender got it back";
            telling them they paid nothing for silence would be nonsense. */}
        {status === "refunded" && viewer === "asker" && (
          <span className="text-xs text-cool">
            ✓ refunded — you paid nothing for silence
          </span>
        )}
        <span className="text-xs text-muted">
          {counterpartyLabel}{" "}
          <ContactName
            address={counterpartyAddress}
            editable={counterpartyEditable}
          />
        </span>
      </div>
      {children}
      {footer && (
        <div className="flex flex-wrap gap-3 pt-1 border-t border-border/60">
          {footer}
        </div>
      )}
    </article>
  );
}
