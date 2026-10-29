-- Configurable lead pipeline: replaces the is_booked_topmate / follow_up booleans with a stage per lead.

CREATE TABLE "saas_stages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "saas_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saas_stages_workspace_id_key_key" ON "saas_stages"("workspace_id", "key");
CREATE INDEX "saas_stages_workspace_id_position_idx" ON "saas_stages"("workspace_id", "position");
ALTER TABLE "saas_stages" ADD CONSTRAINT "saas_stages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "saas_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default pipeline for every existing workspace
INSERT INTO "saas_stages" ("id", "workspace_id", "key", "label", "color", "position", "kind")
SELECT gen_random_uuid()::text, w."id", d."key", d."label", d."color", d."position", d."kind"
FROM "saas_workspaces" w
CROSS JOIN (VALUES
  ('new', 'New lead', 'emerald', 0, 'open'),
  ('contacted', 'Contacted', 'blue', 1, 'open'),
  ('follow_up', 'Follow-up', 'amber', 2, 'open'),
  ('booked', 'Booked', 'purple', 3, 'open'),
  ('won', 'Won', 'green', 4, 'won'),
  ('lost', 'Lost', 'rose', 5, 'lost')
) AS d("key", "label", "color", "position", "kind");

-- Leads: carry the old flags over, then drop them
ALTER TABLE "mns_leads" ADD COLUMN "stage_key" TEXT NOT NULL DEFAULT 'new';
UPDATE "mns_leads" SET "stage_key" = CASE WHEN "is_booked_topmate" THEN 'booked' WHEN "follow_up" THEN 'follow_up' ELSE 'new' END;
ALTER TABLE "mns_leads" DROP COLUMN "is_booked_topmate", DROP COLUMN "follow_up";
CREATE INDEX "mns_leads_workspace_id_stage_key_idx" ON "mns_leads"("workspace_id", "stage_key");
