# MNS Institute & MNS Institute Jobs — WhatsApp Conversational Bot Specification & Developer Guide

**Target System:** Meta WhatsApp Cloud API (or official BSP like Twilio/Wati/Gupshup)  
**Client Entity:** MNS Institute & MNS Institute Jobs  
**Booking Link:** `https://topmate.io/mnsinstitute/`  
**Architecture Style:** Deterministic state-machine (slot-filling questionnaire) combined with an LLM fallback handler for FAQs.

---

## 1. System Conversation Architecture

The workflow follows a 5-stage funnel designed to convert cold inbound leads into qualified candidates and booked Topmate consultations:

```
[01. Welcome & Language]
           │
           ▼
[02. Service Selection (1-5)]
           │
           ├── 1 ──▶ Coaching & Exam Prep Branch (5 Questions)
           ├── 2 ──▶ Medical Licensing Branch (6 Questions)
           ├── 3 ──▶ International Jobs Branch (7 Questions)
           ├── 4 ──▶ Visa & PR Branch (5 Questions)
           └── 5 ──▶ Other / General Enquiry Branch (3 Questions)
           │
           ▼
[03. Step-by-Step Slot-Filling Questionnaire (One Question at a Time)]
           │
           ▼
[04. Lead Classification & CRM Tagging]
           │
           ▼
[05. Next Action & Consultation CTA (Topmate Integration)]
```

> **Critical UX Rule:** Do **not** send all questionnaire questions in one wall of text. The bot must ask questions **one by one**, validate the answer, persist it to the session state, and then ask the subsequent question.

---

## 2. Complete WhatsApp Message Copy & Scripts

### Step 1: Welcome & Service Selection

**Trigger:** Any incoming text (e.g., "Hi", "Hello", "Info", or initial ad click).

```text
Hello 👋 Welcome to MNS INSTITUTE & MNS INSTITUTE JOBS! 🌍

We help students and professionals with international exam preparation, medical licensing, overseas job opportunities, and Visa/PR guidance.

To assist you better, please select the service you are looking for:

1️⃣ Coaching & Exam Preparation
2️⃣ Medical Licensing
3️⃣ International Jobs
4️⃣ Visa & Permanent Residency (PR)
5️⃣ Other Enquiry

Please reply with the option number (1-5). 😊
```

*(Interactive alternative: Send as an interactive List Message with title "Select Service").*

---

### Step 2: Service-Specific Branch Questionnaires

#### Branch 1: Coaching & Exam Preparation (`COACHING`)

* **Q1:** `Which exam or course do you need coaching for? (e.g., IELTS, OET, NCLEX, Prometric, PLAB, etc.)`
* **Q2:** `What is your current profession or educational background?`
* **Q3:** `What is your current preparation level? (Beginner / Intermediate / Already attempted once)`
* **Q4:** `When are you planning to appear for the exam? (e.g., Within 1 month, 3 months, 6+ months)`
* **Q5:** `Which language would you prefer for your coaching guidance? (English / Hindi / Other)`

---

#### Branch 2: Medical Licensing (`LICENSING`)

* **Q1:** `What is your medical profession and specialization? (e.g., Registered Nurse, General Physician, Dentist, Pharmacist, Lab Tech)`
* **Q2:** `What is your highest qualification? (e.g., GNM, B.Sc Nursing, MBBS, MD, B.Pharm)`
* **Q3:** `How many years of relevant clinical/work experience do you have?`
* **Q4:** `Which country or licensing authority do you want to get licensed in? (e.g., DHA/MOH/HAAD UAE, Saudi SCFHS, UK NMC, USA NCLEX, Qatar QCHP)`
* **Q5:** `Do you currently hold an active, valid professional registration/license in your home country? (Yes / No)`
* **Q6:** `Have you already completed Dataflow verification, credential evaluation, or any eligibility assessment? (Yes / Not yet)`

---

#### Branch 3: International Jobs (`JOBS`)

