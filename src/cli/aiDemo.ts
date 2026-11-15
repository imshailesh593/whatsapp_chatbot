// Plays a customer conversation through the AI agent with a business's real settings, and prints what would happen.
// Writes nothing and sends nothing (no session, no lead, no WhatsApp message); it only reads the business's setup
// and calls Gemini.
//   node dist/cli/aiDemo.js <workspaceId> "customer line 1" "customer line 2" ...
// In Docker: docker compose exec -T bot node dist/cli/aiDemo.js default-workspace "hi" "I am a nurse"
import dotenv from 'dotenv';
import { prisma } from '../lib/prisma';
import { completionMessage, loadConfig } from '../services/botConfig';
import { applyTurn, contactFooter, formMessage, runAgentTurn, agentAvailable, type Turn } from '../services/agent';

dotenv.config();

(async () => {
  const [, , workspaceId = 'default-workspace', ...lines] = process.argv;
  if (!agentAvailable()) throw new Error('No GEMINI_API_KEY is set');
  if (lines.length === 0) throw new Error('Give at least one customer line');
  const cfg = await loadConfig(workspaceId);
  console.log(`Business: ${cfg.ws.businessName} | services: ${cfg.services.map((s) => s.key).join(', ')} | AI conversation: ${cfg.ws.aiConversation ? 'on' : 'off'}\n`);

  const history: Turn[] = [];
  let service = null as (typeof cfg.services)[number] | null;
  let answers: Record<string, string> = {};
  let completed = false;
  let language: string | null = null;

  for (const line of lines) {
    const turn = await runAgentTurn({ cfg, service, answers, completed, language, calendarOn: false, firstReply: !history.some((t) => t.who === 'You') }, history, [line]);
    const corpus = [...history.filter((t) => t.who === 'Customer').map((t) => t.text), line].join('\n');
    const applied = applyTurn({ cfg, service, answers, completed, language }, turn, corpus);
    const justCompleted = applied.completed && !completed;
    console.log(`Customer: ${line}`);
    console.log(`AI      : ${turn.reply || '(no text)'}`);
    const notes = [
      applied.service && `service=${applied.service.key}`,
      applied.accepted.length && `heard=${applied.accepted.map((k) => `${k}="${applied.answers[k]}"`).join(', ')}`,
      applied.rejected.length && `REFUSED answers=${applied.rejected.join(',')}`,
      turn.action !== 'none' && `action=${turn.action}`,
      applied.language && `language=${applied.language}`,
      turn.removed.length && `CLEANED: ${turn.removed.join('; ')}`
    ].filter(Boolean);
    if (notes.length) console.log(`          [${notes.join(' | ')}]`);
    if (!history.some((t) => t.who === 'You') && cfg.ws.formUrl.trim()) console.log(`SYSTEM  : ${formMessage(cfg)}`);
    if (justCompleted && applied.service) {
      console.log(`SYSTEM  : (lead created) closing message:\n${completionMessage(cfg, applied.service.key, applied.answers)}`);
      const url = cfg.ws.bookingUrl.trim();
      console.log(`SYSTEM  : contact footer:\n${contactFooter(cfg, { skipLink: !!url && completionMessage(cfg, applied.service.key, applied.answers).includes(url) })}`);
    }
    console.log('');
    history.push({ who: 'Customer', text: line }, { who: 'You', text: turn.reply });
    ({ service, answers, completed, language } = { service: applied.service, answers: applied.answers, completed: applied.completed, language: applied.language });
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
