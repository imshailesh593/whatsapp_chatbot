-- AI-written conversations: on by default; a business can switch back to the fixed menu
ALTER TABLE "saas_workspaces" ADD COLUMN "ai_conversation" BOOLEAN NOT NULL DEFAULT true;
