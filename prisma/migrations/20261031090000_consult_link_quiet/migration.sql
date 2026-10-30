-- Remember when the consultation link was sent, so the customer is left alone for a week afterwards.
ALTER TABLE "mns_sessions" ADD COLUMN "consult_link_sent_at" TIMESTAMP(3);
