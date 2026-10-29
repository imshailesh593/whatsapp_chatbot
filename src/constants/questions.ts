export interface QuestionItem {
  key: string;
  question: string;
}

export const QUESTION_BRANCHES: Record<string, QuestionItem[]> = {
  COACHING: [
    { key: "target_exam", question: "Which exam or course do you need coaching for? (e.g., IELTS, OET, NCLEX, Prometric, PLAB, etc.)" },
    { key: "current_profession", question: "What is your current profession or educational background?" },
    { key: "prep_level", question: "What is your current preparation level? (Beginner / Intermediate / Already attempted once)" },
    { key: "target_timeline", question: "When are you planning to take the exam? (e.g., Within 1 month, 3 months, 6+ months)" },
    { key: "guidance_language", question: "Which language would you prefer for guidance? (English / Hindi / Other)" }
  ],
  LICENSING: [
    { key: "profession_specialization", question: "What is your medical profession and specialization? (e.g., Registered Nurse, General Physician, Dentist, Pharmacist, Lab Tech)" },
    { key: "highest_qualification", question: "What is your highest qualification? (e.g., GNM, B.Sc Nursing, MBBS, MD, B.Pharm)" },
    { key: "clinical_experience_years", question: "How many years of relevant work experience do you have?" },
    { key: "target_country", question: "Which country do you want to get licensed in? (e.g., UAE - DHA/MOH/HAAD, Saudi Arabia - SCFHS, UK - NMC, USA - NCLEX, Qatar - QCHP)" },
    { key: "has_home_registration", question: "Do you hold a valid professional registration or licence in your home country? (Yes / No)" },
    { key: "assessment_status", question: "Have you completed any required exam, Dataflow, or eligibility assessment? (Yes / Not yet)" }
  ],
  JOBS: [
    { key: "target_job_role", question: "What is your profession or target job role?" },
    { key: "highest_qualification", question: "What is your highest qualification?" },
    { key: "experience_years", question: "How many years of relevant experience do you have?" },
    { key: "preferred_countries", question: "Which country do you prefer to work in? (e.g., UK, Ireland, Gulf/Middle East, Germany, Canada, Australia)" },
    { key: "has_professional_licence", question: "Do you hold a valid professional licence, if required for your role? (Yes / No / Not Applicable)" },
    { key: "language_exam_status", question: "Have you completed any required language test (IELTS, OET, German) or licensing exam? (Please specify score/status)" },
    { key: "career_gaps", question: "Do you have any study or employment gaps? (No / Yes - please specify duration)" }
  ],
  VISA_PR: [
    { key: "destination_country", question: "Which country are you planning to move to?" },
    { key: "country_of_residence", question: "What is your current country of residence?" },
    { key: "visa_purpose", question: "What is your purpose: study, work, visit, family, or PR?" },
    { key: "qualification_occupation", question: "What is your qualification and occupation?" },
    { key: "has_started_application", question: "Have you already started an application or filed an Expression of Interest (EOI)? (Yes / No)" }
  ],
  GENERAL: [
    { key: "service_description", question: "Please describe the service you need." },
    { key: "profession_or_status", question: "What is your profession or current status?" },
    { key: "relevant_country", question: "Which country is relevant to your enquiry?" }
  ]
};

export const SERVICE_SELECTION_MAP: Record<string, string> = {
  "1": "COACHING",
  "2": "LICENSING",
  "3": "JOBS",
  "4": "VISA_PR",
  "5": "GENERAL"
};

/** Keyword fallbacks so "ielts coaching" or "visa" also selects a branch. Order matters (first match wins). */
export const SERVICE_KEYWORDS: [RegExp, string][] = [
  [/\bcoaching\b/, 'COACHING'],
  [/\blicen[sc]/, 'LICENSING'],
  [/\bjobs?\b/, 'JOBS'],
  [/\bvisa\b|\bpr\b|\bpermanent residen/, 'VISA_PR'],
  [/\bother\b|\bgeneral\b/, 'GENERAL']
];

export const TOPMATE_URL = process.env.TOPMATE_URL || "https://topmate.io/mnsinstitute/";

export const FORM_URL = process.env.FORM_URL || "https://tally.so/r/7Rrl70";

export const WELCOME_MESSAGE = `Hello 👋 Welcome to MNS INSTITUTE & MNS INSTITUTE JOBS! 🌍

We help students and professionals with international exam preparation, medical licensing, overseas job opportunities, and Visa/PR guidance.

📝 Please fill out this short form so our team can understand your profile:
👉 ${FORM_URL}

Then, to assist you better, please select the service you are looking for:

1️⃣ Coaching & Exam Preparation
2️⃣ Medical Licensing
3️⃣ International Jobs
4️⃣ Visa & Permanent Residency (PR)
5️⃣ Other Enquiry

Please reply with the option number (1-5). 😊`;

export const INVALID_SELECTION_MESSAGE =
  "Please reply with a valid number between 1 and 5 to choose your service. 😊\n\n1️⃣ Coaching\n2️⃣ Medical Licensing\n3️⃣ International Jobs\n4️⃣ Visa & PR\n5️⃣ Other Enquiry";

export const COMPLETION_MESSAGE = `Thank you for sharing your details! 🙌

Our team will review your requirements and guide you regarding the relevant process and next steps.

You can also schedule a one-to-one consultation with our senior consultant here:
👉 ${TOPMATE_URL}

If you have already booked a consultation, please let us know here.

*Fees will be adjusted in the process.*

MNS INSTITUTE | Your Global Career Support Partner 🌍`;

export const CONSULTATION_REMINDER_MESSAGE = `You can schedule your one-to-one consultation directly with our senior consultant using this link:\n👉 ${TOPMATE_URL}\n\n*Note: Your consultation fees will be adjusted in the subsequent processing charges.*`;

export const POST_COMPLETION_MESSAGE =
  "Thank you for your message! Our team has received your application details and a counsellor will reach out shortly.\n\nTo restart the service menu, type *MENU*.";

export const BOOKED_CONFIRMATION_MESSAGE =
  "Thank you for confirming! 🙌 Our counsellor will connect with you shortly regarding your booked consultation.";

export const UNSUPPORTED_MEDIA_MESSAGE =
  "Sorry, I can only read text messages right now. Please type your reply. 🙏";
