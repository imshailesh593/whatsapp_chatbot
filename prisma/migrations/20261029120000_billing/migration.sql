-- AlterTable
ALTER TABLE "saas_workspaces" ADD COLUMN     "billing_provider" TEXT,
ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'trial',
ADD COLUMN     "plan_status" TEXT NOT NULL DEFAULT 'trialing',
ADD COLUMN     "provider_customer_id" TEXT,
ADD COLUMN     "provider_subscription_id" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "saas_usage" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "aiReplies" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "saas_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_payments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_billing_events" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saas_usage_workspace_id_period_key" ON "saas_usage"("workspace_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "saas_payments_provider_ref_key" ON "saas_payments"("provider_ref");

-- CreateIndex
CREATE INDEX "saas_payments_workspace_id_created_at_idx" ON "saas_payments"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "saas_usage" ADD CONSTRAINT "saas_usage_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_payments" ADD CONSTRAINT "saas_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The operator's own business is exempt from plan limits
UPDATE "saas_workspaces" SET "plan"='internal', "plan_status"='active' WHERE "id"='default-workspace';
