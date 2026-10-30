-- The free trial is gone: a business must subscribe before its bot replies.
UPDATE "saas_workspaces" SET "plan" = 'pro', "plan_status" = 'inactive' WHERE "plan" = 'trial' OR "plan_status" = 'trialing';
ALTER TABLE "saas_workspaces" ALTER COLUMN "plan" SET DEFAULT 'pro';
ALTER TABLE "saas_workspaces" ALTER COLUMN "plan_status" SET DEFAULT 'inactive';
ALTER TABLE "saas_workspaces" DROP COLUMN "trial_ends_at";
-- Redeem codes that only extended a trial no longer mean anything
DELETE FROM "saas_coupon_redemptions" WHERE "coupon_id" IN (SELECT "id" FROM "saas_coupons" WHERE "plan" = 'trial');
DELETE FROM "saas_coupons" WHERE "plan" = 'trial';
