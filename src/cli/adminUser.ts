// Create an admin or reset its password:
//   node dist/cli/adminUser.js <email> <password>
// In Docker: docker compose exec bot node dist/cli/adminUser.js you@example.com 'a-long-password'
import dotenv from 'dotenv';
import { prisma } from '../lib/prisma';
import { MIN_PASSWORD_LENGTH, hashPassword, isValidEmail, normalizeEmail } from '../lib/auth';

dotenv.config();

(async () => {
  const email = normalizeEmail(process.argv[2]);
  const password = process.argv[3] ?? '';
  if (!isValidEmail(email) || password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Usage: adminUser <email> <password (min ${MIN_PASSWORD_LENGTH} chars)>`);
    process.exit(2);
  }
  const passwordHash = await hashPassword(password);
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    await prisma.adminUser.update({ where: { email }, data: { passwordHash } });
    console.log(`Password reset for ${email}`);
  } else {
    await prisma.adminUser.create({ data: { email, passwordHash, workspaceId: 'default-workspace', role: 'owner', isSuperAdmin: true } });
    console.log(`Admin created: ${email}`);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
