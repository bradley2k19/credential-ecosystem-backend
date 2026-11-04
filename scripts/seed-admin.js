// Creates the first platform administrator: `npm run seed:admin`.
// Run manually from a trusted machine against the target database. Never part of a build or deploy.
// Reads ADMIN_EMAIL and ADMIN_PASSWORD from the environment (or .env) and never prints the password.
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

// Must match SALT_ROUNDS in src/utils/password.ts so login can verify the hash.
const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 12;
const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!emailRegex.test(email)) {
    console.error('ADMIN_EMAIL must be set to a valid email address.');
    return 1;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`ADMIN_PASSWORD must be set and at least ${MIN_PASSWORD_LENGTH} characters long.`);
    return 1;
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { role: true } });
    if (existing) {
      console.log(existing.role === 'ADMIN'
        ? `An admin account for ${email} already exists. Nothing was changed.`
        : `A ${existing.role} account already uses ${email}. Nothing was changed; choose a different ADMIN_EMAIL.`);
      return existing.role === 'ADMIN' ? 0 : 1;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.create({ data: { email, passwordHash, role: 'ADMIN' } });
    console.log(`Admin account created for ${email}.`);
    return 0;
  } catch (error) {
    // Only the error type and code: Prisma messages can echo query arguments.
    console.error(`Could not create the admin account (${error && error.name ? error.name : 'Error'}${error && error.code ? ` ${error.code}` : ''}).`);
    console.error('Check DATABASE_URL and that the add_admin_role migration has been applied.');
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => { process.exitCode = code; });
