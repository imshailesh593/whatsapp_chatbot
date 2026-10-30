import { prisma } from './lib/prisma';
import { invalidateConfig, saveServices } from './services/botConfig';
import type { TemplateService } from './templates';

// The operator's own business: MNS Institute, MNS Institute Jobs, WAPPO and ZEXY AI. Built from the master chatbot prompt
// (prices, inclusions, links, rules). Apply with `node dist/cli/ownBusiness.js`; safe to run again.

const TOPMATE = 'https://topmate.io/mnsinstitute/';
const JOBS = 'https://www.mnsinstitutejobs.com';
const WAPPO = 'https://www.wappoai.com';
const ZEXY = 'https://zexyai.com';

const closing = (lines: string[]) => ['Thank you for sharing your details! 🙌', ...lines, 'You can ask me any question here. To see the menu again, type *MENU*.'].join('\n\n');

const profile = (...extra: { key: string; prompt: string }[]) => [
  { key: 'profession', prompt: 'What is your current profession?' },
  { key: 'qualification', prompt: 'What is your highest qualification, and in which year did you complete it?' },
  { key: 'experience', prompt: 'How many years of professional experience do you have in total?' },
  { key: 'gap', prompt: 'Do you have any study gap or employment gap? If yes, for how long? (type "no" if none)' },
  ...extra
];

