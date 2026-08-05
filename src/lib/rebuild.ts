// Rebuild-from-chain (brief §3.3): reconstruct ask records for an address
// PURELY from public chain data — proving the cache DB can be dropped at
// any time. Historical source: the REST indexer's address history (ASKSPEC
// §7 "historical sync"); statuses then settle through the same
// deriveStatusFromChain used everywhere else (chain remains authoritative).
//
// Coverage, stated honestly (matches the protocol's discovery model):
//   - SENDER side is complete: every lock tx spends the sender's UTXOs and
//     carries the ask announcement, so it appears in sender history.
//   - RECIPIENT side recovers ANSWERED asks (the claim tx pays the
//     recipient and its reply names the lock). Unanswered incoming asks
//     are discovered live via the firehose, not history — same limitation
//     Kasia's protocol has without an indexer.
import type { RpcClient } from "kaspa-wasm";
import { type AskRecordDto } from "./ask-record";
import { REST_API_BASE } from "./config";
import { deriveStatusFromChain } from "./asks-client";
import {
  ASK_PREFIX,
  REFUND_FEE_ALLOWANCE,
  parseAskPayload,
  toHex,
  type AskEnvelope,
} from "./ask/protocol";
import {
  parseAskPayloadV3,
  type AskEnvelopeV3,
} from "./ask/protocol-v3";

export interface RestFullTx {
  transaction_id: string;
  payload: string | null;
}

const PREFIX_HEX = toHex(new TextEncoder().encode(ASK_PREFIX));

async function restGet<T>(path: string, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${REST_API_BASE}${path}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function fetchAddressHistory(
  address: string
): Promise<RestFullTx[]> {
  return restGet<RestFullTx[]>(
    // resolve_previous_outpoints=light is the exact form probed successfully
    // against TN10 (2026-08-03); inputs are unused here but the verified
    // call shape is kept.
    `/addresses/${encodeURIComponent(address)}/full-transactions?limit=500&resolve_previous_outpoints=light`
  );
}

function candidateFromEnvelope(
  lockTxid: string,
  env: AskEnvelope
): AskRecordDto {
  return {
    askRef: lockTxid,
    // This helper takes a V2 AskEnvelope, so the record is V2 by
    // construction. A V3 rebuild path needs its own helper — see the
    // rebuild gap noted in the migration entry in PROGRESS.md.
    protocolVersion: 1,
    askId: null,
    refundAllowance: null,
    senderAddress: env.sender,
    recipientAddress: env.recipient,
    amountSompi: (BigInt(env.minRefund) + REFUND_FEE_ALLOWANCE).toString(),
    messageCiphertext: env.message,
    deadline: env.deadlineDaa,
    lockTxid,
    claimTxid: null,
    refundTxid: null,
    status: "open",
  };
}

/** V3 announcements carry the covenant parameters outright: the per-Ask
 * askId and refundAllowance (which replaced the global constant), and the
 * locked amount, which V2 left implicit as minRefund + that constant. */
function candidateFromEnvelopeV3(
  lockTxid: string,
  env: AskEnvelopeV3
): AskRecordDto {
  return {
    askRef: lockTxid,
    protocolVersion: 2,
    askId: env.askId,
    refundAllowance: env.refundAllowance,
    senderAddress: env.sender,
    recipientAddress: env.recipient,
    amountSompi: env.amountSompi,
    messageCiphertext: env.message,
    deadline: env.deadlineDaa,
    lockTxid,
    claimTxid: null,
    refundTxid: null,
    status: "open",
  };
}

/** Parse one ask-namespace payload under EITHER version.
 *
 * V3 first, then V2. The V3 announce header (`ciph_msg:1:ask:a2:`) extends
 * the V2 namespace prefix, so a V3 payload reaches the V2 parser looking
 * merely malformed — and rebuild's catch would skip it in silence. Trying
 * V3 first removes that ambiguity; parseAskPayloadV3 returns null (rather
 * than throwing) for anything outside its own namespace, which is what
 * makes the fallback safe. */
function parseEither(
  payloadHex: string
):
  | { kind: "ask"; candidate: (lockTxid: string) => AskRecordDto }
  | { kind: "reply"; ref: string }
  | null {
  const v3 = parseAskPayloadV3(payloadHex);
  if (v3) {
    return v3.kind === "ask"
      ? { kind: "ask", candidate: (id) => candidateFromEnvelopeV3(id, v3.envelope) }
      : { kind: "reply", ref: v3.envelope.ref };
  }
  const v2 = parseAskPayload(payloadHex);
  if (!v2) return null;
  return v2.kind === "ask"
    ? { kind: "ask", candidate: (id) => candidateFromEnvelope(id, v2.envelope) }
    : { kind: "reply", ref: v2.envelope.ref };
}

export interface HistoryScan {
  /** Ask announcements in this history involving ownAddress. */
  candidates: AskRecordDto[];
  /** Lock txids referenced by reply payloads found in this history —
   * recipient-side leads to asks whose locks live in the sender's history. */
  replyRefs: string[];
}

/** Pure classifier over an address history (unit-tested; §2.3 rules:
 * malformed ask-namespace payloads are skipped, never surfaced). */
export function scanHistory(
  history: RestFullTx[],
  ownAddress: string
): HistoryScan {
  const candidates: AskRecordDto[] = [];
  const replyRefs: string[] = [];
  for (const tx of history) {
    const payload = tx.payload ?? "";
    if (!payload.startsWith(PREFIX_HEX)) continue;
    try {
      const parsed = parseEither(payload);
      if (!parsed) continue;
      if (parsed.kind === "ask") {
        const candidate = parsed.candidate(tx.transaction_id);
        if (
          candidate.senderAddress === ownAddress ||
          candidate.recipientAddress === ownAddress
        ) {
          candidates.push(candidate);
        }
      } else {
        replyRefs.push(parsed.ref.toLowerCase());
      }
    } catch {
      /* malformed per §2.3 — client-rejected, skip */
    }
  }
  return { candidates, replyRefs };
}

/** Full rebuild for one address. Returns chain-settled records (only §4
 * verified ones — an announcement that never funded its escrow is dropped). */
export async function rebuildFromChain(
  rpc: RpcClient,
  ownAddress: string
): Promise<AskRecordDto[]> {
  const history = await fetchAddressHistory(ownAddress);
  const { candidates, replyRefs } = scanHistory(history, ownAddress);
  const known = new Set(candidates.map((c) => c.askRef.toLowerCase()));

  // Recipient-side: chase reply refs to their lock transactions.
  for (const ref of replyRefs) {
    if (known.has(ref)) continue;
    known.add(ref);
    try {
      const lockTx = await restGet<RestFullTx>(`/transactions/${ref}`);
      const parsed = lockTx.payload ? parseEither(lockTx.payload) : null;
      if (parsed?.kind === "ask") {
        const candidate = parsed.candidate(ref);
        if (
          candidate.senderAddress === ownAddress ||
          candidate.recipientAddress === ownAddress
        ) {
          candidates.push(candidate);
        }
      }
    } catch {
      /* unreachable or malformed lock — skip */
    }
  }

  const rebuilt: AskRecordDto[] = [];
  for (const candidate of candidates) {
    try {
      const d = await deriveStatusFromChain(rpc, candidate);
      if (!d.verified) continue;
      rebuilt.push({
        ...candidate,
        status: d.status,
        claimTxid: d.claimTxid,
        refundTxid: d.refundTxid,
      });
    } catch {
      /* leave this candidate out rather than cache unverified state */
    }
  }
  return rebuilt;
}
