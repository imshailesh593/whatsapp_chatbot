-- AlterTable
ALTER TABLE "mns_leads" ADD COLUMN     "follow_up" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "mns_webhook_logs_phone_number_created_at_idx" ON "mns_webhook_logs"("phone_number", "created_at");
