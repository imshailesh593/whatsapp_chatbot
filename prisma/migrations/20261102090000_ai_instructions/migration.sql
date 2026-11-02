-- Owner-written rules for how the AI answers questions.
ALTER TABLE "saas_workspaces" ADD COLUMN "ai_instructions" TEXT NOT NULL DEFAULT '';
