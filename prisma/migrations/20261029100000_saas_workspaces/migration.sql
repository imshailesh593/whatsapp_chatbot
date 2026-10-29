-- Workspaces (tenants). Existing data moves into one default workspace so nothing is lost.

-- CreateTable
CREATE TABLE "saas_workspaces" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL DEFAULT 'generic',
    "business_name" TEXT NOT NULL DEFAULT 'Your Business',
    "tagline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "welcome_intro" TEXT NOT NULL DEFAULT '',
    "form_url" TEXT NOT NULL DEFAULT '',
    "booking_url" TEXT NOT NULL DEFAULT '',
    "booking_label" TEXT NOT NULL DEFAULT 'one-to-one consultation',
    "booking_note" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "knowledge" TEXT NOT NULL DEFAULT '',
    "languages" TEXT NOT NULL DEFAULT 'English',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "notify_email" TEXT NOT NULL DEFAULT '',
    "notify_phone" TEXT NOT NULL DEFAULT '',
    "onboarding" JSONB NOT NULL DEFAULT '{}',
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "bot_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saas_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_services" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL,

    CONSTRAINT "saas_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_questions" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "saas_questions_pkey" PRIMARY KEY ("id")
);


INSERT INTO "saas_workspaces" ("id","slug","name","onboarding_completed","updated_at")
VALUES ('default-workspace','default','Default workspace',true,CURRENT_TIMESTAMP);

ALTER TABLE "mns_admin_users" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "role" TEXT NOT NULL DEFAULT 'owner',
ADD COLUMN "workspace_id" TEXT;
UPDATE "mns_admin_users" SET "workspace_id"='default-workspace';
UPDATE "mns_admin_users" SET "is_super_admin"=true WHERE "id" = (SELECT "id" FROM "mns_admin_users" ORDER BY "created_at" ASC LIMIT 1);
ALTER TABLE "mns_admin_users" ALTER COLUMN "workspace_id" SET NOT NULL;

ALTER TABLE "mns_sessions" ADD COLUMN "workspace_id" TEXT;
UPDATE "mns_sessions" SET "workspace_id"='default-workspace';
ALTER TABLE "mns_sessions" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "mns_sessions" ALTER COLUMN "selected_service" TYPE TEXT USING "selected_service"::TEXT;

ALTER TABLE "mns_leads" ADD COLUMN "workspace_id" TEXT;
UPDATE "mns_leads" SET "workspace_id"='default-workspace';
ALTER TABLE "mns_leads" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "mns_leads" ALTER COLUMN "service_category" TYPE TEXT USING "service_category"::TEXT;

ALTER TABLE "mns_webhook_logs" ADD COLUMN "workspace_id" TEXT;
UPDATE "mns_webhook_logs" SET "workspace_id"='default-workspace';
ALTER TABLE "mns_webhook_logs" ALTER COLUMN "workspace_id" SET NOT NULL;

DROP INDEX "mns_leads_phone_number_idx";
DROP INDEX "mns_sessions_phone_number_key";
DROP INDEX "mns_webhook_logs_phone_number_created_at_idx";
DROP TYPE "ServiceCategory";

-- CreateIndex
CREATE UNIQUE INDEX "saas_workspaces_slug_key" ON "saas_workspaces"("slug");

-- CreateIndex
CREATE INDEX "saas_services_workspace_id_position_idx" ON "saas_services"("workspace_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "saas_services_workspace_id_key_key" ON "saas_services"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "saas_questions_service_id_position_idx" ON "saas_questions"("service_id", "position");

-- CreateIndex
CREATE INDEX "mns_leads_workspace_id_phone_number_idx" ON "mns_leads"("workspace_id", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "mns_sessions_workspace_id_phone_number_key" ON "mns_sessions"("workspace_id", "phone_number");

-- CreateIndex
CREATE INDEX "mns_webhook_logs_workspace_id_phone_number_created_at_idx" ON "mns_webhook_logs"("workspace_id", "phone_number", "created_at");

-- AddForeignKey
ALTER TABLE "saas_services" ADD CONSTRAINT "saas_services_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_questions" ADD CONSTRAINT "saas_questions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "saas_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mns_sessions" ADD CONSTRAINT "mns_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mns_leads" ADD CONSTRAINT "mns_leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mns_webhook_logs" ADD CONSTRAINT "mns_webhook_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mns_admin_users" ADD CONSTRAINT "mns_admin_users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

