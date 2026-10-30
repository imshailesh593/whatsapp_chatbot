// Starting points for new workspaces. The onboarding assistant (Gemini) can adapt or replace any of these;
// they are also the offline fallback when Gemini is not configured.

export interface TemplateQuestion {
  key: string;
  prompt: string;
}
export interface TemplateService {
  /** Stable id stored on sessions/leads. Derived from the title when omitted. */
  key?: string;
  title: string;
  keywords: string[];
  questions: TemplateQuestion[];
  /** What the customer is sent when they finish this service's questions (links, next step). Empty: the generic thank-you */
  closingMessage?: string;
}
export interface Template {
  id: string;
  label: string;
  description: string;
  welcomeIntro: string;
  bookingLabel: string;
  services: TemplateService[];
}

export const slugKey = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'SERVICE';

export const TEMPLATES: Template[] = [
  {
    id: 'generic',
    label: 'Any business',
    description: 'A simple enquiry funnel: what do you need, who are you, how can we reach you.',
    welcomeIntro: 'We are happy to help with your enquiry.',
    bookingLabel: 'call with our team',
    services: [
      {
        title: 'Product / service enquiry',
        keywords: ['product', 'service', 'price', 'quote'],
        questions: [
          { key: 'need', prompt: 'What are you looking for? Please describe in a sentence or two.' },
          { key: 'timeline', prompt: 'When do you need it? (e.g. this week, this month, just exploring)' },
          { key: 'budget', prompt: 'Do you have a budget in mind? (optional, you can say "not sure")' }
        ]
      },
      {
        title: 'Support',
        keywords: ['support', 'help', 'issue', 'problem'],
        questions: [
          { key: 'issue', prompt: 'Please describe the issue you are facing.' },
          { key: 'reference', prompt: 'Do you have an order or reference number? (type "no" if not)' }
        ]
      },
      {
        title: 'Something else',
        keywords: ['other', 'general'],
        questions: [{ key: 'message', prompt: 'Please tell us how we can help.' }]
      }
    ]
  },
  {
    id: 'overseas-careers',
    label: 'Overseas careers, exams & licensing',
    description: 'Coaching, medical licensing, international jobs, visa/PR.',
    welcomeIntro:
      'We help students and professionals with international exam preparation, medical licensing, overseas job opportunities, and Visa/PR guidance.',
    bookingLabel: 'one-to-one consultation with our senior consultant',
    services: [
      {
        key: 'COACHING',
        title: 'Coaching & Exam Preparation',
        keywords: ['coaching'],
        questions: [
          { key: 'target_exam', prompt: 'Which exam or course do you need coaching for? (e.g., IELTS, OET, NCLEX, Prometric, PLAB, etc.)' },
          { key: 'current_profession', prompt: 'What is your current profession or educational background?' },
          { key: 'prep_level', prompt: 'What is your current preparation level? (Beginner / Intermediate / Already attempted once)' },
          { key: 'target_timeline', prompt: 'When are you planning to take the exam? (e.g., Within 1 month, 3 months, 6+ months)' },
          { key: 'guidance_language', prompt: 'Which language would you prefer for guidance? (English / Hindi / Other)' }
        ]
      },
      {
        key: 'LICENSING',
        title: 'Medical Licensing',
        keywords: ['licensing', 'license', 'licence'],
        questions: [
          { key: 'profession_specialization', prompt: 'What is your medical profession and specialization? (e.g., Registered Nurse, General Physician, Dentist, Pharmacist, Lab Tech)' },
          { key: 'highest_qualification', prompt: 'What is your highest qualification? (e.g., GNM, B.Sc Nursing, MBBS, MD, B.Pharm)' },
          { key: 'clinical_experience_years', prompt: 'How many years of relevant work experience do you have?' },
          { key: 'target_country', prompt: 'Which country do you want to get licensed in? (e.g., UAE - DHA/MOH/HAAD, Saudi Arabia - SCFHS, UK - NMC, USA - NCLEX, Qatar - QCHP)' },
          { key: 'has_home_registration', prompt: 'Do you hold a valid professional registration or licence in your home country? (Yes / No)' },
          { key: 'assessment_status', prompt: 'Have you completed any required exam, Dataflow, or eligibility assessment? (Yes / Not yet)' }
        ]
      },
      {
        key: 'JOBS',
        title: 'International Jobs',
        keywords: ['job', 'jobs'],
        questions: [
          { key: 'target_job_role', prompt: 'What is your profession or target job role?' },
          { key: 'highest_qualification', prompt: 'What is your highest qualification?' },
          { key: 'experience_years', prompt: 'How many years of relevant experience do you have?' },
          { key: 'preferred_countries', prompt: 'Which country do you prefer to work in? (e.g., UK, Ireland, Gulf/Middle East, Germany, Canada, Australia)' },
          { key: 'has_professional_licence', prompt: 'Do you hold a valid professional licence, if required for your role? (Yes / No / Not Applicable)' },
          { key: 'language_exam_status', prompt: 'Have you completed any required language test (IELTS, OET, German) or licensing exam? (Please specify score/status)' },
          { key: 'career_gaps', prompt: 'Do you have any study or employment gaps? (No / Yes - please specify duration)' }
        ]
      },
      {
        key: 'VISA_PR',
        title: 'Visa & Permanent Residency (PR)',
        keywords: ['visa', 'pr', 'permanent residency'],
        questions: [
          { key: 'destination_country', prompt: 'Which country are you planning to move to?' },
          { key: 'country_of_residence', prompt: 'What is your current country of residence?' },
          { key: 'visa_purpose', prompt: 'What is your purpose: study, work, visit, family, or PR?' },
          { key: 'qualification_occupation', prompt: 'What is your qualification and occupation?' },
          { key: 'has_started_application', prompt: 'Have you already started an application or filed an Expression of Interest (EOI)? (Yes / No)' }
        ]
      },
      {
        key: 'GENERAL',
        title: 'Other Enquiry',
        keywords: ['other', 'general'],
        questions: [
          { key: 'service_description', prompt: 'Please describe the service you need.' },
          { key: 'profession_or_status', prompt: 'What is your profession or current status?' },
          { key: 'relevant_country', prompt: 'Which country is relevant to your enquiry?' }
        ]
      }
    ]
  },
  {
    id: 'clinic',
    label: 'Clinic / healthcare provider',
    description: 'Appointment requests and general questions.',
    welcomeIntro: 'We help you book appointments and answer your questions about our care.',
    bookingLabel: 'appointment',
    services: [
      {
        title: 'Book an appointment',
        keywords: ['appointment', 'book', 'booking', 'visit'],
        questions: [
          { key: 'patient_name', prompt: 'Who is the appointment for? (full name)' },
          { key: 'concern', prompt: 'Briefly, what is the appointment for? (e.g. check-up, skin problem, follow-up)' },
          { key: 'preferred_time', prompt: 'What day and time suit you best?' },
          { key: 'first_visit', prompt: 'Is this your first visit to us? (Yes / No)' }
        ]
      },
      {
        title: 'Talk to the clinic',
        keywords: ['question', 'enquiry', 'doctor', 'report'],
        questions: [
          { key: 'question', prompt: 'What would you like to know? Please write your question.' },
          { key: 'callback', prompt: 'Would you like our team to call you back? (Yes / No)' }
        ]
      }
    ]
  },
  {
    id: 'real-estate',
    label: 'Real estate',
    description: 'Buyers, renters and owners wanting to list.',
    welcomeIntro: 'We help you buy, rent or list a property.',
    bookingLabel: 'property viewing or call',
    services: [
      {
        title: 'Buy a property',
        keywords: ['buy', 'purchase'],
        questions: [
          { key: 'location', prompt: 'Which area or city are you interested in?' },
          { key: 'property_type', prompt: 'What type of property? (apartment, villa, plot, commercial)' },
          { key: 'budget', prompt: 'What is your budget range?' },
          { key: 'timeline', prompt: 'When are you looking to buy? (immediately / 1-3 months / just exploring)' }
        ]
      },
      {
        title: 'Rent a property',
        keywords: ['rent', 'lease'],
        questions: [
          { key: 'location', prompt: 'Which area or city are you looking in?' },
          { key: 'bedrooms', prompt: 'How many bedrooms do you need?' },
          { key: 'monthly_budget', prompt: 'What is your monthly budget?' },
          { key: 'move_in', prompt: 'When do you want to move in?' }
        ]
      },
      {
        title: 'List my property',
        keywords: ['sell', 'list', 'owner'],
        questions: [
          { key: 'property_location', prompt: 'Where is the property located?' },
          { key: 'property_type', prompt: 'What type of property is it?' },
          { key: 'expected_price', prompt: 'What price or rent do you expect?' }
        ]
      }
    ]
  },
  {
    id: 'b2b-services',
    label: 'B2B services',
    description: 'Companies, partnerships and vendor enquiries.',
    welcomeIntro: 'We work with businesses and partners. Tell us a little about what you need.',
    bookingLabel: 'discovery call',
    services: [
      {
        title: 'I want to hire / buy for my company',
        keywords: ['hire', 'hiring', 'recruit', 'buy', 'company', 'enterprise'],
        questions: [
          { key: 'company', prompt: 'What is your company name and website?' },
          { key: 'requirement', prompt: 'What do you need from us? Please describe the requirement.' },
          { key: 'volume', prompt: 'Roughly how many people / units / how much volume?' },
          { key: 'timeline', prompt: 'What is your timeline?' },
          { key: 'contact_role', prompt: 'What is your name and role at the company?' }
        ]
      },
      {
        title: 'Partnership / referral',
        keywords: ['partner', 'partnership', 'referral', 'reseller', 'tie-up', 'tieup'],
        questions: [
          { key: 'company', prompt: 'What is your organisation name and what do you do?' },
          { key: 'partnership_type', prompt: 'What kind of partnership are you looking for? (referral, reseller, white-label, other)' },
          { key: 'expected_volume', prompt: 'What monthly volume do you expect to bring?' },
          { key: 'contact_role', prompt: 'What is your name and role?' }
        ]
      },
      {
        title: 'Something else',
        keywords: ['other', 'general'],
        questions: [{ key: 'message', prompt: 'Please tell us how we can help.' }]
      }
    ]
  }
];

export const getTemplate = (id: string): Template => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
