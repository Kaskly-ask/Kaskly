// OPW-3 (+ F16) — cheap dust makes a real, funded Ask disappear.
//
// The covenant P2SH is derivable by anyone from the on-chain announcement,
// and anyone may pay to it. Two independent reads then break, and they
// compound, so they are fixed together:
//
//   F16  `getCovenantUtxo` returns `entries[0]` ONLY. Dust UTXOs at the
//        address push the real lock output out of slot 0, so the UNSPENT
//        path stops recognising its own escrow.
//   OPW-3 Both load-bearing REST predicates (`funded`, `spender`) read a
//        single `limit=50` window of address history, newest-first. ~50
//        dust payments evict the lock and claim rows, so the SPENT path
//        stops resolving too.
//
// Either way the row fails verification, is filtered from both screens,
// and — the part that costs money — the §8 auto-refund never fires for it.
// The attacker steals nothing (the covenant pins refunds to the sender),
// but a sender can be denied automatic recovery of their own funds for the
// price of some dust.
//
// THE FIX, both halves:
//   - scan ALL UTXOs at the address for the one matching this Ask's
//     outpoint and amount, instead of trusting slot 0;
//   - stop trusting a window: read the funding fact from the LOCK
//     TRANSACTION directly (O(1), dust cannot touch it), and paginate the
//     history for the spender.
//
// Pagination is `limit` + `offset` on `/addresses/{a}/full-transactions`.
// Verified against the live TN10 API's own OpenAPI schema before use:
// `limit` maximum 500 (600 → HTTP 422), `offset` supported with no maximum.
// Not assumed (R6).
//
// EXPECTED STATE WHEN COMMITTED: the dust cases fail; the clean control and
// the fail-closed control pass.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { payToAddressScript, PrivateKey, Keypair, type RpcClient } from "kaspa-wasm";
import { deriveStatusFromChain } from "../../src/lib/asks-client";
import { prepareAskV3 } from "../../src/lib/ask/node-v3";
import { encodeAskPayloadV3, encodeReplyPayloadV3 } from "../../src/lib/ask/protocol-v3";
import { DAA_ANCHORS } from "../../src/lib/ask/daa-guard";
import type { AskRecordDto } from "../../src/lib/ask-record";

const NETWORK_ID = "testnet-10";
const ANCHOR = DAA_ANCHORS[NETWORK_ID];
const CURRENT_DAA = ANCHOR.daaScore + BigInt(86_400 * ANCHOR.ratePerSecond);
const DEADLINE = CURRENT_DAA + BigInt(7 * 86_400 * ANCHOR.ratePerSecond);
const AMOUNT = 100_000_000n;
const DUST = 1_000n;
const ASK_ID = "6b".repeat(32);
const CIPHERTEXT = "33".repeat(96);

const RECIPIENT = Keypair.fromPrivateKey(new PrivateKey("00".repeat(31) + "07"))
  .toAddress("testnet")
  .toString();
const SENDER = Keypair.fromPrivateKey(new PrivateKey("00".repeat(31) + "09"))
  .toAddress("testnet")
  .toString();

const V3 = prepareAskV3({
  networkId: NETWORK_ID,
  senderAddress: SENDER,
  recipientAddress: RECIPIENT,
  amount: AMOUNT,
  message: "opw-3",
  deadlineDaa: DEADLINE,
  currentDaa: CURRENT_DAA,
  nowMs: ANCHOR.observedAtMs + 86_400_000,
  askIdHex: ASK_ID,
  utxoTemplate: (a: bigint) =>
    ({
      address: SENDER,
      outpoint: { transactionId: "aa".repeat(32), index: 0 },
      amount: a,
      scriptPublicKey: payToAddressScript(SENDER),
      blockDaaScore: 1n,
      isCoinbase: false,
    }) as never,
});
const P2SH = V3.p2shAddress;

const ANNOUNCEMENT = encodeAskPayloadV3({
  v: 2,
  sender: SENDER,
  recipient: RECIPIENT,
  deadlineDaa: DEADLINE.toString(),
  askId: ASK_ID,
  refundAllowance: V3.refundAllowance.toString(),
  amountSompi: AMOUNT.toString(),
  msgEnc: "kasia1",
  message: CIPHERTEXT,
});

function record(lockTxid: string): AskRecordDto {
  return {
    askRef: lockTxid,
    protocolVersion: 2,
    askId: ASK_ID,
    refundAllowance: V3.refundAllowance.toString(),
    senderAddress: SENDER,
    recipientAddress: RECIPIENT,
    amountSompi: AMOUNT.toString(),
    messageCiphertext: CIPHERTEXT,
    deadline: DEADLINE.toString(),
    lockTxid,
    claimTxid: null,
    refundTxid: null,
    status: "open",
  };
}

interface Row {
  transaction_id: string;
  payload: string | null;
  block_time?: number;
  outputs: { index: number; amount: string; script_public_key_address: string }[];
  inputs: { previous_outpoint_address?: string | null }[] | null;
}

const lockRow = (lockTxid: string): Row => ({
  transaction_id: lockTxid,
  payload: ANNOUNCEMENT,
  block_time: 1_000_000,
  outputs: [
    { index: 0, amount: AMOUNT.toString(), script_public_key_address: P2SH },
  ],
  inputs: null,
});

const claimRow = (lockTxid: string): Row => ({
  transaction_id: "cc".repeat(32),
  payload: encodeReplyPayloadV3({
    askIdHex: ASK_ID,
    envelope: { v: 2, ref: lockTxid, msgEnc: "kasia1", message: CIPHERTEXT },
  }),
  block_time: 2_000_000,
  outputs: [
    { index: 0, amount: "99738300", script_public_key_address: RECIPIENT },
  ],
  inputs: [{ previous_outpoint_address: P2SH }],
});