* **Q1:** `What is your target profession or job role?`
* **Q2:** `What is your highest completed educational qualification?`
* **Q3:** `How many years of relevant work experience do you have in your field?`
* **Q4:** `Which country or region do you prefer to work in? (e.g., UK, Ireland, Gulf/Middle East, Germany, Canada, Australia)`
* **Q5:** `Do you hold a valid professional license, if required for your role? (Yes / No / Not Applicable)`
* **Q6:** `Have you completed any required language proficiency test (IELTS, OET, German A1-B2) or licensing exam? (Please specify score/status)`
* **Q7:** `Do you have any study or employment gaps in your career? (No / Yes - specify duration)`

---

#### Branch 4: Visa & Permanent Residency (PR) (`VISA_PR`)

* **Q1:** `Which country are you planning to migrate or move to?`
* **Q2:** `What is your current country of residence and citizenship?`
* **Q3:** `What is your primary visa purpose? (Study Visa / Work Permit / Permanent Residency (PR) / Family Visa / Visitor)`
* **Q4:** `What is your highest educational qualification and current occupation?`
* **Q5:** `Have you already initiated an application or filed an Expression of Interest (EOI)? (Yes / No)`

---

#### Branch 5: Other / General Enquiry (`GENERAL`)

* **Q1:** `Please describe briefly what service or guidance you are looking for.`
* **Q2:** `What is your profession, qualification, or current status?`
* **Q3:** `Which country or destination is relevant to your enquiry?`

---

### Step 3: Completion & Consultation Handoff Message

**Trigger:** Dispatched immediately upon answering the final question of any branch.

```text
Thank you for sharing your details! 🙌

Our team will review your requirements and guide you regarding the relevant process and next steps.

You can also schedule a one-to-one consultation with our senior consultant here:
👉 https://topmate.io/mnsinstitute/

If you have already booked a consultation, please let us know here. 

*Fees will be adjusted in the process.*

MNS INSTITUTE | Your Global Career Support Partner 🌍
```

---

## 3. Database Schema Design (PostgreSQL / Supabase)

```sql
-- 1. Conversation Sessions (Tracks progress in questionnaire)
CREATE TABLE mns_sessions (
    phone_number VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100),
    current_stage VARCHAR(30) DEFAULT 'WELCOME', -- WELCOME, IN_QUESTIONNAIRE, COMPLETED, AGENT_TAKEOVER
    selected_service VARCHAR(30),                 -- COACHING, LICENSING, JOBS, VISA_PR, GENERAL
    current_step INT DEFAULT 0,
    answers JSONB DEFAULT '{}'::jsonb,
    is_agent_paused BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Final Qualified Leads
CREATE TABLE mns_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) NOT NULL,
    service_category VARCHAR(30) NOT NULL,
    lead_score VARCHAR(10) DEFAULT 'WARM', -- HOT, WARM, COLD
    details JSONB NOT NULL,
    topmate_booked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_stage ON mns_sessions(current_stage);
CREATE INDEX idx_leads_service ON mns_leads(service_category);
```

---

## 4. State Machine Definition (Pseudo-Code)

