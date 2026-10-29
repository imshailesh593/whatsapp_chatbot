-- AlterTable
ALTER TABLE "mns_sessions" ADD COLUMN     "opted_out" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "saas_usage" ADD COLUMN     "broadcasts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "saas_broadcasts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "note" TEXT NOT NULL DEFAULT '',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "saas_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saas_broadcasts_workspace_id_created_at_idx" ON "saas_broadcasts"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "saas_broadcasts_status_idx" ON "saas_broadcasts"("status");

-- CreateIndex
CREATE INDEX "saas_broadcast_recipients_broadcast_id_status_idx" ON "saas_broadcast_recipients"("broadcast_id", "status");

-- AddForeignKey
ALTER TABLE "saas_broadcasts" ADD CONSTRAINT "saas_broadcasts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_broadcast_recipients" ADD CONSTRAINT "saas_broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "saas_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

