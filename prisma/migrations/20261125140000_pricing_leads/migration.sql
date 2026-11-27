CREATE TABLE "saas_pricing_leads" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "visits" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_pricing_leads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_pricing_leads_phone_key" ON "saas_pricing_leads"("phone");