```python
QUESTION_FLOWS = {
    "COACHING": [
        "Which exam or course do you need coaching for? (e.g., IELTS, OET, NCLEX, Prometric, PLAB, etc.)",
        "What is your current profession or educational background?",
        "What is your current preparation level? (Beginner / Intermediate / Already attempted once)",
        "When are you planning to appear for the exam? (e.g., Within 1 month, 3 months, 6+ months)",
        "Which language would you prefer for your coaching guidance? (English / Hindi / Other)"
    ],
    "LICENSING": [
        "What is your medical profession and specialization? (e.g., Registered Nurse, Physician, Dentist, Pharmacist)",
        "What is your highest qualification? (e.g., GNM, B.Sc Nursing, MBBS, MD, B.Pharm)",
        "How many years of relevant clinical/work experience do you have?",
        "Which country or licensing authority do you want to get licensed in? (e.g., DHA, MOH, HAAD, Saudi SCFHS, UK NMC)",
        "Do you currently hold an active, valid professional registration/license in your home country? (Yes / No)",
        "Have you already completed Dataflow verification, credential evaluation, or any eligibility assessment?"
    ],
    "JOBS": [
        "What is your target profession or job role?",
        "What is your highest completed educational qualification?",
        "How many years of relevant work experience do you have in your field?",
        "Which country or region do you prefer to work in? (e.g., UK, Ireland, Gulf/Middle East, Germany, Canada)",
        "Do you hold a valid professional license, if required for your role? (Yes / No / Not Applicable)",
        "Have you completed any required language test (IELTS, OET, German) or licensing exam? (Specify status)",
        "Do you have any study or employment gaps in your career? (No / Yes - specify duration)"
    ],
    "VISA_PR": [
        "Which country are you planning to migrate or move to?",
        "What is your current country of residence and citizenship?",
        "What is your primary visa purpose? (Study Visa / Work Permit / PR / Family Visa / Visitor)",
        "What is your highest educational qualification and current occupation?",
        "Have you already initiated an application or filed an Expression of Interest (EOI)? (Yes / No)"
    ],
    "GENERAL": [
        "Please describe briefly what service or guidance you are looking for.",
        "What is your profession, qualification, or current status?",
        "Which country or destination is relevant to your enquiry?"
    ]
}

SERVICE_MAP = {
    "1": "COACHING",
    "2": "LICENSING",
    "3": "JOBS",
    "4": "VISA_PR",
    "5": "GENERAL"
}
```

---

## 5. Master Prompt for Claude Code / Cline / Cursor

Copy and paste the prompt below directly into your AI coding tool to generate the complete backend implementation:

````markdown
You are an expert full-stack engineer building the official WhatsApp chatbot for "MNS Institute & MNS Institute Jobs".

### Objective:
Implement a Node.js (Express/TypeScript) or Python (FastAPI) webhook service that handles inbound WhatsApp messages via Meta Cloud API, manages a multi-step slot-filling questionnaire state machine, saves completed leads into PostgreSQL, and handles general user FAQs.

### Core Conversation Flow:
1. When a user sends any greeting or first message, check if an active session exists in `mns_sessions`.
2. If new or reset, send the **Welcome Message** with the 5 numbered options (1: Coaching, 2: Medical Licensing, 3: International Jobs, 4: Visa & PR, 5: Other).
3. When the user replies with a number (1-5) or keyword:
   - Map it to the service category.
   - Set `current_stage = 'IN_QUESTIONNAIRE'`, `selected_service = <SERVICE>`, and `current_step = 0`.
   - Send Question #1 of that specific service branch.
4. For every subsequent answer:
   - Store the answer in `answers[step_index]`.
   - Increment `current_step`.
   - If more questions exist in that branch, send the next question.
   - If all questions are answered:
     - Mark session `current_stage = 'COMPLETED'`.
     - Insert a record into `mns_leads` with full details.
     - Send the **Completion & Topmate Consultation Message**:
       "Thank you for sharing your details! 🙌\n\nOur team will review your requirements and guide you regarding the relevant process and next steps.\n\nYou can also schedule a one-to-one consultation with our senior consultant here:\n👉 https://topmate.io/mnsinstitute/\n\nIf you have already booked a consultation, please let us know here.\n\n*Fees will be adjusted in the process.*\n\nMNS INSTITUTE | Your Global Career Support Partner 🌍"
5. If the user asks a free-form question outside the questionnaire flow (or during completion), use an LLM (GPT-4o-mini / Claude 3.5 Sonnet) with system instructions indicating:
   - You represent MNS Institute & MNS Institute Jobs.
   - You guide healthcare and international career professionals.
   - Direct them to book a Topmate slot (`https://topmate.io/mnsinstitute/`) for personalized evaluations.
6. Provide a `GET /webhook` verification endpoint and a `POST /webhook` event handler according to official Meta Graph API v20 specifications.
7. Include `.env.example` with `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN`, and `DATABASE_URL`.
````