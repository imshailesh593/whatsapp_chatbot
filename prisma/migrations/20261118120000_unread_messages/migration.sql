-- Which chats the team has read: customer messages after read_at show as unread in the Inbox
ALTER TABLE "mns_sessions" ADD COLUMN "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
