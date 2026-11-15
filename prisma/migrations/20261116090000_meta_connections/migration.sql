-- Instagram and Facebook Messenger: the Pages (and linked Instagram accounts) each business has connected
CREATE TABLE "saas_meta_connections" (
    "page_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "page_name" TEXT NOT NULL DEFAULT '',
    "ig_user_id" TEXT,
    "ig_username" TEXT NOT NULL DEFAULT '',
    "token_enc" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_meta_connections_pkey" PRIMARY KEY ("page_id")
);
CREATE UNIQUE INDEX "saas_meta_connections_ig_user_id_key" ON "saas_meta_connections"("ig_user_id");
CREATE INDEX "saas_meta_connections_workspace_id_idx" ON "saas_meta_connections"("workspace_id");
ALTER TABLE "saas_meta_connections" ADD CONSTRAINT "saas_meta_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Auto comment replies: settings per business, and a record of every comment handled
ALTER TABLE "saas_workspaces" ADD COLUMN "comment_replies_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "saas_workspaces" ADD COLUMN "comment_reply_mode" TEXT NOT NULL DEFAULT 'keywords';
ALTER TABLE "saas_workspaces" ADD COLUMN "comment_keywords" TEXT NOT NULL DEFAULT 'price, cost, fee, fees, info, details, interested, how much, dm';
ALTER TABLE "saas_workspaces" ADD COLUMN "comment_send_dm" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "saas_workspaces" ADD COLUMN "comment_reply_template" TEXT NOT NULL DEFAULT '';

CREATE TABLE "saas_comment_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL DEFAULT '',
    "commenter_id" TEXT NOT NULL DEFAULT '',
    "commenter_name" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "reply_text" TEXT NOT NULL DEFAULT '',
    "dm_text" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_comment_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saas_comment_events_workspace_id_created_at_idx" ON "saas_comment_events"("workspace_id", "created_at");
CREATE INDEX "saas_comment_events_account_id_created_at_idx" ON "saas_comment_events"("account_id", "created_at");
ALTER TABLE "saas_comment_events" ADD CONSTRAINT "saas_comment_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
