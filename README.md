# MNS Institute WhatsApp Bot

WhatsApp **Web** (`whatsapp-web.js`, QR-linked number) + PostgreSQL (Prisma) + Gemini for free-form questions.
Slot-filling funnel: welcome → service (1-5) → one question at a time → lead saved → Topmate CTA.
Spec: [mns_institute_whatsapp_automation_blueprint.md](mns_institute_whatsapp_automation_blueprint.md)

## Run locally
```sh
docker run --name mns-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=mns_bot -p 5432:5432 -d postgres:16
cp .env.example .env          # set DATABASE_URL, GEMINI_API_KEY, ADMIN_TOKEN
npm install
npx prisma migrate dev
npm run dev                   # scan the QR in the terminal (or http://localhost:3000/qr?token=<ADMIN_TOKEN>)
```
Tests: `npx tsx scripts/e2e.ts` (full funnel on the real DB with a fake transport).

## Deploy (Docker, any host)
```sh
cp .env.example .env          # fill GEMINI_API_KEY, ADMIN_TOKEN, POSTGRES_PASSWORD
docker compose up -d --build
```
Open `https://<host>/qr?token=<ADMIN_TOKEN>` (or `docker compose logs -f bot`) and scan with WhatsApp → Linked devices.
The login is stored in the `wa_session` volume, so redeploys don't need a new scan. Back up/keep that volume.
Health check: `GET /health` → `{ok, whatsapp: "ready"}`. The process exits if WhatsApp disconnects; `restart: unless-stopped` brings it back.

## Behaviour
- `menu` / `reset` restarts the funnel. Replies like "3", "option 3", "jobs", "visa" select a service.
- A question (contains `?`) mid-funnel or after completion is answered by Gemini, then the pending question is repeated. No `GEMINI_API_KEY` → static replies.
- Human takeover: from the linked phone, type `!pause` in a customer's chat to silence the bot there, `!resume` to re-enable.
- Only 1:1 text chats are handled; groups/status are ignored, media gets a "please type" reply.

## Caveat
WhatsApp Web automation is unofficial and against WhatsApp's ToS; the number can be banned. Use a dedicated number, keep volume modest, and don't message people who haven't contacted you first (this bot only replies).
