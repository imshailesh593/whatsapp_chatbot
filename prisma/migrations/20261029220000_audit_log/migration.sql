-- CreateTable
CREATE TABLE "saas_audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "workspace_id" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saas_audit_log_created_at_idx" ON "saas_audit_log"("created_at");

