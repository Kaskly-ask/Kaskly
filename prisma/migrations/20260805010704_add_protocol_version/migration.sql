-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_asks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ask_ref" TEXT NOT NULL,
    "protocol_version" INTEGER NOT NULL DEFAULT 1,
    "ask_id" TEXT,
    "refund_allowance" BIGINT,
    "sender_address" TEXT NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "amount_sompi" BIGINT NOT NULL,
    "message_ciphertext_or_text" TEXT NOT NULL,
    "deadline" BIGINT NOT NULL,
    "lock_txid" TEXT NOT NULL,
    "claim_txid" TEXT,
    "refund_txid" TEXT,
    "status" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_asks" ("amount_sompi", "ask_ref", "claim_txid", "created_at", "deadline", "id", "lock_txid", "message_ciphertext_or_text", "recipient_address", "refund_txid", "sender_address", "status") SELECT "amount_sompi", "ask_ref", "claim_txid", "created_at", "deadline", "id", "lock_txid", "message_ciphertext_or_text", "recipient_address", "refund_txid", "sender_address", "status" FROM "asks";
DROP TABLE "asks";
ALTER TABLE "new_asks" RENAME TO "asks";
CREATE UNIQUE INDEX "asks_ask_ref_key" ON "asks"("ask_ref");
CREATE INDEX "asks_recipient_address_idx" ON "asks"("recipient_address");
CREATE INDEX "asks_sender_address_idx" ON "asks"("sender_address");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
