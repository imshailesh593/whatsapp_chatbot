# User Guide: running your WhatsApp lead bot

For business owners and their team. No technical knowledge needed.

The bot answers the people who message your WhatsApp number. It asks them the questions you chose, saves each finished conversation as a **lead**, and tells you straight away. You follow up from the dashboard.

Contents

1. [Getting started](#1-getting-started)
2. [What your customers experience](#2-what-your-customers-experience)
3. [The dashboard at a glance](#3-the-dashboard-at-a-glance)
4. [Working your leads (CRM)](#4-working-your-leads-crm)
5. [Live inbox and taking over a chat](#5-live-inbox-and-taking-over-a-chat)
6. [When a customer asks for a person](#6-when-a-customer-asks-for-a-person)
7. [Booking appointments with Google Calendar](#7-booking-appointments-with-google-calendar)
8. [Setting up your bot](#8-setting-up-your-bot)
9. [Lead alerts](#9-lead-alerts)
10. [Broadcasts](#10-broadcasts)
11. [Analytics](#11-analytics)
12. [Connecting other tools](#12-connecting-other-tools)
13. [Your plan, codes and billing](#13-your-plan-codes-and-billing)
14. [Refer and earn](#14-refer-and-earn)
15. [Your team and roles](#15-your-team-and-roles)
16. [Good practice and WhatsApp safety](#16-good-practice-and-whatsapp-safety)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Getting started

### Create your account
Open your sign-in page and choose **Create an account**. Enter your business name, your email and a password (at least 10 characters). You become the **owner** of the account. Your bot starts **paused**, so it will not message anyone until you switch it on.

You get a free trial (14 days, plus any bonus days a referral link gave you) with everything in the Pro plan.

### Set up with the guided steps
After signing up, a short set-up walks you through five steps:

1. **Tell us about your business.** Choose a starting template (Real estate, Clinic, B2B services, Overseas careers or General), or, if the assistant is available, describe your business and let the AI propose the services and questions for you. You always review and confirm before anything is saved.
2. **Links and contact.** Add your booking link (for example a Calendly, Cal.com or Topmate page), an optional form link, and where alerts should go.
3. **WhatsApp connection.** Link the WhatsApp number your customers already message (see below).
4. **Chat with your bot.** Try it exactly like a customer. Nothing is sent to WhatsApp from this screen.
5. **Go live**, or keep the bot paused and finish later.

### Link your WhatsApp number
1. Open **Bot & Settings** and press **Connect WhatsApp** (or use step 3 of the set-up).
2. A QR code appears.
3. On the phone that holds your business number: open WhatsApp → **Settings → Linked devices → Link a device** and scan the QR code.
4. The status changes to **Connected**.

Notes:
- The number stays **your own** WhatsApp account. The bot works as a linked device, like WhatsApp Web.
- Scan within about 5 minutes. An unscanned code is released and you can press Connect again.
- If a message says **WhatsApp connections are full right now**, the service has no free slot at the moment. Try again later.
- Use **Disconnect** to unlink. Linking again needs a new scan.
- Keep the phone in normal use. If you log the device out from your phone, the bot stops and shows a new QR code.

### Go live
In **Bot & Settings**, press **Bot is paused · go live** and confirm. From then on the bot replies to everyone who messages your number. You can pause it again the same way.

---

## 2. What your customers experience

1. A customer sends any message. The bot greets them by your business name and shows a numbered **menu** of your services.
2. They reply with a number, or a word that matches a service (for example "rent" or "visa").
3. The bot asks your questions **one at a time**.
4. If they ask a side question (anything with a `?`), the AI answers using only the facts you wrote in your business notes, then repeats the pending question.
5. When the last question is answered, the customer gets your closing message with your booking link, and **you get a lead**.

Words customers can use at any time:

| They type | What happens |
|---|---|
| `menu`, `reset`, `restart`, `start` | The conversation starts again from the menu |
| `STOP` or `UNSUBSCRIBE` | They are removed from broadcasts. `START` or `MENU` brings them back |
| "talk to a person", "real human", "customer care" (and similar) | The bot hands the chat to you ([section 6](#6-when-a-customer-asks-for-a-person)) |
| "book an appointment" | They are offered real free times, if you linked Google Calendar ([section 7](#7-booking-appointments-with-google-calendar)) |
| "cancel appointment" | Their next appointment is cancelled |
| "I have already booked" | The lead moves to **Booked** |

The bot only handles one-to-one text chats. Groups and status updates are ignored, and a customer who sends a picture or voice note is asked to type instead.

---

## 3. The dashboard at a glance

Sign in at your dashboard address. The tabs across the top:

| Tab | What it is for |
|---|---|
| **Qualified Leads CRM** | Every contact and lead, with stages, owners, tags and follow-ups |
| **Live Inbox & Human Takeover** | Read conversations and reply yourself |
| **Bot Simulator** | Test the bot as a customer. Never sends to WhatsApp |
| **Analytics** | Funnel, sources, trends |
| **Broadcasts** | Send a message to many contacts, safely |
| **Bot & Settings** | Everything you configure |

The coloured strip under the header shows totals, and a banner tells you if the bot is paused, your trial is ending or WhatsApp is disconnected.

Agents (see [section 15](#15-your-team-and-roles)) only see the CRM, Inbox and Simulator.

---

## 4. Working your leads (CRM)

Each customer who finishes the questions becomes a lead. Open **Qualified Leads CRM**.

- **List and board.** Switch between a table and a board with one column per stage. Drag a card between columns, or change the stage from the lead's window.
- **Search and filter** by name, phone or place, and by service, stage, owner or tag. A counter shows how many follow-ups are due.
- **Open a lead** to see their answers, the whole message history and a **timeline** of everything that happened (stage changes, owner, notes, appointments, hand-offs).
- **Stage.** The default pipeline is New lead → Contacted → Follow-up → Booked → Won / Lost. Customize it under **Lead pipeline** in Bot & Settings. The bot moves a lead to **Booked** when the customer confirms a booking. It never pulls a Won or Lost lead back.
- **Owner.** Assign the lead to a team member.
- **Tags.** Short labels such as `hot` or `call-back`.
- **Follow-up date.** Pick a date and time. When it arrives you get one reminder alert.
- **Notes.** Private notes for your team.
- **Export.** Download the contacts as a CSV file.
- **Show simulator data.** Test chats are hidden unless you tick this.

Where a lead came from is shown as its **source** when they used a tagged chat link ([section 12](#12-connecting-other-tools)).

---

## 5. Live inbox and taking over a chat

**Live Inbox & Human Takeover** shows real message history per customer.

To reply yourself:
1. Open the customer's chat.
2. Press the **Bot Active** button to pause the bot **for that chat only**.
3. Type in the box and send. Your message goes out through your linked WhatsApp number.
4. When you are done, press the button again to hand the chat back to the bot.

From your phone you can do the same without the dashboard: in a customer's chat, send `!pause` to pause the bot for that customer and `!resume` to hand it back. Type these in that customer's chat on the linked phone.

Messages you type directly on the phone are not saved in the dashboard's thread.

---

## 6. When a customer asks for a person

If a customer writes something like "can I talk to a real person?", "connect me to an agent" or "customer care", the bot:

1. **Stops replying** in that chat.
2. Tells the customer a person will reply shortly.
3. Sends **you** a short AI briefing (who they are, what they want, what to do next) by WhatsApp and email, whichever you set up in [section 9](#9-lead-alerts).
4. Marks the chat **Needs a person** in the CRM and shows the briefing in the lead and in the inbox.

You then reply from your phone or the inbox. To give the chat back to the bot, press the bot button (or send `!resume`).

You can change the message the customer sees, or switch the feature off, in **Bot & Settings → Talk to a person**. The briefing counts as one AI answer against your plan.

---

## 7. Booking appointments with Google Calendar

Optional. Once connected, customers who have finished the questions can book real free times by themselves.

### Connect
1. Open **Bot & Settings → Appointments (Google Calendar)**.
2. Press **Connect Google Calendar** and approve access with the Google account whose calendar you use.
   - If you see "Google sign-in is not set up on this server yet", the service operator has not added Google keys. Ask them.
3. Set your rules and press **Save**:

| Setting | Meaning |
|---|---|
| Appointment length | Minutes per booking (10 to 240) |
| Break between | Gap kept before and after each booking |
| Opens / Closes | Daily booking hours, in your business time zone |
| Working days | Days of the week customers can book |
| Minimum notice | Fewest hours between now and a bookable time |
| Book up to | How many days ahead customers can book |
| Remind customer | Hours before the appointment to send a WhatsApp reminder (0 turns reminders off) |

Make sure your **time zone** is right in Business & bot. All times use it.

### How a booking happens
1. The customer says "book an appointment" (or "schedule", "available", and so on).
2. The bot offers up to five numbered times from your **real calendar**, skipping anything already busy.
3. The customer replies with a number. `MORE` shows later times.
4. The bot adds the event to your Google Calendar, confirms to the customer, moves the lead to **Booked** and alerts you.
5. Before the appointment, the customer gets a reminder.

Customers can reply `CANCEL APPOINTMENT`. You can also cancel from the list under **Upcoming appointments**, which tells the customer too. Two customers can never take the same time. Times offered more than 30 minutes ago are not booked by a late reply.

The Bot Simulator never adds real events to your calendar.

To stop, press **Disconnect**. Existing events stay in your calendar.

---

## 8. Setting up your bot

All under **Bot & Settings**. Changes apply to new messages straight away. Test every change in the **Bot Simulator**.

### Business & bot
- **Business name, tagline, description.** Shown in greetings and used by the AI.
- **Greeting line.** Shown under "Welcome to ...".
- **Tone and languages.** The AI replies in the customer's language and your tone.
- **Time zone.** Controls broadcast hours, appointment times and follow-up reminders.
- **Booking / payment link, what it is called, note.** Used in the closing message and when customers ask about booking.
- **Form to share.** Optional link added to the greeting.
- **Facts the AI may use.** The only source for prices, hours, policies and FAQs. If something is not written here, the AI will not invent it. Keep this accurate: it is the biggest factor in good answers.

### Menu & questions
- Up to 9 services. Each has a title, **keywords** (words that select it) and up to 12 questions.
- Start from a template or build your own. Reorder with the arrows. Save when done.
- Keep questions short and answerable in a sentence. Put the most important one first.

### Lead pipeline
Rename, recolor, add or remove stages. "New lead" and "Booked" are built in and cannot be removed. Mark a stage as won or lost so reports count it correctly.

---

## 9. Lead alerts

In **Bot & Settings → Lead alerts** enter:
- **WhatsApp number** (with country code, e.g. `919876543210`). Alerts are sent from your linked number, so connect WhatsApp first.
- **Email.** Email works only if the service has email switched on. If not, you will see a note saying so.

You are alerted when a customer finishes the questions, says they have booked, books an appointment, cancels one, or asks for a person. Press **Save & send a test alert** to check.

Some services send WhatsApp alerts from a shared platform number instead of yours. The alert then starts with your business name in brackets.

---

## 10. Broadcasts

Send one message to many of your contacts. Built to protect your number:

- Choose an **audience** by stage, service and how recently they were active. Only people who finished the questions are included unless you choose otherwise.
- **Preview** shows how many people will receive it.
- Write up to 1,000 characters. Use `{name}` to insert the customer's name. A line "Reply STOP to unsubscribe." is always added.
- Messages go out **slowly** (one every 8 to 20 seconds), only between **9:00 and 20:00** in your time zone, and no more than **150 a day**. A broadcast that is not finished continues the next morning.
- People who replied STOP are never included.
- Your plan has a monthly broadcast allowance. You can pause, resume or cancel a running broadcast.

Only message people who have contacted you or agreed to hear from you. Unwanted messages get numbers reported and restricted by WhatsApp.

---

## 11. Analytics

**Analytics** shows conversations and leads per day, the funnel (how many people reach each step), leads by pipeline stage, leads by service, results by campaign (your source tags) and where customers give up in the questions. Use it to find the question that loses people.

---

## 12. Connecting other tools

Under **Bot & Settings**. Included with your plan.

- **Click-to-chat links.** Ready-made `wa.me` links for your website, ads and posters. Add a tag (for example `summer24`) and every lead from that link is recorded with that source, visible in the CRM and Analytics.
- **Webhooks.** Give us a web address and we send it a JSON message whenever a lead is created or changes stage. Each request is signed (`X-Signature`, an HMAC-SHA256 of the body using your webhook secret) and failures are retried. Works with Zapier, Make, n8n, your own server, or a Google Sheet (a ready-made Apps Script is provided). Up to 5 webhooks.
- **REST API.** Read leads and change their stage from your own systems. Create a key (starts with `lk_`) and send it as `Authorization: Bearer lk_...`. Limit: 60 requests a minute. Up to 5 keys. Keep keys secret and delete any that leak.

---

## 13. Your plan, codes and billing

**Plan & billing** shows your plan, your usage this month and the status of your account.

There is one plan, **Pro**: ₹499 a month in India or $19 a month elsewhere. The dashboard shows the price in the currency for your country (worked out from your IP address); use the link under the price if it guessed wrong. It includes:

| New conversations / month | AI answers / month | Team members | Broadcast messages / month | Integrations |
|---|---|---|---|---|
| 1,500 | 2,000 | 5 | 1,000 | Yes |

Pro includes 1 WhatsApp number. The free trial (14 days) has the same limits.

**Language and follow-ups** (Bot & Settings → Business profile, section "Language and follow-ups"):
- *Ask the customer's preferred language first*: the first message asks for a language, and the menu, questions and replies are then written in it. Translation uses your monthly AI answers.
- *Follow up automatically*: customers who go quiet get a polite nudge one day and three days after their last message (daytime only). It stops when they reply, send STOP, you take over, or the lead is Won, Lost or Booked.
- Each menu option can have its own *closing message* (Menu & questions), for example with the right website link.
  Put the fees and what is included in it, so customers see them straight away. Add a line such as `[if profession ~ nurs]Recorded lectures are included.[/if]` to show a part only to some customers (it is kept when their answer to the question named `profession` contains "nurs"; separate several words with `|`).
- A long closing message can be sent as several WhatsApp messages: put a line with just `---` between the parts.
- The consultation link is sent only when a customer asks for more information (for example "more info", "book a consultation", "let's discuss"). A question about fees is answered, not redirected to the link.

What happens at a limit:
- **Conversations used up:** customers already chatting are still served, but new chats are not started until next month or an upgrade.
- **AI answers used up:** the bot keeps working with its fixed replies, without AI answers.
- **Trial or subscription ended:** the bot stops replying to customers. A paid subscription gets a 3-day grace period.

**Have a code?** If you were given a redeem code (a pilot, partnership or goodwill offer), type it under Plan & billing and press **Apply code**. It switches the plan on, or adds trial days, without a payment. Only the owner can do this, and each code works once per business.

**Paying online** (when your service has it switched on): owners choose a plan and pay in rupees (UPI AutoPay or card, through Razorpay) or dollars (PayPal, or card through Stripe).
- You pay on the payment provider's secure page, then come back to the dashboard. Your plan switches on as soon as the payment is confirmed, usually within a minute. Refresh the page if it still shows the trial.
- **It renews by itself every month.** If a renewal fails you keep working for a 3-day grace period; update your payment method or the bot will stop replying.
- **Cancel any time** from Plan & billing. You keep full access until the end of the period you paid for.
- A redeem code cannot replace a plan that is still running; use it once the plan has ended.
- If online payment is not on yet, contact your service provider to activate a plan.

---

## 14. Refer and earn

If your service runs a referral programme you will see **Refer & earn** in Bot & Settings.

- Copy your personal link and share it.
- A business that signs up through your link gets bonus trial days.
- You earn a percentage of what it pays for its first payments. The percentage and number of payments are shown on the card.
- Your earnings move from **waiting for approval** to **paid out** as the service approves and pays them.
- Add your payout details (UPI id, bank details, PayPal) so you can be paid. Only the owner can edit them.

For privacy, the businesses you referred are shown with shortened names.

---

## 15. Your team and roles

Add people under **Team** (bottom of Bot & Settings). Share their password privately. They can change it from the account menu.

| Role | Can do |
|---|---|
| **Owner** | Everything, including billing, codes, payout details and removing other owners |
| **Admin** | Change bot settings, broadcasts, integrations and team (not billing) |
| **Agent** | Work leads and reply in the inbox only. No settings, broadcasts or analytics |

Your plan limits the number of team members.

---

## 16. Good practice and WhatsApp safety

- **Use a number you can afford to risk.** This works through WhatsApp's linked-device feature, not the official business API. WhatsApp can restrict numbers that send unwanted or bulk messages. Never spam.
- **Keep broadcasts small, relevant and polite.** Honour STOP.
- **Reply fast to hand-offs.** A customer who asked for a person is waiting.
- **Keep your business notes current.** Update prices and hours the day they change.
- **Test after every change** in the Bot Simulator.
- **Keep the phone online** occasionally and the WhatsApp app updated.
- **Use strong passwords** and remove team members who leave.

---

## 17. Troubleshooting

| Problem | What to check |
|---|---|
| The bot does not reply | Is it paused (banner at the top)? Is WhatsApp **Connected**? Has your trial or plan ended? Did you use all conversations this month? |
| QR code will not scan | Refresh and press Connect again. Scan within 5 minutes. Update WhatsApp on the phone |
| "Connections are full right now" | The service has no free WhatsApp slot. Try later or contact your provider |
| WhatsApp shows Disconnected after working | The device was logged out from the phone. Connect and scan again |
| The AI gives a vague or wrong answer | Add the missing fact to **Facts the AI may use**. It will not guess |
| No alert arrived | Check the number format (country code, digits only), that WhatsApp is connected, and run **Send a test alert** |
| Alert email missing | Email may not be switched on for your service. WhatsApp alerts still work |
| A chat is silent | The bot is paused for that chat (human takeover or hand-off). Press the bot button to resume |
| Broadcast not sending | Outside 9:00 to 20:00 your time zone, daily cap reached, plan allowance used, or the audience is empty |
| Cannot book appointments | Calendar not connected, no free times in your working hours, or the customer has not finished the questions |
| "Google sign-in is not set up" | Ask the service operator to add the Google keys |
| Appointment times look wrong | Fix the **time zone** in Business & bot |
| Referral link not working | Sign-ups may be closed, or the programme may be switched off |
| Forgot password | Ask your account owner, or the service operator, to reset it |

If something still looks wrong, note what you did, what you expected and the time, and send it to your service provider.