/** Attacker rows: dust paid TO the covenant address. Free to make, and
 * newest-first ordering puts them ahead of everything real. */
function dustRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    transaction_id: `d${i.toString(16).padStart(2, "0")}`.repeat(32).slice(0, 64),
    payload: null,
    block_time: 9_000_000 + i,
    outputs: [{ index: 0, amount: DUST.toString(), script_public_key_address: P2SH }],
    inputs: null,
  }));
}

/** REST stub honouring limit AND offset, so the SAME fixture serves the
 * pre-fix single-window read and the post-fix paginated read. Without that
 * the red run would be measuring the fixture, not the code. */
function stubRest(history: Row[], lockTxid: string) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const json = (v: unknown) =>
      ({ ok: true, status: 200, json: async () => v }) as unknown as Response;
    if (url.includes(`/transactions/${lockTxid}`)) return json(lockRow(lockTxid));
    if (url.includes("/full-transactions")) {
      const limit = Number(/[?&]limit=(\d+)/.exec(url)?.[1] ?? 50);
      const offset = Number(/[?&]offset=(\d+)/.exec(url)?.[1] ?? 0);
      return json(history.slice(offset, offset + limit));
    }
    return json([]);
  });
}

/** Node whose UTXO set at the covenant address contains dust AHEAD of the
 * real lock output — the F16 half. */
function fakeNode(utxos: { txid: string; amount: bigint }[]) {
  return {
    getBlockDagInfo: async () => ({ virtualDaaScore: CURRENT_DAA.toString() }),
    getUtxosByAddresses: async ({ addresses }: { addresses: string[] }) => {
      if (!addresses.includes(P2SH)) return { entries: [] };
      return {
        entries: utxos.map((u) => ({
          address: P2SH,
          outpoint: { transactionId: u.txid, index: 0 },
          amount: u.amount,
          scriptPublicKey: payToAddressScript(P2SH),
          blockDaaScore: 1n,
          isCoinbase: false,
        })),
      };
    },
  } as unknown as RpcClient;
}

beforeEach(() => vi.unstubAllGlobals());

describe("CONTROLS — the clean cases, before and after", () => {
  it("an unspent Ask with no dust resolves open", async () => {
    const id = "b1".repeat(32);
    stubRest([lockRow(id)], id);
    const d = await deriveStatusFromChain(fakeNode([{ txid: id, amount: AMOUNT }]), record(id));
    expect(d.verified).toBe(true);
    expect(d.status).toBe("open");
  });

  it("FAIL-CLOSED: a lock that never paid the covenant stays unverified", async () => {
    // The fix must not turn "not funded" into "verified" — the funding fact
    // still has to be proven, just from a source dust cannot evict.
    const id = "b2".repeat(32);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const json = (v: unknown) =>
        ({ ok: true, status: 200, json: async () => v }) as unknown as Response;
      if (url.includes(`/transactions/${id}`)) {
        // Announcement present, but it paid somebody else.
        return json({
          ...lockRow(id),
          outputs: [
            { index: 0, amount: AMOUNT.toString(), script_public_key_address: SENDER },
          ],
        });
      }
      return json([]);
    });
    const d = await deriveStatusFromChain(fakeNode([]), record(id));
    expect(d.verified).toBe(false);
  });
});

describe("THE FIX — dust must not evict a real Ask", () => {
  it("F16: the escrow is found even when dust holds slot 0", async () => {
    const id = "f1".repeat(32);
    stubRest([lockRow(id)], id);
    // 60 dust UTXOs first, the genuine lock output last.
    const utxos = [
      ...Array.from({ length: 60 }, (_, i) => ({
        txid: `e${i.toString(16).padStart(2, "0")}`.repeat(32).slice(0, 64),
        amount: DUST,
      })),
      { txid: id, amount: AMOUNT },
    ];
    const d = await deriveStatusFromChain(fakeNode(utxos), record(id));
    expect(
      d.verified,
      "entries[0] was dust, so the client no longer recognises its own " +
        "escrow — the Ask vanishes and auto-refund never fires"
    ).toBe(true);
    expect(d.status).toBe("open");
  });

  it("OPW-3: a settled Ask resolves with 60 dust rows ahead of it", async () => {
    const id = "f2".repeat(32);
    // Newest-first: dust, then the claim, then the lock. A 50-row window
    // sees only dust.
    stubRest([...dustRows(60), claimRow(id), lockRow(id)], id);
    const d = await deriveStatusFromChain(fakeNode([]), record(id));
    expect(
      d.verified,
      "the funded/spender predicates read one limit=50 window, so dust " +
        "erased a completed Ask from the sender's own history"
    ).toBe(true);
    expect(d.status).toBe("answered");
    expect(d.claimTxid).toBe("cc".repeat(32));
  });

  it("CONTROL: dust noise AROUND a legitimate Ask still resolves correctly", async () => {
    // Dust interleaved on both sides rather than only in front — the shape
    // a real griefing campaign would produce over time.
    const id = "f3".repeat(32);
    stubRest([...dustRows(30), claimRow(id), ...dustRows(40), lockRow(id)], id);
    const d = await deriveStatusFromChain(fakeNode([]), record(id));
    expect(d.verified).toBe(true);
    expect(d.status).toBe("answered");
    expect(d.claimNetSompi).toBe("99738300");
  });
});