export const OWN_SERVICES: TemplateService[] = [
  {
    key: 'COACHING',
    title: 'Coaching & Exam Preparation (IELTS, OET, PTE, NORCET, DHA)',
    keywords: ['coaching', 'ielts', 'oet', 'pte', 'norcet'],
    questions: [
      { key: 'exam', prompt: 'Which exam do you want coaching for? (IELTS, OET, PTE, NORCET or DHA)' },
      { key: 'profession', prompt: 'What is your current profession?' },
      { key: 'qualification', prompt: 'What is your highest qualification, and in which year did you complete it?' },
      { key: 'prep_level', prompt: 'What is your current preparation level? (Beginner / Intermediate / Already attempted)' },
      { key: 'timeline', prompt: 'When do you plan to take the exam?' }
    ],
    closingMessage: closing([
      'Our team will review your requirements and guide you on the right course and next steps.',
      `For a detailed one-to-one discussion about your preparation, course options and fees, you can book a consultation:\n👉 ${TOPMATE}`
    ])
  },
  {
    key: 'PROMETRIC_MATERIAL',
    title: 'Prometric Exam Study Material (DHA, HAAD & more)',
    keywords: ['study material', 'material', 'prometric', 'test series', 'mock test'],
    questions: [
      { key: 'exam', prompt: 'Which Prometric exam are you preparing for? (for example DHA, HAAD, MOH or another)' },
      { key: 'profession', prompt: 'What is your profession? (Nurse, Pharmacist, Lab technologist, Doctor or other)' },
      { key: 'experience', prompt: 'How many years of professional experience do you have?' },
      { key: 'need', prompt: 'What are you looking for? (study material, practice tests, or both)' }
    ],
    closingMessage: closing([
      'Our team will confirm the study material and practice resources available for your exam.',
      `If you would like to discuss your preparation in detail, you can book a consultation:\n👉 ${TOPMATE}`
    ])
  },
  {
    key: 'LICENSING',
    title: 'Healthcare Licensing (DHA, MOH, HAAD, DataFlow & more)',
    keywords: ['licensing', 'license', 'licence', 'dataflow', 'data flow'],
    questions: profile(
      { key: 'location', prompt: 'Which country are you in now, and which country do you want to work in?' },
      { key: 'existing_license', prompt: 'Do you already hold a professional license or registration? If yes, which one? (type "no" if none)' },
      { key: 'exam_status', prompt: 'Have you taken any licensing exam (for example DHA)? Please share the status and result. (type "no" if none)' }
    ),
    closingMessage: closing([
      'The right licensing pathway depends on your qualification, experience, target country and existing registration. Our team will review your profile and guide you.',
      `To discuss your eligibility, the applicable pricing and next steps in detail, please book a one-to-one consultation:\n👉 ${TOPMATE}`,
      'If you decide to proceed, the applicable terms will be confirmed before enrollment.'
    ])
  },
  {
    key: 'JOBS',
    title: 'International Job Assistance (MNS Institute Jobs)',
    keywords: ['job', 'jobs', 'placement', 'recruitment'],
    questions: profile(
      { key: 'location', prompt: 'Which country are you in now?' },
      { key: 'destination', prompt: 'Which country do you want to work in?' },
      { key: 'existing_license', prompt: 'Do you already hold a professional license or registration? If yes, which one? (type "no" if none)' }
    ),
    closingMessage: closing([
      `To see how our job assistance works and to enroll, please visit our official website:\n👉 ${JOBS}`,
      `If you would like to discuss your profile before enrolling, you can book a one-to-one consultation:\n👉 ${TOPMATE}`
    ])
  },
  {
    key: 'GERMAN',
    title: 'German Language Course',
    keywords: ['german', 'germany language', 'deutsch'],
    questions: [
      { key: 'goal', prompt: 'Why do you want to learn German? (job, study, migration or other)' },
      { key: 'level', prompt: 'What is your current German level? (None / A1 / A2 / B1 or higher)' },
      { key: 'schedule', prompt: 'When would you like to start, and which time of day suits you best?' }
    ],
    closingMessage: closing(['Our team will confirm the course details and the exact daily schedule with you.'])
  },
  {
    key: 'VISA_PR',
    title: 'Study Abroad, Malta, Visa & PR',
    keywords: ['visa', 'pr', 'malta', 'study abroad', 'immigration', 'permanent residency'],
    questions: [
      { key: 'purpose', prompt: 'What do you need help with? (Study abroad, Malta nursing bridging, work visa, student visa or PR)' },
      { key: 'profession', prompt: 'What is your profession and highest qualification (with completion year)?' },
      { key: 'experience', prompt: 'How many years of professional experience do you have in total?' },
      { key: 'gap', prompt: 'Do you have any study gap or employment gap? If yes, for how long? (type "no" if none)' },
      { key: 'location', prompt: 'Which country are you in now, and which country do you want to go to?' },
      { key: 'license_exam', prompt: 'Do you hold any professional license, or have you taken any exam (IELTS, OET and so on)? Please share the status. (type "no" if none)' }
    ],
    closingMessage: closing([
      'Eligibility, process and costs depend on your profile and the current requirements of the destination. Our team will review your details.',
      `For a detailed discussion and an accurate quotation, please book a one-to-one consultation:\n👉 ${TOPMATE}`
    ])
  },
  {
    key: 'WAPPO',
    title: 'WAPPO: WhatsApp Chatbot Automation',
    keywords: ['wappo', 'chatbot', 'whatsapp bot', 'automation'],
    questions: [
      { key: 'business', prompt: 'What type of business do you run?' },
      { key: 'goal', prompt: 'What would you like to automate on WhatsApp? (for example answering enquiries, collecting leads, bookings)' },
      { key: 'features', prompt: 'Which features matter most to you? (for example custom questions and answers, CRM, replies in many languages)' },
      { key: 'ready', prompt: 'Do you already have your business questions, answers and instructions ready, or do you need help preparing them?' }
    ],
    closingMessage: closing([`You can see how WAPPO works and get started here:\n👉 ${WAPPO}`])
  },
  {
    key: 'ZEXY_AI',
    title: 'ZEXY AI: AI Video Editing & Social Media Marketing',
    keywords: ['zexy', 'video', 'social media', 'marketing', 'editing'],
    questions: [
      { key: 'service', prompt: 'Are you looking to edit your own videos with AI (self-service), or would you like us to manage your social media content?' },
      { key: 'business', prompt: 'Please tell us about your business and who your audience is.' },
      { key: 'platforms', prompt: 'Which platforms do you want to be on? (for example Instagram, YouTube, Facebook)' },
      { key: 'topics', prompt: 'What topics should the content cover, and how often would you like to post?' }
    ],
    closingMessage: closing([`You can learn more about ZEXY AI here:\n👉 ${ZEXY}`, `If you would like to discuss your requirements first, you can book a consultation:\n👉 ${TOPMATE}`])
  },
  {
    key: 'GENERAL',
    title: 'Something else / talk to our team',
    keywords: ['other', 'something else', 'team', 'general'],
    questions: [
      { key: 'message', prompt: 'Please tell us how we can help.' },
      { key: 'contact_time', prompt: 'What is the best time for our team to reach you?' }
    ],
    closingMessage: closing(['Our team will read your message and get back to you.'])
  }
];

