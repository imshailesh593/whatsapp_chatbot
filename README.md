# WhatsApp Lead Bot

WhatsApp linked-device protocol via **Baileys** (no browser; QR-linked number) + PostgreSQL (Prisma) + Gemini for free-form questions,
with a React admin console at `/admin/`.
Slot-filling funnel: welcome → service (1-5) → one question at a time → lead saved → Topmate CTA.
Spec: [mns_institute_whatsapp_automation_blueprint.md](mns_institute_whatsapp_automation_blueprint.md)

## Branding

Nothing about the business is hard-coded in the UI or in the bot's greeting, sign-off and AI prompt. Set `BUSINESS_NAME`, `BUSINESS_TAGLINE`, `BUSINESS_DESCRIPTION` (and optionally `WELCOME_INTRO`, `FORM_URL`, `TOPMATE_URL`) in `.env`. The service menu and question sets live in `src/constants/questions.ts`.

## Admin console (`/admin/`)
Sign in with an admin email and password (add or remove admins under *Questionnaires & Settings*, change your own password from the account menu). Everything runs on the live database:
- **Leads CRM**: every contact, search/filter, funnel progress, status (qualified / Topmate booked / follow-up), notes, CSV export.
- **Live Inbox & Human Takeover**: real message history; pause the bot for a chat and reply from the console (sent through the linked WhatsApp).
- **Bot Simulator**: chat with the real bot logic; nothing is sent to WhatsApp. Test data is hidden from CRM/stats/export unless "Show simulator data" is ticked.
- **Questionnaires & Settings**: the live question matrix, Topmate link, WhatsApp connection status.

QR for linking WhatsApp: `/qr?token=<ADMIN_TOKEN>`.

Create the first admin (or reset a forgotten password) on the server:
```sh
docker compose exec bot node dist/cli/adminUser.js you@example.com 'a-long-password'
```
(or set `ADMIN_EMAIL` + `ADMIN_PASSWORD` in `.env` before first start).

## Run locally
```sh
docker run --name mns-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=mns_bot -p 5432:5432 -d postgres:16
cp .env.example .env          # set DATABASE_URL, GEMINI_API_KEY, ADMIN_TOKEN
npm install && npm --prefix web install
npx prisma migrate dev
npm run build:web             # builds the dashboard into web/dist
npm run dev                   # scan the QR in the terminal; dashboard at http://localhost:3000/admin/
```
Dashboard dev server with hot reload: `npm --prefix web run dev` (proxies the API to :3000).

Tests (need DATABASE_URL): `npx tsx scripts/e2e.ts` (full funnel), `npx tsx scripts/admin-test.ts` (dashboard API).

## Deploy (Docker)
```sh
cp .env.example .env          # fill GEMINI_API_KEY, ADMIN_TOKEN, POSTGRES_PASSWORD
docker compose up -d --build  # behind Coolify/Traefik also add: -f docker-compose.vps.yml (needs BOT_DOMAIN in .env)
```
Scan the QR once; the login lives in the `wa_session` volume (`/data/wa_auth`) so redeploys don't need a new scan.
Health check: `GET /health` returns `{ok, whatsapp: "ready"}`. The bot reconnects on its own; if the phone logs the device out, a new QR is generated.

## Behaviour
- `menu` / `reset` restarts the funnel. "3", "option 3", "jobs", "visa" all select a service.
- A question (contains `?`) mid-funnel or after completion is answered by Gemini, then the pending question is repeated. No `GEMINI_API_KEY` means static replies.
- Human takeover: from the console, or from the linked phone type `!pause` / `!resume` in a customer's chat.
- Only 1:1 text chats are handled; groups/status are ignored, media gets a "please type" reply.
- Messages typed by a human directly on the linked phone are not recorded in the console thread.

## Caveat
WhatsApp Web automation is unofficial and against WhatsApp's ToS; the number can be banned. Use a dedicated number, keep volume modest, and only reply to people who message first (this bot only replies).
