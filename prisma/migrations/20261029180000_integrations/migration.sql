-- AlterTable
ALTER TABLE "mns_sessions" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "saas_webhooks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_code" INTEGER,
    "error" TEXT NOT NULL DEFAULT '',
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_api_keys" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saas_webhooks_workspace_id_idx" ON "saas_webhooks"("workspace_id");

-- CreateIndex
CREATE INDEX "saas_webhook_deliveries_status_next_attempt_at_idx" ON "saas_webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "saas_webhook_deliveries_webhook_id_created_at_idx" ON "saas_webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "saas_api_keys_hash_key" ON "saas_api_keys"("hash");

-- CreateIndex
CREATE INDEX "saas_api_keys_workspace_id_idx" ON "saas_api_keys"("workspace_id");

-- AddForeignKey
ALTER TABLE "saas_webhooks" ADD CONSTRAINT "saas_webhooks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_webhook_deliveries" ADD CONSTRAINT "saas_webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "saas_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_api_keys" ADD CONSTRAINT "saas_api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

