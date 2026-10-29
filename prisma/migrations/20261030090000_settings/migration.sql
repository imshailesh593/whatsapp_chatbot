-- CreateTable
CREATE TABLE "saas_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "saas_settings_pkey" PRIMARY KEY ("key")
);

