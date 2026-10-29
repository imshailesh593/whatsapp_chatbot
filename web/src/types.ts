export interface StageDef {
  key: string;
  label: string;
  color: string;
  kind: 'open' | 'won' | 'lost';
}
export type Role = 'owner' | 'admin' | 'agent';

export interface Contact {
  phone: string;
  name: string | null;
  service: string | null;
  serviceTitle: string | null;
  /** Pipeline stage key once the questionnaire is complete; null while still answering */
  pipeline: string | null;
  stage: string;
  step: number;
  totalSteps: number;
  progress: number;
  targetCountry: string | null;
  botActive: boolean;
  answers: Record<string, string>;
  notes: string | null;
  hasLead: boolean;
  receivedAt: string;
  lastActivity: string;
  isTest: boolean;
}

export interface QuestionDef {
  key: string;
  prompt: string;
}

export interface ServiceDef {
  title: string;
  keywords: string[];
  questions: QuestionDef[];
}

export interface Workspace {
  id: string;
  slug: string;
  industry: string;
  businessName: string;
  tagline: string;
  description: string;
  welcomeIntro: string;
  formUrl: string;
  bookingUrl: string;
  bookingLabel: string;
  bookingNote: string;
  tone: string;
  knowledge: string;
  languages: string;
  timezone: string;
  notifyEmail: string;
  notifyPhone: string;
  onboardingCompleted: boolean;
  botEnabled: boolean;
}

export interface Overview {
  whatsapp: string;
  workspace: Workspace;
  stages: StageDef[];
  services: (ServiceDef & { id: string })[];
}

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  at: string;
}

export interface PatchBody {
  paused?: boolean;
  notes?: string;
  stage?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  isSuperAdmin: boolean;
  workspace: { id: string; businessName: string; onboardingCompleted: boolean; botEnabled: boolean } | null;
}

export interface AdminRow {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface WaSnapshot {
  status: string;
  qr: string | null;
}

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  services: number;
}

/** What the onboarding assistant proposes; applied only after the owner confirms. */
export interface Draft {
  industry: string;
  businessName: string;
  tagline: string;
  description: string;
  welcomeIntro: string;
  tone: string;
  languages: string;
  bookingLabel: string;
  bookingNote: string;
  knowledge: string;
  services: ServiceDef[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface PlatformWorkspace {
  id: string;
  businessName: string;
  slug: string;
  industry: string;
  owner: string | null;
  whatsapp: string;
  botEnabled: boolean;
  plan: string;
  planStatus: string;
  planAccess: string;
  onboardingCompleted: boolean;
  leads: number;
  contacts: number;
  users: number;
  createdAt: string;
}

export interface BillingPlan {
  id: string;
  name: string;
  blurb: string;
  price: { INR: number; USD: number };
  limits: { conversations: number; aiReplies: number; seats: number };
}

export interface BillingInfo {
  plan: string;
  planName: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  active: boolean;
  reason: 'ok' | 'trial_expired' | 'canceled' | 'past_due';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: string | null;
  limits: { conversations: number | null; aiReplies: number | null; seats: number | null };
  usage: { conversations: number; aiReplies: number; seats: number };
  providers: { stripe: boolean; razorpay: boolean };
  plans: BillingPlan[];
  payments: { id: string; amount: number; currency: string; status: string; plan: string; at: string }[];
}
