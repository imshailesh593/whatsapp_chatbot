// Sets up the operator's own business (MNS Institute group) on the default workspace with the STARTER version: menu, questions,
// closing messages, AI notes, language question and follow-ups.
//
// WARNING: this REPLACES the menu, questions, closing messages, AI notes and profile with the starter copy in src/ownBusiness.ts.
// Anything the owner has since written in the dashboard (the facts, the AI instructions' companion notes, the services) is lost.
// So it only runs on a business that has not been customised, or when you pass --force (take a database backup first).
//   node dist/cli/ownBusiness.js [--force]
// In Docker: docker exec <bot-container> node dist/cli/ownBusiness.js --force
import dotenv from 'dotenv';
import { prisma } from '../lib/prisma';
import { DEFAULT_WORKSPACE_ID } from '../lib/workspaces';
import { applyOwnBusiness, OWN_KNOWLEDGE, OWN_SERVICES } from '../ownBusiness';

dotenv.config();

(async () => {
  const ws = await prisma.workspace.findUnique({ where: { id: DEFAULT_WORKSPACE_ID }, select: { knowledge: true, onboardingCompleted: true } });
  const starterKeys = new Set(OWN_SERVICES.map((s) => s.key));
  const services = await prisma.service.findMany({ where: { workspaceId: DEFAULT_WORKSPACE_ID }, select: { key: true } });
  // Customised = the notes or the menu are something other than what this command would write
  const customised = !!ws && ((ws.knowledge.trim() !== '' && ws.knowledge !== OWN_KNOWLEDGE) || (services.length > 0 && !services.every((s) => starterKeys.has(s.key))));
  if (customised && !process.argv.includes('--force')) {
    console.error('Refusing to run: the default workspace has been customised (its notes or its menu differ from the starter version).');
    console.error('Running this would overwrite the owner\'s own setup. Take a backup and pass --force only if that is what you want.');
    process.exit(2);
  }
  await applyOwnBusiness(DEFAULT_WORKSPACE_ID);
  console.log(`Set up ${OWN_SERVICES.length} menu options and ${OWN_KNOWLEDGE.length} characters of AI notes on the default workspace.`);
  console.log('Language question first (English, Hindi, Hinglish, Tamil, Malayalam). Customer follow-ups: on (they send once WhatsApp is linked).');
  await prisma.$disconnect();
})().catch((err) => {
  console.error('Setup failed:', (err as Error).message);
  process.exit(1);
});
