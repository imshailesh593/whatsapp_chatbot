-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('COACHING', 'LICENSING', 'JOBS', 'VISA_PR', 'GENERAL');

-- CreateEnum
CREATE TYPE "SessionStage" AS ENUM ('WELCOME', 'AWAITING_SERVICE_SELECTION', 'IN_QUESTIONNAIRE', 'COMPLETED', 'AGENT_TAKEOVER');

-- CreateTable
CREATE TABLE "mns_sessions" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "contact_name" TEXT,
    "stage" "SessionStage" NOT NULL DEFAULT 'WELCOME',
    "selected_service" "ServiceCategory",
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "is_agent_paused" BOOLEAN NOT NULL DEFAULT false,
    "last_interaction_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mns_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mns_leads" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "service_category" "ServiceCategory" NOT NULL,
    "collected_data" JSONB NOT NULL,
    "is_booked_topmate" BOOLEAN NOT NULL DEFAULT false,
    "counsellor_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mns_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mns_webhook_logs" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT,
    "direction" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mns_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mns_sessions_phone_number_key" ON "mns_sessions"("phone_number");

-- CreateIndex
CREATE INDEX "mns_sessions_stage_idx" ON "mns_sessions"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "mns_leads_session_id_key" ON "mns_leads"("session_id");

-- CreateIndex
CREATE INDEX "mns_leads_phone_number_idx" ON "mns_leads"("phone_number");

-- CreateIndex
CREATE INDEX "mns_leads_service_category_idx" ON "mns_leads"("service_category");

-- AddForeignKey
ALTER TABLE "mns_leads" ADD CONSTRAINT "mns_leads_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "mns_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
