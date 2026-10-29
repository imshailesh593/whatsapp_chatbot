export type ServiceId = 'COACHING' | 'LICENSING' | 'JOBS' | 'VISA_PR' | 'GENERAL';
export type Status = 'IN_PROGRESS' | 'COMPLETED' | 'CONSULTATION_BOOKED' | 'FOLLOW_UP';

export interface Contact {
  phone: string;
  name: string | null;
  service: ServiceId | null;
  status: Status;
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

export interface ServiceInfo {
  id: ServiceId;
  title: string;
  questions: { key: string; prompt: string }[];
}

export interface Overview {
  whatsapp: string;
  topmateUrl: string;
  services: ServiceInfo[];
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
  status?: Status;
}

export interface AdminUser {
  id: string;
  email: string;
}

export interface AdminRow extends AdminUser {
  createdAt: string;
  lastLoginAt: string | null;
}

export interface WaSnapshot {
  status: string;
  qr: string | null;
}
