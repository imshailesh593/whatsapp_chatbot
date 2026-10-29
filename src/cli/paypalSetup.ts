// Creates the three monthly PayPal plans that match our plans, registers the webhook, and prints the lines to add to .env.
//   node dist/cli/paypalSetup.js
// In Docker: docker exec <bot-container> node dist/cli/paypalSetup.js
// Safe to repeat: PayPal returns the same plans for the same request, and a webhook already on our address is reused.
import dotenv from 'dotenv';
import { checkPaypal, createPaypalPlans, ensurePaypalWebhook, paypalPlanEnv } from '../services/paypal';

dotenv.config();

(async () => {
  const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const plans = await createPaypalPlans();
  console.log('\nAdd these lines to the server .env, then restart the bot:\n');
  for (const p of plans) console.log(`${paypalPlanEnv(p.plan)}=${p.paypalPlanId}${p.created ? '' : '   # already configured, left as it was'}`);
  if (publicUrl) {
    const hook = await ensurePaypalWebhook(`${publicUrl}/webhooks/paypal`);
    console.log(`PAYPAL_WEBHOOK_ID=${hook.id}${hook.created ? '' : '   # webhook already registered'}`);
    process.env.PAYPAL_WEBHOOK_ID = hook.id;
  } else {
    console.log('\nPUBLIC_URL is not set, so the webhook was not registered. Set PUBLIC_URL (for example https://chatbot.example.com) and run this again.');
  }
  for (const p of plans) process.env[paypalPlanEnv(p.plan)] = p.paypalPlanId;
  console.log('\nChecking against PayPal...');
  for (const c of await checkPaypal(true)) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.label}: ${c.detail}`);
})().catch((err) => {
  console.error('PayPal setup failed:', (err as Error).message);
  process.exit(1);
});
