-- AlterTable
ALTER TABLE "mns_leads" ADD COLUMN     "follow_up_at" TIMESTAMP(3),
ADD COLUMN     "follow_up_notified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "owner_id" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "saas_lead_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "actor" TEXT NOT NULL DEFAULT 'bot',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saas_lead_events_lead_id_created_at_idx" ON "saas_lead_events"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "mns_leads_workspace_id_owner_id_idx" ON "mns_leads"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "mns_leads_follow_up_at_idx" ON "mns_leads"("follow_up_at");

-- AddForeignKey
ALTER TABLE "saas_lead_events" ADD CONSTRAINT "saas_lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "mns_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

