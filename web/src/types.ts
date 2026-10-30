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
  ownerId: string | null;
  ownerEmail: string | null;
  tags: string[];
  followUpAt: string | null;
  source: string | null;
  stage: string;
  step: number;
  totalSteps: number;
  progress: number;
  targetCountry: string | null;
  botActive: boolean;
  handoffAt: string | null;
  handoffSummary: string;
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
  /** Stable id of an existing service (kept so saving does not rename it); empty for new ones */
  key?: string;
  title: string;
  keywords: string[];
  closingMessage?: string;
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
  handoffEnabled: boolean;
  handoffMessage: string;
  languageStep: boolean;
  languageWelcome: string;
  followUpsEnabled: boolean;
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
  ownerId?: string | null;
  tags?: string[];
  followUpAt?: string | null;
}

export interface LeadEventInfo {
  id: string;
  type: string;
  detail: string;
  actor: string;
  at: string;
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
  conversationsThisMonth: number;
  lastActivity: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface PlatformOverview {
  businesses: number;
  paying: number;
  trialing: number;
  lapsed: number;
  whatsappConnected: number;
  leads: number;
  mrrInr: number;
}

export interface PlatformDetail {
  id: string;
  businessName: string;
  plan: string;
  planStatus: string;
  billingProvider: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  limits: { conversations: number | null; aiReplies: number | null; broadcasts: number | null };
  usage: { conversations: number; aiReplies: number; broadcasts: number };
  users: { id: string; email: string; role: string; isSuperAdmin: boolean; lastLoginAt: string | null }[];
  payments: { id: string; amount: number; currency: string; status: string; plan: string; at: string }[];
  audit: { id: string; actor: string; action: string; detail: string; at: string }[];
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  workspaceId: string | null;
  detail: string;
  at: string;
}

export interface BillingPlan {
  id: string;
  name: string;
  blurb: string;
  price: { INR: number; USD: number };
  limits: { conversations: number; aiReplies: number; seats: number; broadcasts: number };
}

export interface PaymentsSetup {
  razorpay: { label: string; ok: boolean; detail: string }[];
  stripe: { label: string; ok: boolean; detail: string }[];
  paypal: { label: string; ok: boolean; detail: string }[];
  razorpayWebhook: string;
  stripeWebhook: string;
  paypalWebhook: string;
  razorpayReady: boolean;
  stripeReady: boolean;
  paypalReady: boolean;
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
  limits: { conversations: number | null; aiReplies: number | null; seats: number | null; broadcasts: number | null };
  usage: { conversations: number; aiReplies: number; seats: number; broadcasts: number };
  providers: { stripe: boolean; razorpay: boolean; paypal: boolean };
  /** The currency to lead with, from the owner's IP address */
  currency: 'INR' | 'USD';
  plans: BillingPlan[];
  payments: { id: string; amount: number; currency: string; status: string; plan: string; at: string }[];
}

export interface WebhookInfo {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
  createdAt: string;
  last: { status: string; error: string; at: string } | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IntegrationsInfo {
  enabled: boolean;
  events: string[];
  phone: string | null;
  webhooks: WebhookInfo[];
  apiKeys: ApiKeyInfo[];
}

export interface AnalyticsData {
  days: number;
  totals: { started: number; pickedService: number; leads: number; booked: number; won: number; completionRate: number; medianMinutesToComplete: number | null };
  series: { day: string; started: number; leads: number }[];
  byService: { key: string | null; title: string; started: number; leads: number }[];
  bySource: { source: string; started: number; leads: number }[];
  byStage: { key: string; label: string; color: string; count: number }[];
  dropOffs: { service: string; question: string; count: number }[];
}

export interface BroadcastInfo {
  id: string;
  name: string;
  text: string;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'done' | 'canceled';
  note: string;
  total: number;
  sent: number;
  failed: number;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface PlatformSettingsInfo {
  platformSender: boolean;
  used: number;
  max: number;
  botRssMb: number;
  systemTotalMb: number;
  systemFreeMb: number;
}

export interface CouponInfo {
  id: string;
  code: string;
  plan: string;
  days: number;
  maxRedemptions: number | null;
  redeemed: number;
  expiresAt: string | null;
  active: boolean;
  note: string;
  createdAt: string;
}

export interface CalendarInfo {
  googleAvailable: boolean;
  connected: boolean;
  email: string;
  timezone: string;
  settings: {
    slotMinutes: number;
    bufferMinutes: number;
    workDays: number[];
    workStart: string;
    workEnd: string;
    noticeHours: number;
    daysAhead: number;
    reminderHours: number;
  } | null;
  appointments: { id: string; phone: string; name: string | null; startsAt: string; when: string; past: boolean }[];
}

type Totals = Record<string, { pending: number; approved: number; paid: number }>;

export interface ReferralInfo {
  enabled: boolean;
  percent: number;
  months: number;
  bonusDays: number;
  code: string;
  link: string;
  payoutDetails: string;
  signedUp: number;
  paying: number;
  totals: Totals;
  referrals: { name: string; joinedAt: string; paying: boolean }[];
  commissions: { id: string; referred: string; amount: number; currency: string; status: string; at: string; paidAt: string | null }[];
}

export interface AffiliateAdmin {
  settings: { enabled: boolean; percent: number; months: number; bonusDays: number };
  affiliates: { id: string; businessName: string; code: string | null; payoutDetails: string; referred: number; totals: Totals }[];
  commissions: { id: string; affiliate: string; payoutDetails: string; referred: string; amount: number; currency: string; status: string; at: string; paidAt: string | null }[];
}
