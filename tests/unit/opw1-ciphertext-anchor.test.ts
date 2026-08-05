// OPW-1 — an unauthenticated POST rewrites the MESSAGE of a chain-verified
// Ask, and the UI paints "✓ escrowed" over the attacker's text.
//
// WHY THE OTHER FIELDS ARE ALREADY SAFE. sender, recipient, deadline,
// amount, askId and refundAllowance are all inputs to the covenant, so
// changing any of them yields a different P2SH, which does not match the
// funded address, and trial reconstruction fails closed. They are anchored
// by construction.
//
// `messageCiphertext` is not a covenant input. It is the ONE field with no
// chain anchor — and it is the field the human actually reads. `/api/asks`
// is unauthenticated (F18), so anyone who can name a real askRef can
// replace the message of a genuine, funded, verified Ask while every
// verified badge stays lit.
//
// It is not merely garbling. `encryptKasia1` is a PUBLIC-key operation and
// the recipient's x-only key is derivable from their address, so the
// attacker encrypts text of their choosing and it decrypts cleanly for the
// victim. Chosen-plaintext phishing under a verification badge.
//
// THE ANCHOR. The lock transaction's payload IS the announcement, and it
// carries the ciphertext. It is on chain and immutable. So the ciphertext
// can be checked the same way everything else already is: against what the
// chain says. Mismatch => not verified, never surfaced.
//
// "COULD NOT CHECK" IS NOT "CHECKED AND BAD" — the same discipline as
// OPW-4. A REST failure must THROW so the caller retries; only a successful
// read that disagrees may mark the record unverified. Conflating them would
// let one flaky request hide a legitimate Ask.
//
// EXPECTED STATE WHEN COMMITTED: the two forgery cases fail (they report
// verified: true), all controls pass.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { payToAddressScript, PrivateKey, Keypair, type RpcClient } from "kaspa-wasm";
import { deriveStatusFromChain } from "../../src/lib/asks-client";
import { prepareAskV3 } from "../../src/lib/ask/node-v3";
import { encodeAskPayloadV3 } from "../../src/lib/ask/protocol-v3";
import { deriveAskCovenant, xOnlyFromAddress } from "../../src/lib/ask/covenant";
import { encodeAskPayload, REFUND_FEE_ALLOWANCE } from "../../src/lib/ask/protocol";
import { DAA_ANCHORS } from "../../src/lib/ask/daa-guard";
import type { AskRecordDto } from "../../src/lib/ask-record";

const NETWORK_ID = "testnet-10";
const ANCHOR = DAA_ANCHORS[NETWORK_ID];
const CURRENT_DAA = ANCHOR.daaScore + BigInt(86_400 * ANCHOR.ratePerSecond);
const DEADLINE = CURRENT_DAA + BigInt(7 * 86_400 * ANCHOR.ratePerSecond);
const AMOUNT = 100_000_000n;
const ASK_ID = "4e".repeat(32);

const RECIPIENT = Keypair.fromPrivateKey(new PrivateKey("00".repeat(31) + "07"))
  .toAddress("testnet")
  .toString();
const SENDER = Keypair.fromPrivateKey(new PrivateKey("00".repeat(31) + "09"))
  .toAddress("testnet")
  .toString();

/** What the sender really announced, on chain. */
const HONEST_CIPHERTEXT = "11".repeat(96);
/** What an unauthenticated POST substitutes. Same length and shape, so
 * nothing about its FORM gives it away — only the chain does. */
const FORGED_CIPHERTEXT = "22".repeat(96);

const V3 = prepareAskV3({
  networkId: NETWORK_ID,
  senderAddress: SENDER,
  recipientAddress: RECIPIENT,
  amount: AMOUNT,
  message: "opw-1",
  deadlineDaa: DEADLINE,
  currentDaa: CURRENT_DAA,
  nowMs: ANCHOR.observedAtMs + 86_400_000,
  askIdHex: ASK_ID,
  utxoTemplate: (amount: bigint) =>
    ({
      address: SENDER,
      outpoint: { transactionId: "aa".repeat(32), index: 0 },
      amount,
      scriptPublicKey: payToAddressScript(SENDER),
      blockDaaScore: 1n,
      isCoinbase: false,
    }) as never,
});

const V2 = deriveAskCovenant(
  {
    recipientXOnlyHex: xOnlyFromAddress(RECIPIENT),
    senderAddress: SENDER,
    deadlineDaa: DEADLINE,
    minRefund: AMOUNT - REFUND_FEE_ALLOWANCE,
  },
  NETWORK_ID
);

/** The V3 announcement exactly as the lock transaction carries it. */
const V3_ANNOUNCEMENT = encodeAskPayloadV3({
  v: 2,
  sender: SENDER,
  recipient: RECIPIENT,
  deadlineDaa: DEADLINE.toString(),
  askId: ASK_ID,
  refundAllowance: V3.refundAllowance.toString(),
  amountSompi: AMOUNT.toString(),
  msgEnc: "kasia1",
  message: HONEST_CIPHERTEXT,
});

