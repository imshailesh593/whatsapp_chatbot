# Owner Guide: running the platform

For the person who operates the service: you host it, add businesses, set plans and keep it healthy. (Businesses that use the product have their own [User Guide](USER_GUIDE.md).)

Contents

1. [How the system fits together](#1-how-the-system-fits-together)
2. [Your platform admin account](#2-your-platform-admin-account)
3. [The platform admin pages](#3-the-platform-admin-pages)
4. [Adding and managing businesses](#4-adding-and-managing-businesses)
5. [Plans, trials and redeem codes](#5-plans-trials-and-redeem-codes)
6. [Opening sign-ups](#6-opening-sign-ups)
7. [Capacity: how many WhatsApp numbers fit](#7-capacity-how-many-whatsapp-numbers-fit)
8. [Referral programme](#8-referral-programme)
   - [The public website and policies](#8b-the-public-website)
9. [Settings you control with environment variables](#9-settings-you-control-with-environment-variables)
10. [Setting up the optional services](#10-setting-up-the-optional-services)
11. [Deploying and updating](#11-deploying-and-updating)
12. [Backups and restore](#12-backups-and-restore)
13. [Monitoring and routine checks](#13-monitoring-and-routine-checks)
14. [Security checklist](#14-security-checklist)
15. [Risks you should understand](#15-risks-you-should-understand)
16. [Support playbook](#16-support-playbook)
17. [Troubleshooting](#17-troubleshooting)
18. [Testing before a release](#18-testing-before-a-release)

---

## 1. How the system fits together

- **One server program** (Node.js) serves the dashboard at `/admin/`, handles WhatsApp, runs background workers and talks to the database. It runs in Docker next to a **PostgreSQL** database.
- **Each business is a workspace.** It has its own menu and questions, leads, team, plan and its **own linked WhatsApp number**. One WhatsApp session per business is kept open on the server (about 115 MB of memory each). Their login is stored in the `wa_session` volume, so a restart does not need a new QR scan.
- **WhatsApp connection is QR mode** (linked device, like WhatsApp Web), not the official Meta Cloud API. It needs no Meta approval, but it is an unofficial route (see [section 15](#15-risks-you-should-understand)).
- **Gemini** (Google's AI) writes answers to side questions, runs the onboarding assistant and writes hand-off briefings. Without a key the bot still works with fixed replies.
- **Background workers** handle broadcasts, webhook retries, follow-up reminders and appointment reminders.
- **Your own business** (the original one) is the workspace called `default-workspace` on the `internal` plan: unlimited and never billed. Platform messages can optionally be sent from its number ([section 3](#3-the-platform-admin-pages), Settings).

---

## 2. Your platform admin account

A platform admin sees every business and gets the extra **Platform admin** area. Anyone with that flag has full power over all customers, so keep the list short.

- Sign in at `https://<your-domain>/admin/` with email and password.
- Switch between **Platform admin** and **My business** from the sidebar.
- Create or reset an admin from the server (this also works if you are locked out):
  ```sh
  docker exec <bot-container> node dist/cli/adminUser.js you@example.com 'a-long-password'
  ```
  The account is created as a platform admin of the default workspace. (You can also set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before the very first start.)
- **Change any password that has been shared in a chat or email.** Passwords need at least 10 characters.

---

## 3. The platform admin pages

| Page | What it is for |
|---|---|
| **Dashboard** | Revenue and MRR, active subscriptions, clients, users, messages, contacts, conversations, revenue and growth charts for 7, 30 or 90 days, and the **WhatsApp slots** strip |
| **Client Management** | Every business: filter, add, open details, set plan, pause the bot, reset passwords, continue as the owner, delete |
| **Subscriptions** | Businesses on paid plans and when each period ends |
| **Payments** | The last 100 payments across all businesses |
| **Plans** | The plans, prices and limits, read-only (see [section 5](#5-plans-trials-and-redeem-codes)) |
| **Redeem codes** | Create codes that give a business a plan or extra trial days without a payment |
| **Affiliates** | The referral programme: rules, who is owed what, approving and recording payouts |
| **Audit log** | Everything you and other platform admins did: adding or deleting businesses, plan changes, impersonation, settings, codes and payouts |
| **Settings** | The platform-number switch and the WhatsApp slot limit |

**Platform-number switch (Settings).** When on, lead alerts and follow-up reminders for businesses are sent from your own WhatsApp number (the default workspace's), labelled with the business name, instead of from each business's number. Turn it on only if your number is connected and you accept the volume.

---

## 4. Adding and managing businesses

### A business signs itself up
When sign-ups are open ([section 6](#6-opening-sign-ups)) they use **Create an account**. The new business starts on a free trial with its bot paused and walks through onboarding.

### You add one yourself
**Client Management → Add a business → Create business.** Enter the business name, the owner's email and a starting password (10+ characters). Give the owner the password privately and ask them to change it. They then link their own WhatsApp number from the dashboard.

### What you can do to a business
Open a business to see its plan, limits, people and WhatsApp status, then:
- **Set plan (no payment needed):** pick a plan and a number of days, then **Apply** ([section 5](#5-plans-trials-and-redeem-codes)).
- **Pause or resume the bot:** the switch on the business's row in the list stops all automated replies for that business.
- **Reset a person's password** or **remove a person** from the People list.
- **Continue as this business owner** lets you see exactly what they see. This is written to the audit log. Your own session is replaced, so sign out and back in to return to your account. Use it to help, not to browse.
- **Delete:** removes the business and everything it owns (chats, leads, team, calendar link, WhatsApp link). You must type the exact business name to confirm. This cannot be undone, so take a backup first if in doubt. You cannot delete your own business.

---

## 5. Plans, trials and redeem codes

There is **one plan, Pro**: **₹499 a month for customers in India** (paid in rupees through Razorpay) and **$19 a month for everyone else** (paid in dollars through PayPal or Stripe).

| Plan | Price per month | New conversations | AI answers | Team members | Broadcast messages | Integrations |
|---|---|---|---|---|---|---|
| Free trial (14 days) | free | 1,500 | 2,000 | 5 | 1,000 | Yes |
| Pro | ₹499 in India, $19 elsewhere | 1,500 | 2,000 | 5 | 1,000 | Yes |

Businesses that were on the older Starter, Growth or Scale plans are treated as Pro.

- Counters reset each calendar month. At a limit, existing chats continue but new chats (or AI answers, or broadcasts) stop, as described in the User Guide.
- A lapsed trial or subscription stops the bot from replying. A paid subscription gets a **3-day grace period**.
- **Prices and limits live in `src/plans.ts`.** Changing them means editing that file and redeploying. The Plans page only displays them. Payment-provider plans (Stripe prices, Razorpay plans) must be changed to match.
- The `internal` plan is unlimited and not billed. Use it only for your own business.

### Giving access without a payment
Two tools, both audited:
1. **Change plan** on a business (immediate, you choose the days).
2. **Redeem codes** (Redeem codes page): choose a plan, a number of days and how many times the code can be used (or unlimited), optionally a custom code and a note. Hand the code to the customer; they enter it under **Plan & billing → Have a code?**.
   - "Extend free trial" adds days on top of whatever trial remains.
   - A paid plan code starts that plan for the days you set.
   - Each business can use a code once. A business that already pays by card or UPI cannot redeem a code (you can still change its plan manually).
   - Disable a code to stop it being used, or delete it. Existing grants stay.

---

## 6. Opening sign-ups

Sign-up is controlled by `SIGNUP_ENABLED` in the server `.env`:
- `SIGNUP_ENABLED=0`: public sign-up is **off**. Businesses can only be added by you. (This is how the live server is set now.)
- Anything else (or unset): the **Create an account** form is available to anyone who finds your sign-in page.

Before opening it:
1. Run a full test business end to end: sign up, onboard, link a spare WhatsApp number, finish a chat, receive the alert.
2. Decide how you will take payment ([section 10](#10-setting-up-the-optional-services)). Until payments are on, trials will expire with no way to pay except you granting plans or codes.
3. Check capacity ([section 7](#7-capacity-how-many-whatsapp-numbers-fit)).
4. Read [section 15](#15-risks-you-should-understand).

After editing `.env`, restart the bot container for the change to take effect. Sign-ups are limited to 5 per network address per hour.

---

## 7. Capacity: how many WhatsApp numbers fit

Each linked number holds a live session. The Dashboard strip **WhatsApp slots** shows `used of max`, the bot's memory use and the server's free memory. The strip turns amber at 80% and red when full.

- The maximum defaults to **20** (or `WA_MAX_CONNECTIONS` if set). Change it in **Settings → How many WhatsApp numbers this server holds** (1 to 500).
- When all slots are used, a customer who presses Connect sees "WhatsApp connections are full right now" and no session starts. Each refusal is written to the audit log (`wa.slots_full`) so you can see demand. Businesses already linked are never affected, and they reconnect by themselves after a restart.
- A QR code nobody scans frees its slot after 5 minutes.
- Rule of thumb: about 115 MB per number, plus the database and your other apps on the same server. Raise the limit only after checking free memory on the dashboard. Move to a bigger server before you run out.

---

## 8. Referral programme

**Affiliates** page. It is **off** until you switch it on.

- **Rules:** commission % (default 20), the number of payments it applies to (default the first 12) and bonus trial days for the new business (default 7). Save changes with **Save**.
- Every business has a personal link ending `/admin/?ref=CODE`. A visitor who opens it sees the sign-up form; a business created that way is recorded as referred and gets the bonus days. Unknown or switched-off codes are ignored and never block sign-up.
- When a referred business **pays**, its referrer earns a commission, status **pending**. Nothing is earned from trials, codes or manual plan changes, and a business never earns from its own payments.
- Your job: **Approve** a commission, send the money yourself using the payout details shown (UPI, bank, PayPal), then **Mark paid**. A paid commission is final. **Void** cancels one (for example after a refund).
- Referral links need sign-ups to be open ([section 6](#6-opening-sign-ups)). Commissions need online payments ([section 10](#10-setting-up-the-optional-services)).

---

## 8b. The public website

The server also serves a public website on the same domain: a **landing page** at `/` (features, how it works, pricing, FAQ), and the pages **Privacy Policy** (`/privacy`), **Terms & Conditions** (`/terms`), **Refund & Cancellation Policy** (`/refunds`) and **Contact** (`/contact`). The footer on every page reads "© <year> Rajni" and says the service is operated by Rajni (change with `OPERATOR_NAME`). The dashboard stays at `/admin/`. The sign-in screen links the same policies.

- Set these in `.env` and restart: `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `BUSINESS_ADDRESS`, optionally `SUPPORT_HOURS` and `LEGAL_JURISDICTION` (for example "Pune, Maharashtra"). They appear on the Contact page and at the end of each policy. Fields you leave empty are simply not shown, so **fill in at least the email and an address before applying for payment-provider approval**, which checks that these are visible.
- Prices on the landing page come from `src/plans.ts`, so they always match the dashboard. The sign-up buttons say "Start your 14-day free trial" while sign-up is open and "Open the dashboard" when `SIGNUP_ENABLED=0`.
- The policies are **drafts written for this service, not legal advice**. Read them, change any rule you do not want to keep (especially the 7-day first-payment refund window, the 90-day backup retention and the jurisdiction), and have a lawyer check them before relying on them. The text lives in `src/site.ts`; edit and redeploy.
- Search engines are told to skip the dashboard. A sitemap is at `/sitemap.xml`.

---

## 9. Settings you control with environment variables

Kept in the `.env` file on the server (never committed to git). Restart the bot after changes. The commented file `.env.example` is the master list.

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `POSTGRES_PASSWORD` | Database connection |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | AI answers, onboarding assistant, hand-off briefings (model default `gemini-3.8-flash`) |
| `ADMIN_TOKEN` | Opens the legacy WhatsApp QR page `/qr?token=...` for the default workspace |
| `SESSION_SECRET` | Signs login cookies and protects stored Google tokens. Long and random. Changing it logs everyone out and disconnects every linked Google Calendar |
| `OPERATOR_NAME`, `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `BUSINESS_ADDRESS`, `SUPPORT_HOURS`, `LEGAL_JURISDICTION` | Names and contact details shown on the public website and policies ([section 8b](#8b-the-public-website)). `OPERATOR_NAME` defaults to Rajni |
| `BOT_DOMAIN`, `BOT_DOMAIN_ALT` | Domain names for the proxy and certificates |
| `PUBLIC_URL` | The address used in links and callbacks (set it to your real `https://` address) |
| `PRODUCT_NAME` | Name on the sign-in screen |
| `SIGNUP_ENABLED` | `0` closes public sign-up |
| `WA_MAX_CONNECTIONS` | Starting WhatsApp slot limit (the Settings page overrides it) |
| `BROADCAST_DAILY_CAP` | Daily broadcast messages per business (default 150) |
| `RESEND_API_KEY`, `MAIL_FROM` | Email through Resend (see below) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email through plain SMTP, used only if no Resend key |
| `STRIPE_*`, `RAZORPAY_*` | Online payments (see below). `RAZORPAY_MODE=link` switches Razorpay from recurring subscriptions to 30-day payment links |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar booking (see below) |
| `BUSINESS_NAME`, `BUSINESS_TAGLINE`, `BUSINESS_DESCRIPTION`, `WELCOME_INTRO`, `FORM_URL`, `TOPMATE_URL` | Seed values for the default workspace, used only the first time |
| `ALLOW_HTTP_WEBHOOKS` | Development only. Never set in production |

---

## 10. Setting up the optional services

None of these are required to run. Each is off until you add its keys.

### Email with Resend
Used for lead and hand-off alert emails.
1. Create a Resend account and **verify your sending domain**.
2. Create an API key.
3. In `.env` set `RESEND_API_KEY=...` and `MAIL_FROM="Your Brand <alerts@yourdomain.com>"`.
4. Restart. Businesses that entered an alert email now receive email. Check with **Save & send a test alert** in a business's Lead alerts.

If a send fails, the alert test shows the provider's message (for example "domain not verified"). Alerts through WhatsApp do not depend on email.

### Google Calendar booking
1. In Google Cloud Console, create a project and **enable the Google Calendar API**.
2. Set up the OAuth consent screen. Add your own account as a test user while testing. To let any customer connect their calendar you must publish the app, and Google may require a verification review because the calendar scope is sensitive.
3. Create an **OAuth client ID**, type **Web application**. Add this authorised redirect URI exactly: `https://<your-domain>/admin/api/calendar/callback` (it must match `PUBLIC_URL`).
4. Put the ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, make sure `PUBLIC_URL` is set, and restart.
5. In a test business: Bot & Settings → Appointments → Connect Google Calendar.

Each business connects its own Google account. Their refresh token is stored encrypted. Disconnecting revokes it at Google.

### Online payments (when you are ready)
Payments are built but off. Add keys to switch them on. They apply to a business that pays itself; plans you grant, and redeem codes, never need them.

- **PayPal** (dollars: PayPal balance or card). Recurring monthly subscriptions that renew by themselves.
  1. **Credentials.** developer.paypal.com → Apps & Credentials → choose **Live** (or Sandbox to test) → your app → copy the Client ID and Secret. Put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MODE=live` (or `sandbox`) in the server `.env`. Your PayPal business account must have **Subscriptions** available.
  2. **Plan and webhook, in one step.** On the server run `docker exec <bot-container> node dist/cli/paypalSetup.js`. It creates the $19 monthly plan in PayPal, registers the webhook `https://<your-domain>/webhooks/paypal` with the events we use, and prints two lines: `PAYPAL_PLAN_PRO=P-...` and `PAYPAL_WEBHOOK_ID=...`. Paste them into `.env` and restart. It is safe to repeat: PayPal returns the same plan and the same webhook rather than making duplicates.
  3. Open **Platform admin → Settings → Payments setup** and press **Check connections**. Every PayPal line must show a tick.
  4. How it behaves: the owner approves the subscription on PayPal; the webhook (`BILLING.SUBSCRIPTION.ACTIVATED`, then `PAYMENT.SALE.COMPLETED` for each monthly charge) switches the plan on and sets its end to PayPal's next billing date. A failed payment puts the plan in a 3-day grace period; cancelling stops future charges and access continues to the end of the paid period. Every webhook is checked with PayPal before it is trusted, and repeats are counted once.
  5. Rotate the client secret in the PayPal dashboard if it was ever shared, and then update `.env`.
- **Stripe** (dollars): create one recurring monthly Price, then set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO`. Add a webhook to `https://<your-domain>/webhooks/stripe` with these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
- **Razorpay** (rupees: UPI AutoPay, cards, netbanking). Recurring monthly subscriptions that renew by themselves. Needs your Razorpay account to be activated, which is when Razorpay issues live API keys.
  1. **Keys.** Razorpay Dashboard → Account & Settings → API keys → generate. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the server `.env`. Start with **Test mode** keys (they begin `rzp_test_`); no real money moves. Check that **Subscriptions** is enabled on your account.
  2. **Plans.** On the server run once: `docker exec <bot-container> node dist/cli/razorpaySetup.js`. It creates the monthly plan in Razorpay with exactly your price (₹499) and prints one line, `RAZORPAY_PLAN_PRO=plan_...`. Paste them into `.env`. **Run it only once**: Razorpay cannot delete plans, so a second run with the lines missing would create duplicates (plans already in `.env` are never recreated).
  3. **Webhook.** Dashboard → Account & Settings → Webhooks → Add: URL `https://<your-domain>/webhooks/razorpay`, choose a secret, tick these events: `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.resumed`. Put the secret in `RAZORPAY_WEBHOOK_SECRET`.
  4. Restart the bot, then open **Platform admin → Settings → Payments setup** and press **Check connection with Razorpay**. Every line must show a tick. It proves the keys work and that each plan exists with the right price and monthly period. The page also shows the exact webhook address to enter.
  5. Test in Test mode: as an owner choose a plan, pay with Razorpay's test card or UPI, and watch the plan switch on. **Payments** and **Subscriptions** show the result. Then replace the test keys, plan ids and webhook secret with live ones (the plan ids differ between test and live, so run the plan step again in live mode, once).
  - How it behaves: the owner is sent to Razorpay's hosted page to authorise the subscription. When Razorpay confirms (`subscription.activated` or `charged`), the plan switches on and its end date follows Razorpay's billing period. Each monthly charge extends it. A failed renewal puts the plan in a 3-day grace period (past due); success restores it; if Razorpay gives up (`halted`) or the owner cancels, the bot stops replying once the paid period ends. Cancelling stops renewal at the end of the period already paid for.
  - Duplicate webhooks and repeated payments are counted once. Referral commissions are created for each recorded payment.
  - Price or plan changes: edit `src/plans.ts`, create new plans in Razorpay (a plan's price cannot be edited) and update the `RAZORPAY_PLAN_*` lines. Existing subscribers stay on the old Razorpay plan until they resubscribe.
  - **Alternative, payment links** (`RAZORPAY_MODE=link`): sells 30 days at a time instead of a subscription. It needs only the keys and a webhook with the event `payment_link.paid`; no plans. The plan does not renew by itself, so the owner pays again (they are sent a fresh link 3 days before the end). Use it only if you prefer not to run subscriptions.
- Webhooks are verified by signature and processed once even if the provider repeats them.
- Test with the providers' test modes before going live. Check **Payments** and **Subscriptions** afterwards.

### Gemini
Create the key in Google AI Studio under the account that will pay for it. If the AI suddenly stops answering, check billing and credits on that account first. The app calls the model with thinking switched off to keep answers short; Gemini may still use some thinking tokens, so the output limits are set generously.

---

## 11. Deploying and updating

The live server layout: the app lives in `/srv/mns-whatsapp-bot` on the VPS and runs as Docker Compose project `mnsbot` behind the existing Traefik proxy (so it does not disturb other apps on the host).

**Before every update that includes database changes, take a backup** ([section 12](#12-backups-and-restore)). Database changes are applied automatically when the container starts ("migrations").

From your computer, in the project folder, on a branch that passes all tests:

```sh
git archive -o bot.tar HEAD
scp -i <ssh-key> bot.tar root@<server>:/tmp/bot.tar
ssh -i <ssh-key> root@<server> "tar -x -C /srv/mns-whatsapp-bot --exclude=.env -f /tmp/bot.tar && cd /srv/mns-whatsapp-bot && docker compose -p mnsbot -f docker-compose.yml -f docker-compose.vps.yml up -d --build bot"
```

Notes:
- Do **not** pipe `git archive` straight into `ssh` from Windows PowerShell: the pipe corrupts the archive. Use the file route above, or run the one-line pipe from Git Bash.
- Extracting an archive **never deletes** files that were removed in code. If you deleted a source file, delete it on the server too, or the build may fail.
- `--exclude=.env` keeps the server's secrets untouched.
- Afterwards check `https://<your-domain>/health` returns `{"ok":true,"whatsapp":"ready",...}` and that your linked numbers show Connected. The WhatsApp login survives restarts.

**Rolling back:** deploy the previous commit the same way. If a database change must be undone, restore the backup you took.

### Running it on a new server
```sh
cp .env.example .env       # fill in secrets
docker compose up -d --build
```
Add `-f docker-compose.vps.yml` and `BOT_DOMAIN` when using a Coolify/Traefik proxy. Create the first platform admin with the command in [section 2](#2-your-platform-admin-account). Keep the `wa_session` volume (linked WhatsApp logins) and the database volume on persistent storage.

---

## 12. Backups and restore

**Back up** (database only, a single compressed file):
```sh
ssh -i <ssh-key> root@<server> 'cd /srv/mns-whatsapp-bot && docker compose -p mnsbot -f docker-compose.yml -f docker-compose.vps.yml exec -T db pg_dump -U postgres -Fc mns_bot > backups/backup-$(date +%F-%H%M).dump'
```
Check the file is not empty (`ls -la backups`). Keep copies **off the server** too.

**Restore** (this replaces current data, so stop and think first):
```sh
docker compose -p mnsbot -f docker-compose.yml -f docker-compose.vps.yml exec -T db pg_restore -U postgres -d mns_bot --clean --if-exists < backups/<file>.dump
```
then restart the bot.

**WhatsApp logins** are not in the database: they are in the `wa_session` volume. Without a copy of that volume, every business must scan its QR code again after a disaster. Snapshot the volume if you can.

Schedule a daily backup (cron) once real customers are on the system.

---

## 13. Monitoring and routine checks

- **Health:** `GET /health` returns `{ok, whatsapp, connections: {total, ready}}`. Point an uptime monitor at it.
- **Logs:** `docker compose -p mnsbot -f docker-compose.yml -f docker-compose.vps.yml logs --tail 100 bot`. Look for `[wa ...]` lines (connections), `[calendar]`, `[alerts]`, `[Gemini]`.
- **Dashboard:** WhatsApp slots and memory strip, subscriptions, payments.
- **Audit log:** review weekly for anything you do not recognise.

Weekly: check free memory and slots, glance at the audit log, confirm backups exist and are non-empty. Monthly: test a restore on a spare machine, review pending commissions, update dependencies and WhatsApp library versions on a test copy first.

---

## 14. Security checklist

- Change every password that was ever pasted in chat or email; use a password manager.
- Rotate the VPS root password and any hosting API tokens that were shared. Prefer SSH keys and disable password login.
- Use long random values for `SESSION_SECRET`, `ADMIN_TOKEN` and `POSTGRES_PASSWORD`. Never commit `.env`.
- Keep platform admin accounts few. Sign-in as owner is logged.
- Keep sign-up closed until you have tested and decided to open it.
- The database port is not published to the internet. Keep it that way.
- Webhook URLs customers enter are checked so they cannot point at your internal network.
- Keep the server, Docker and the app updated. Back up before updates.
- Customer chats and phone numbers are personal data. Have a privacy policy, delete a business's data on request (Client Management → Delete) and limit who can sign in as owner.

---

## 15. Risks you should understand

- **WhatsApp can restrict or ban numbers** that use unofficial linked-device automation, especially for bulk or unwanted messaging. A banned number belongs to the customer. Tell customers this plainly (the onboarding screen does), recommend a dedicated business number, and keep broadcast limits conservative. The built-in slow pacing, daytime window, daily cap and STOP handling reduce but do not remove the risk.
- **The unofficial library can break** when WhatsApp changes its protocol. Expect occasional updates.
- If you later need guaranteed delivery and no ban risk, the answer is the official WhatsApp Business Cloud API. That is not built yet.
- **Single server:** one machine runs everything. A reboot disconnects numbers briefly (they reconnect themselves). Plan capacity and backups accordingly.

---

## 16. Support playbook

| Customer says | Do |
|---|---|
| "I cannot log in" | Client Management → business → People → reset the owner's password. Passwords are 10+ characters |
| "The bot is not replying" | Open the business: is the bot paused, WhatsApp connected, plan active, limits reached? Then continue as the owner and check the Simulator |
| "WhatsApp keeps disconnecting" | The phone was logged out of linked devices, or the account was restricted. Ask them to reconnect and scan again |
| "Connections are full" | Check the slots strip and audit log. Raise the limit if memory allows |
| "My trial ended" | Give a redeem code or change plan, or point them to payment when it is on |
| "Email alerts do not arrive" | Check Resend is set up and the domain verified, then run a test alert for them |
| "Calendar will not connect" | Check Google keys, the redirect URI and consent screen status ([section 10](#10-setting-up-the-optional-services)) |
| "Delete my data" | Client Management → Delete, after a backup if required by your policy |

---

## 17. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Build fails on the server about a missing file or type | A removed source file is still on the server. Delete it there and rebuild |
| Deploy from PowerShell fails with tar errors | The pipe corrupted the archive. Use the `.tar` + `scp` route |
| Container restarts repeatedly | Read the logs. A migration may have failed: restore the backup and fix before retrying |
| `/health` shows `whatsapp: off` for the default number | Re-link at `/qr?token=<ADMIN_TOKEN>` or from the dashboard |
| AI stopped answering | Gemini billing or credits ran out, or the key was revoked |
| Alert email fails | Resend domain not verified, or `MAIL_FROM` missing. Without `MAIL_FROM` email is treated as not set up |
| Google "redirect_uri_mismatch" | The redirect URI in Google Cloud does not exactly match `https://<your-domain>/admin/api/calendar/callback` |
| All Google calendars suddenly disconnected | `SESSION_SECRET` was changed. Businesses must reconnect |
| Webhook from Stripe or Razorpay rejected | Wrong signing secret, or the body was altered by a proxy |
| Razorpay payment taken but plan not switched on | The webhook is not reaching the server or has the wrong secret. Check Razorpay Dashboard → Webhooks → recent deliveries, and Settings → Payments setup |
| Payments setup says a plan "must match" | The price in Razorpay differs from `src/plans.ts`. Create a new plan in Razorpay with the right price and update the `RAZORPAY_PLAN_*` line |
| Slots show full but few customers | Numbers stuck in "linking". Restart the bot, or raise the limit |
| Memory climbing | Count linked numbers on the dashboard, lower the limit or add RAM |

---

## 18. Testing before a release

Run on your computer with a test database (`DATABASE_URL`):

```sh
npx tsc --noEmit                      # type check
npm run build:web                     # build the dashboard
npx tsx scripts/e2e.ts                # bot conversation, alerts, hand-off, limits
npx tsx scripts/admin-test.ts         # dashboard API, platform admin, codes, referrals, calendar routes
npx tsx scripts/broadcast-test.ts     # broadcasts
npx tsx scripts/integration-test.ts   # webhooks and REST API
npx tsx scripts/calendar-test.ts      # Google Calendar booking against a fake Google
npx tsx scripts/smoke-test.ts <dir>   # real browser walk-through, saves screenshots to <dir>
```
All of them must pass before deploying. The smoke test needs Edge or Chrome (set `BROWSER_PATH` if it is installed elsewhere).