export const OWN_KNOWLEDGE = `GENERAL RULES
- Never invent prices, links, phone numbers, inclusions, timelines, discounts or payment options. Never guarantee exam results or scores, jobs, licence approval, visas, PR, SEO rankings, views or business growth.
- Quote a price only when the customer asks about fees, price or cost; give the exact figure below with its inclusions. Otherwise explain the value of the service first.
- Keep coaching, study material, licensing and job assistance clearly separate.
- If you cannot answer confidently from these notes, say: "I want to make sure you receive accurate information. Please contact our team directly through a WhatsApp call or a normal phone call so we can understand your situation and guide you correctly." For complex or individual cases also offer the consultation link. Never invent a phone number and never claim a call, booking, payment or enrollment has happened.
- Share only the link for the service the customer asks about.

OFFICIAL LINKS
MNS Institute Jobs: ${JOBS}
WAPPO: ${WAPPO} (always this address)
ZEXY AI: ${ZEXY}
One-to-one consultation (Topmate): ${TOPMATE}
MNS Institute coaching has no enrollment link: send the customer to the consultation or the team.

MNS INSTITUTE COACHING
IELTS, OET, PTE, NORCET: Rs 14,500 for two months, or Rs 12,000 for a one-month crash course.
DHA: Rs 14,500 for two months only. Never offer one-month DHA coaching.
Coaching fees are separate from study material and complete licensing packages.

PROMETRIC STUDY MATERIAL (DHA, HAAD and other Prometric exams): Rs 8,000.
Includes study material, 50 test series, 50 mock tests and 30+ practice resources where available. Recorded lectures are included ONLY for nursing candidates; never mention or promise recorded lectures to pharmacists, laboratory professionals or any non-nursing candidate. It is not live coaching and not a complete licensing package. For non-Prometric exams the team must confirm availability and price.

COMPLETE LICENSING PACKAGES
Rs 1,75,000 for Nursing / Registered Nurse, Pharmacist, Medical Laboratory Technologist or Technician, and Radiologist. BAMS: about Rs 1,75,000 (may vary by roughly Rs 2,000 to 4,000 with individual requirements).
Other doctors and healthcare professionals: the indicative minimum is Rs 1,75,000; the final quotation depends on qualification, specialization, experience, target country, existing licence, documents, eligibility and licensing pathway. Do not quote a final price; offer the consultation.
Do not say that exam fees, government fees, visa expenses or other third-party charges are included.

LICENSING AFTER PASSING DHA OR ANOTHER PROMETRIC EXAM
Service fee Rs 40,000, payable only after a positive result; no processing fee before a positive result. Covers DataFlow processing, eligibility processing, Letter of Qualification where applicable and guidance through the further licensing formalities. The regulator makes the final decision; never guarantee approval.

INTERNATIONAL JOB ASSISTANCE (nursing), ${JOBS}
Total Rs 50,000: Rs 6,500 at enrollment, then Rs 43,500 after an offer letter is received. Includes professional CV preparation, interview preparation, relevant interview questions from previous candidate and employer experiences, and candidate portal access (job application tracking, interview scheduling status, offer-letter status, organization and application details, Gmail notifications). Enrollment and payment only through the website above; no other payment method.
Timeline: it depends on the profile and the employer. Some employers respond within about three days, others take three weeks or longer. No joining date or job offer can be guaranteed.
One-to-one interview training is optional and has a separate fee that the team confirms; never pressure the customer. To discuss a profile before enrolling, offer the consultation link.

GERMAN LANGUAGE COURSE
Rs 70,000 for four months, one-to-one training, about 1 to 3 hours a day, six days a week. The team confirms the exact daily schedule.

STUDY ABROAD, MALTA NURSING BRIDGING, VISA AND PR
No fixed prices are available here. Process, eligibility and cost depend on the person and current requirements; offer the consultation for a quotation. Never guarantee admission, visa approval or PR.

WAPPO, WhatsApp chatbot automation, ${WAPPO}
Rs 499 per month, unlimited messaging under the plan, no per-message charge. Features: automated customer replies, business-specific questions and answers, prompt-based instructions and custom chatbot behaviour, and a CRM portal. Basic setup takes about five minutes when the information is ready; do not promise that advanced integrations take five minutes. Never invent extra fees, integrations or features.

ZEXY AI, ${ZEXY}
1) Self-service AI video editing: Rs 499. Customers edit their own videos; subscription duration and feature limits must be confirmed by the team. It is not a managed service.
2) Managed social media marketing: Rs 14,500 for two months. Includes topic-based content planning, script and content creation, an AI avatar from an authorised customer photo, voice integration, video generation and editing, titles, descriptions, tags, hashtags, SEO-oriented metadata, and uploading and publishing on the agreed platforms. The number of videos, platforms, posting frequency, revisions and account access must be confirmed before promising deliverables.`;

export const OWN_PROFILE = {
  businessName: 'MNS Institute | MNS Institute Jobs | WAPPO | ZEXY AI',
  description:
    'a group of four services: MNS Institute (coaching, exam preparation, healthcare licensing, study-abroad guidance), MNS Institute Jobs (international job assistance), WAPPO (WhatsApp chatbot automation) and ZEXY AI (AI video editing and managed social media marketing)',
  tone: 'professional and friendly',
  languages: 'English, Hindi and other languages the customer prefers',
  bookingLabel: 'one-to-one consultation with our team',
  formUrl: '',
  languageStep: true,
  languageWelcome:
    'Hello! Welcome, and thank you for contacting us. I am here to help you find the right solution for your needs. Which language would you prefer for our conversation?',
  followUpsEnabled: true,
  handoffEnabled: true,
  handoffMessage:
    'Of course. I have asked our team to take over this chat, and a person will reply here shortly. You can also reach the team directly through a WhatsApp call or a normal phone call.',
  industry: 'overseas-careers',
  knowledge: OWN_KNOWLEDGE
};

/** Writes the whole setup (menu, questions, closing messages, AI notes, language and follow-up switches) to a workspace. */
export async function applyOwnBusiness(workspaceId: string): Promise<void> {
  await saveServices(workspaceId, OWN_SERVICES);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { ...OWN_PROFILE, onboardingCompleted: true } });
  invalidateConfig(workspaceId);
}
