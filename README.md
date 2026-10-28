# MNS Institute WhatsApp Bot

Fastify + BullMQ (Redis) + Prisma (PostgreSQL) bot for the Meta WhatsApp Cloud API.
Slot-filling funnel: welcome → service selection (1-5) → one question at a time → lead saved → Topmate CTA.

Spec: [mns_institute_whatsapp_automation_blueprint.md](mns_institute_whatsapp_automation_blueprint.md)

## Run locally

```sh
docker run --name mns-postgres -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres:16
docker run --name mns-redis -p 6379:6379 -d redis:7
cp .env.example .env        # fill in WhatsApp token, phone number id, app secret
npm install
npx prisma migrate dev --name init
npm run dev
ngrok http 3000             # set https://<ngrok>/api/v1/whatsapp/webhook in Meta, subscribe to "messages"
```

`npm test` runs unit tests; `npm run build && npm start` for production.

## Notes
- POST webhook verifies `X-Hub-Signature-256` using `WHATSAPP_APP_SECRET` (requests without it are rejected).
- Jobs are deduplicated by WhatsApp message id; a per-user Redis lock serialises processing.
- Type `menu` / `reset` at any time to restart. Set `is_agent_paused` on a session to silence the bot for human takeover.
