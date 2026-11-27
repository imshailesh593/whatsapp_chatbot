-- Photos attached to saved messages.
ALTER TABLE "saas_workspaces" ADD COLUMN "message_photos" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "saas_message_revisions" ADD COLUMN "before_photo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "saas_message_revisions" ADD COLUMN "after_photo" TEXT NOT NULL DEFAULT '';

CREATE TABLE "saas_message_photos" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_message_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saas_message_photos_workspace_id_idx" ON "saas_message_photos"("workspace_id");

ALTER TABLE "saas_message_photos" ADD CONSTRAINT "saas_message_photos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
