// Sets up the operator's own business (MNS Institute group) on the default workspace: menu, questions, closing messages,
// AI notes, language question and follow-ups. Safe to run again; it replaces the menu and notes with the current version.
//   node dist/cli/ownBusiness.js
// In Docker: docker exec <bot-container> node dist/cli/ownBusiness.js
import dotenv from 'dotenv';
import { prisma } from '../lib/prisma';
import { DEFAULT_WORKSPACE_ID } from '../lib/workspaces';
import { applyOwnBusiness, OWN_KNOWLEDGE, OWN_SERVICES } from '../ownBusiness';

dotenv.config();

(async () => {
  await applyOwnBusiness(DEFAULT_WORKSPACE_ID);
  console.log(`Set up ${OWN_SERVICES.length} menu options and ${OWN_KNOWLEDGE.length} characters of AI notes on the default workspace.`);
  console.log('Language question first (English, Hindi, Hinglish, Tamil, Malayalam). Customer follow-ups: on (they send once WhatsApp is linked).');
  await prisma.$disconnect();
})().catch((err) => {
  console.error('Setup failed:', (err as Error).message);
  process.exit(1);
});
