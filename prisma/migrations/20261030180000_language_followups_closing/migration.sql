-- AlterEnum
ALTER TYPE "SessionStage" ADD VALUE IF NOT EXISTS 'AWAITING_LANGUAGE';

-- AlterTable
ALTER TABLE "saas_workspaces" ADD COLUMN "language_step" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "language_welcome" TEXT NOT NULL DEFAULT '',
ADD COLUMN "follow_ups_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "saas_services" ADD COLUMN "closing_message" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "mns_sessions" ADD COLUMN "language" TEXT,
ADD COLUMN "follow_up_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_follow_up_at" TIMESTAMP(3);