const V2_ANNOUNCEMENT = encodeAskPayload({
  v: 1,
  sender: SENDER,
  recipient: RECIPIENT,
  deadlineDaa: DEADLINE.toString(),
  minRefund: (AMOUNT - REFUND_FEE_ALLOWANCE).toString(),
  msgEnc: "kasia1",
  message: HONEST_CIPHERTEXT,
});

function record(
  lockTxid: string,
  version: 1 | 2,
  ciphertext: string
): AskRecordDto {
  return {
    askRef: lockTxid,
    protocolVersion: version,
    askId: version === 2 ? ASK_ID : null,
    refundAllowance: version === 2 ? V3.refundAllowance.toString() : null,
    senderAddress: SENDER,
    recipientAddress: RECIPIENT,
    amountSompi: AMOUNT.toString(),
    messageCiphertext: ciphertext,
    deadline: DEADLINE.toString(),
    lockTxid,
    claimTxid: null,
    refundTxid: null,
    status: "open",
  };
}

/** Node holding the escrow unspent — the "open Ask in the inbox" case,
 * which is exactly when a forged message would be read. */
function fakeNode(p2sh: string, lockTxid: string) {
  return {
    getBlockDagInfo: async () => ({ virtualDaaScore: CURRENT_DAA.toString() }),
    getUtxosByAddresses: async ({ addresses }: { addresses: string[] }) => {
      if (!addresses.includes(p2sh)) return { entries: [] };
      return {
        entries: [
          {
            address: p2sh,
            outpoint: { transactionId: lockTxid, index: 0 },
            amount: AMOUNT,
            scriptPublicKey: payToAddressScript(p2sh),
            blockDaaScore: 1n,
            isCoinbase: false,
          },
        ],
      };
    },
  } as unknown as RpcClient;
}

/** REST indexer serving the real lock transaction, payload and all. */
function stubIndexer(announcementByTxid: Record<string, string>, opts: { fail?: boolean } = {}) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (opts.fail) return { ok: false, status: 503 } as Response;
    const hit = Object.keys(announcementByTxid).find((id) => url.includes(id));
    if (hit) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          transaction_id: hit,
          payload: announcementByTxid[hit],
          outputs: [],
          inputs: [],
        }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
}

beforeEach(() => vi.unstubAllGlobals());

describe("CONTROLS — an honest Ask must still verify", () => {
  it("V3: the announced ciphertext verifies", async () => {
    const id = "a1".repeat(32);
    stubIndexer({ [id]: V3_ANNOUNCEMENT });
    const d = await deriveStatusFromChain(
      fakeNode(V3.p2shAddress, id),
      record(id, 2, HONEST_CIPHERTEXT)
    );
    expect(d.verified, "the honest path must survive the fix").toBe(true);
    expect(d.status).toBe("open");
  });

  it("V2: the announced ciphertext verifies", async () => {
    const id = "a2".repeat(32);
    stubIndexer({ [id]: V2_ANNOUNCEMENT });
    const d = await deriveStatusFromChain(
      fakeNode(V2.p2shAddress, id),
      record(id, 1, HONEST_CIPHERTEXT)
    );
    expect(d.verified).toBe(true);
  });
});

describe("THE FIX — a substituted message must not be surfaced as verified", () => {
  it("V3: a forged ciphertext fails verification", async () => {
    const id = "f1".repeat(32);
    stubIndexer({ [id]: V3_ANNOUNCEMENT });
    const d = await deriveStatusFromChain(
      fakeNode(V3.p2shAddress, id),
      record(id, 2, FORGED_CIPHERTEXT)
    );
    expect(
      d.verified,
      "a message the chain never announced was reported as chain-verified — " +
        "the inbox renders attacker-chosen text under the escrowed badge"
    ).toBe(false);
  });

  it("V2: a forged ciphertext fails verification", async () => {
    const id = "f2".repeat(32);
    stubIndexer({ [id]: V2_ANNOUNCEMENT });
    const d = await deriveStatusFromChain(
      fakeNode(V2.p2shAddress, id),
      record(id, 1, FORGED_CIPHERTEXT)
    );
    expect(d.verified).toBe(false);
  });
});

describe("CONTROL — could-not-check is not checked-and-bad", () => {
  it("an indexer failure THROWS rather than silently unverifying", async () => {
    // If a flaky request could mark a record unverified, one bad minute
    // would hide legitimate Asks — including open ones holding money.
    const id = "e1".repeat(32);
    stubIndexer({ [id]: V3_ANNOUNCEMENT }, { fail: true });
    await expect(
      deriveStatusFromChain(fakeNode(V3.p2shAddress, id), record(id, 2, HONEST_CIPHERTEXT))
    ).rejects.toThrow();
  }, 30_000);
});
