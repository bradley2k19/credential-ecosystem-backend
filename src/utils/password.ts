import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

// A hash of a random value nobody knows, made once at start-up with the same cost as real hashes. When there is no
// account to check a password against, the password is compared with this instead, so that takes as long as
// checking a real account's password and the response time does not reveal whether an account exists.
const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);
// Never an unhandled rejection at start-up; a failure would surface on the first comparison that needs it.
dummyHash.catch(() => undefined);

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/**
 * Checks a password against an account's hash. Without an account (`hash` missing) it still runs a bcrypt
 * comparison, against the dummy hash, and returns false, so both cases take about the same time.
 */
export async function verifyPassword(plain: string, hash: string | null | undefined) {
  if (hash) return bcrypt.compare(plain, hash);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}

export default { hashPassword, comparePassword, verifyPassword };
