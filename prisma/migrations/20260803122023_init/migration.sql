-- CreateTable
CREATE TABLE "asks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ask_ref" TEXT NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "asks_ask_ref_key" ON "asks"("ask_ref");

-- CreateIndex
CREATE INDEX "asks_recipient_address_idx" ON "asks"("recipient_address");

-- CreateIndex
CREATE INDEX "asks_sender_address_idx" ON "asks"("sender_address");
