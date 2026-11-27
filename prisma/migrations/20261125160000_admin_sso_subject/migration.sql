-- Admin Hub single sign-in: links a platform-staff account to its Authentik subject
ALTER TABLE "mns_admin_users" ADD COLUMN "sso_subject" TEXT;
CREATE UNIQUE INDEX "mns_admin_users_sso_subject_key" ON "mns_admin_users"("sso_subject");
