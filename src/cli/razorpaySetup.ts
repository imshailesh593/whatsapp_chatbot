// Creates the three monthly Razorpay Plans that match our plans and prints the lines to add to .env.
//   node dist/cli/razorpaySetup.js
// In Docker: docker exec <bot-container> node dist/cli/razorpaySetup.js
// Run it once. Razorpay cannot delete plans, so plans that already have an id in .env are left alone.
import dotenv from 'dotenv';
import { checkRazorpay, createPlans, planEnvName } from '../services/razorpaySetup';

dotenv.config();

(async () => {
  const plans = await createPlans();
  console.log('\nAdd these lines to the server .env, then restart the bot:\n');
  for (const p of plans) console.log(`${planEnvName(p.plan)}=${p.razorpayPlanId}${p.created ? '' : '   # already configured, left as it was'}`);
  if (plans.some((p) => p.created)) console.log('\nDo not run this again once the lines are saved: Razorpay would create duplicate plans.');
  console.log('\nChecking against Razorpay...');
  for (const p of plans) process.env[planEnvName(p.plan)] = p.razorpayPlanId;
  for (const c of await checkRazorpay(true)) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.label}: ${c.detail}`);
})().catch((err) => {
  console.error('Razorpay setup failed:', (err as Error).message);
  process.exit(1);
});
