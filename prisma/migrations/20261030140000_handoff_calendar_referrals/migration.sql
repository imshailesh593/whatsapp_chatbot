-- Human hand-off
ALTER TABLE "mns_sessions" ADD COLUMN "handoff_at" TIMESTAMP(3);
ALTER TABLE "mns_sessions" ADD COLUMN "handoff_summary" TEXT NOT NULL DEFAULT '';
ALTER TABLE "mns_sessions" ADD COLUMN "slot_offer" JSONB;
ALTER TABLE "saas_workspaces" ADD COLUMN "handoff_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "saas_workspaces" ADD COLUMN "handoff_message" TEXT NOT NULL DEFAULT '';

-- Referrals
ALTER TABLE "saas_workspaces" ADD COLUMN "referral_code" TEXT;
ALTER TABLE "saas_workspaces" ADD COLUMN "referred_by_id" TEXT;
ALTER TABLE "saas_workspaces" ADD COLUMN "payout_details" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "saas_workspaces_referral_code_key" ON "saas_workspaces"("referral_code");

CREATE TABLE "saas_affiliate_commissions" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "referred_id" TEXT NOT NULL,
    "referred_name" TEXT NOT NULL DEFAULT '',
    "payment_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    CONSTRAINT "saas_affiliate_commissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_affiliate_commissions_payment_id_key" ON "saas_affiliate_commissions"("payment_id");
CREATE INDEX "saas_affiliate_commissions_affiliate_id_status_idx" ON "saas_affiliate_commissions"("affiliate_id", "status");
CREATE INDEX "saas_affiliate_commissions_referred_id_idx" ON "saas_affiliate_commissions"("referred_id");
ALTER TABLE "saas_affiliate_commissions" ADD CONSTRAINT "saas_affiliate_commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Google Calendar booking
CREATE TABLE "saas_calendar_configs" (
    "workspace_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "google_email" TEXT NOT NULL DEFAULT '',
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "work_days" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "work_start" TEXT NOT NULL DEFAULT '09:00',
    "work_end" TEXT NOT NULL DEFAULT '18:00',
    "notice_hours" INTEGER NOT NULL DEFAULT 4,
    "days_ahead" INTEGER NOT NULL DEFAULT 14,
    "reminder_hours" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_calendar_configs_pkey" PRIMARY KEY ("workspace_id")
);
ALTER TABLE "saas_calendar_configs" ADD CONSTRAINT "saas_calendar_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "saas_appointments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "name" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "google_event_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_appointments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saas_appointments_workspace_id_starts_at_idx" ON "saas_appointments"("workspace_id", "starts_at");
CREATE INDEX "saas_appointments_status_starts_at_idx" ON "saas_appointments"("status", "starts_at");
ALTER TABLE "saas_appointments" ADD CONSTRAINT "saas_appointments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
