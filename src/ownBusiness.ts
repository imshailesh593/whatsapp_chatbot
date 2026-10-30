import { prisma } from './lib/prisma';
import { invalidateConfig, saveServices } from './services/botConfig';
import type { TemplateService } from './templates';

// The operator's own business: MNS Institute, MNS Institute Jobs, WAPPO and ZEXY AI. Built from the master chatbot prompt
// (prices, inclusions, links, rules). Apply with `node dist/cli/ownBusiness.js`; safe to run again.

const TOPMATE = 'https://topmate.io/mnsinstitute/';
const JOBS = 'https://www.mnsinstitutejobs.com';
const WAPPO = 'https://www.wappoai.com';
const FORM = 'https://tally.so/r/7Rrl70';
/** The team's number for "call us" (WhatsApp call or normal call) */
const TEAM_PHONE = '+91 8700825077';
const ZEXY = 'https://zexyai.com';

/** Every closing message tells the customer what to type for more. The consultation link itself is only sent when they ask. */
const MORE = 'Reply *MORE INFO* to book a one-to-one consultation, or *MENU* for the menu. You can also ask me anything here.';
const closing = ([first, ...rest]: string[]) => [`Thanks for sharing your details! 🙌\n\n${first}`, ...rest, MORE].join('\n\n');

const profile = (...extra: { key: string; prompt: string }[]) => [
  { key: 'profession', prompt: 'What is your current profession?' },
  { key: 'qualification', prompt: 'Your highest qualification, and the year you completed it?' },
  { key: 'experience', prompt: 'Total years of professional experience?' },
  { key: 'gap', prompt: 'Any study or employment gap? If yes, how long? (type "no" if none)' },
  ...extra
];

