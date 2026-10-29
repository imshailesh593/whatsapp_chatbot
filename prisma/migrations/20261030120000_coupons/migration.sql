CREATE TABLE "saas_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "max_redemptions" INTEGER,
    "redeemed_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_coupons_code_key" ON "saas_coupons"("code");

CREATE TABLE "saas_coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_coupon_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saas_coupon_redemptions_coupon_id_workspace_id_key" ON "saas_coupon_redemptions"("coupon_id", "workspace_id");
ALTER TABLE "saas_coupon_redemptions" ADD CONSTRAINT "saas_coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "saas_coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saas_coupon_redemptions" ADD CONSTRAINT "saas_coupon_redemptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
