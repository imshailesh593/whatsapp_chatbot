-- History of edits made with the message editor, so a save can be undone.
CREATE TABLE "saas_message_revisions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "created_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_message_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saas_message_revisions_workspace_id_message_id_created_at_idx" ON "saas_message_revisions"("workspace_id", "message_id", "created_at");

ALTER TABLE "saas_message_revisions" ADD CONSTRAINT "saas_message_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