export const OWN_SERVICES: TemplateService[] = [
  {
    key: 'COACHING',
    title: 'Coaching (IELTS, OET, PTE, NORCET, DHA)',
    keywords: ['coaching', 'ielts', 'oet', 'pte', 'norcet'],
    questions: [
      { key: 'exam', prompt: 'Which exam do you want coaching for? (IELTS, OET, PTE, NORCET or DHA)' },
      { key: 'profession', prompt: 'What is your current profession?' },
      { key: 'qualification', prompt: 'Your highest qualification, and the year you completed it?' },
      { key: 'prep_level', prompt: 'What is your current preparation level? (Beginner / Intermediate / Already attempted)' },
      { key: 'timeline', prompt: 'When do you plan to take the exam?' }
    ],
    closingMessage: closing([
      `*Coaching fees*
• IELTS, OET, PTE, NORCET: ₹14,500 for 2 months, or ₹12,000 for a 1-month crash course
• DHA: ₹14,500 for 2 months only`,
      `Our team will guide you on the right course. Results cannot be guaranteed.`
    ])
  },
  {
    key: 'PROMETRIC_MATERIAL',
    title: 'Prometric Study Material',
    keywords: ['study material', 'material', 'prometric', 'test series', 'mock test'],
    questions: [
      { key: 'exam', prompt: 'Which Prometric exam are you preparing for? (for example DHA, HAAD, MOH or another)' },
      { key: 'profession', prompt: 'What is your profession? (Nurse, Pharmacist, Lab technologist, Doctor or other)' },
      { key: 'experience', prompt: 'How many years of professional experience do you have?' },
      { key: 'need', prompt: 'What are you looking for? (study material, practice tests, or both)' }
    ],
    closingMessage: closing([
      `*Prometric study material: ₹8,000*
• Study material
• 50 test series
• 50 mock tests
• 30+ practice resources[if profession ~ nurs]
• Recorded lectures (nursing)[/if]`,
      `Self-study package, not live coaching or a licensing package.`
    ])
  },
  {
    key: 'LICENSING',
    title: 'Healthcare Licensing',
    keywords: ['licensing', 'license', 'licence', 'dataflow', 'data flow'],
    questions: profile(
      { key: 'location', prompt: 'Which country are you in now, and where do you want to work?' },
      { key: 'existing_license', prompt: 'Do you hold a professional license? Which one? ("no" if none)' },
      { key: 'exam_status', prompt: 'Have you taken a licensing exam (e.g. DHA)? Status and result? ("no" if none)' }
    ),
    closingMessage: closing([
      `*Complete licensing package*
• Nursing, Pharmacist, Lab Technologist/Technician, Radiologist: ₹1,75,000
• BAMS: about ₹1,75,000 (can vary by ₹2,000-4,000)
• Other doctors: from ₹1,75,000, final quote after profile review`,
      '---',
      `*After you pass DHA or another Prometric exam*
Licensing service fee: ₹40,000, payable only after a positive result. Covers DataFlow, eligibility, Letter of Qualification (where applicable) and licensing guidance.`,
      `Exam, government and visa charges are separate. Approval rests with the regulator.`
    ])
  },
  {
    key: 'JOBS',
    title: 'International Job Assistance',
    keywords: ['job', 'jobs', 'placement', 'recruitment'],
    questions: profile(
      { key: 'location', prompt: 'Which country are you in now?' },
      { key: 'destination', prompt: 'Which country do you want to work in?' },
      { key: 'existing_license', prompt: 'Do you hold a professional license? Which one? ("no" if none)' }
    ),
    closingMessage: closing([
      `*International job assistance: ₹50,000*
• ₹6,500 at enrollment
• ₹43,500 after your offer letter

Includes CV preparation, interview preparation and a candidate portal with Gmail updates.`,
      '---',
      `Offers can take 3 days to 3+ weeks, depending on your profile and the employer. No job is guaranteed.`,
      `Enroll only on our official site:\n👉 ${JOBS}`
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
    closingMessage: closing([
      `*German course: ₹70,000 for 4 months*
• One-to-one training
• 1-3 hours a day, 6 days a week`,
      `Our team will confirm your schedule.`
    ])
  },
  {
    key: 'VISA_PR',
    title: 'Study Abroad, Malta, Visa & PR',
    keywords: ['visa', 'pr', 'malta', 'study abroad', 'immigration', 'permanent residency'],
    questions: [
      { key: 'purpose', prompt: 'What do you need? (Study abroad, Malta nursing, work visa, student visa or PR)' },
      { key: 'profession', prompt: 'What is your profession and highest qualification (with completion year)?' },
      { key: 'experience', prompt: 'Total years of professional experience?' },
      { key: 'gap', prompt: 'Any study or employment gap? If yes, how long? (type "no" if none)' },
      { key: 'location', prompt: 'Which country are you in now, and which country do you want to go to?' },
      { key: 'license_exam', prompt: 'Any professional license or exam taken (IELTS, OET...)? Status? ("no" if none)' }
    ],
    closingMessage: closing([
      `There is no fixed fee for study abroad, Malta, visa or PR. It depends on your profile.`,
      `Our team will review your details and send a quote. No outcome can be guaranteed.`
    ])
  },
  {
    key: 'WAPPO',
    title: 'WAPPO WhatsApp Chatbot',
    keywords: ['wappo', 'chatbot', 'whatsapp bot', 'automation'],
    questions: [
      { key: 'business', prompt: 'What type of business do you run?' },
      { key: 'goal', prompt: 'What do you want to automate on WhatsApp? (enquiries, leads, bookings)' },
      { key: 'features', prompt: 'Which features matter most? (custom Q&A, CRM, many languages)' },
      { key: 'ready', prompt: 'Do you have your business Q&A ready, or do you need help preparing it?' }
    ],
    closingMessage: closing([
      `*WAPPO: ₹499 per month*
• Unlimited messages, no per-message charge
• Automated replies from your own Q&A
• Custom chatbot behaviour
• CRM portal
• Basic setup in about 5 minutes`,
      `Get started:\n👉 ${WAPPO}`
    ])
  },
  {
    key: 'ZEXY_AI',
    title: 'ZEXY AI Video & Social Media',
    keywords: ['zexy', 'video', 'social media', 'marketing', 'editing'],
    questions: [
      { key: 'service', prompt: 'Do you want to edit videos yourself with AI, or have us manage your social media?' },
      { key: 'business', prompt: 'Please tell us about your business and who your audience is.' },
      { key: 'platforms', prompt: 'Which platforms do you want to be on? (for example Instagram, YouTube, Facebook)' },
      { key: 'topics', prompt: 'What topics should the content cover, and how often would you like to post?' }
    ],
    closingMessage: closing([
      `*ZEXY AI*
1) Self-service AI video editing: ₹499
2) Managed social media marketing: ₹14,500 for 2 months`,
      '---',
      `*Managed includes:* content planning, scripts, AI avatar (from your photo), voice, video editing, titles, tags, SEO and publishing. Video count and platforms are confirmed before work starts.`,
      `Learn more:\n👉 ${ZEXY}`
    ])
  },
  {
    key: 'GENERAL',
    title: 'Something else / talk to our team',
    keywords: ['other', 'something else', 'team', 'general'],
    questions: [
      { key: 'message', prompt: 'Please tell us how we can help.' },
      { key: 'contact_time', prompt: 'What is the best time for our team to reach you?' }
    ],
    closingMessage: closing([
      `Our team will read your message and get back to you.`
    ])
  }
];

export const OWN_KNOWLEDGE = `GENERAL RULES
- Never invent prices, links, phone numbers, inclusions, timelines, discounts or payment options. Never guarantee exam results or scores, jobs, licence approval, visas, PR, SEO rankings, views or business growth.
- Quote a price only when the customer asks about fees, price or cost; give the exact figure below with its inclusions. Otherwise explain the value of the service first.
- Keep coaching, study material, licensing and job assistance clearly separate.
- If you cannot answer confidently from these notes, say: "I want to make sure you receive accurate information. Please contact our team directly through a WhatsApp call or a normal phone call on ${TEAM_PHONE} so we can understand your situation and guide you correctly." Share the consultation link only when the customer asks for more information, a detailed one-to-one discussion or to book. Never add it to ordinary answers or to the end of a conversation. The team's number is ${TEAM_PHONE}; never give any other number and never claim a call, booking, payment or enrollment has happened.
- Share only the link for the service the customer asks about.

OFFICIAL LINKS
MNS Institute Jobs: ${JOBS}
WAPPO: ${WAPPO} (always this address)
ZEXY AI: ${ZEXY}
Profile form for new enquiries: ${FORM}
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
  // The first message asks which of these the customer prefers; the menu, questions and answers then follow it
  languages: 'English, Hindi, Hinglish, Tamil, Malayalam',
  bookingLabel: 'one-to-one consultation with our team',
  bookingUrl: TOPMATE,
  formUrl: FORM,
  languageStep: true,
  welcomeIntro: 'Thank you for contacting us.',
  languageWelcome: 'Hello! 👋 Welcome to MNS. Which language would you prefer?',
  followUpsEnabled: true,
  handoffEnabled: true,
  handoffMessage:
    `Sure. Our team will take over this chat and reply shortly. You can also call or WhatsApp us on ${TEAM_PHONE}.`,
  industry: 'overseas-careers',
  knowledge: OWN_KNOWLEDGE
};

/** Writes the whole setup (menu, questions, closing messages, AI notes, language and follow-up switches) to a workspace. */
export async function applyOwnBusiness(workspaceId: string): Promise<void> {
  await saveServices(workspaceId, OWN_SERVICES);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { ...OWN_PROFILE, onboardingCompleted: true } });
  invalidateConfig(workspaceId);
}
