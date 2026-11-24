import { state, resetState, startServer, ageRateLimitEvents, rateLimitEventCount } from './support/standIns';
import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import app from '../src/index';

const LOCKOUT = 'Too many attempts. Please try again later.';
const PASSWORD = 'correct horse battery';
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(app); });
after(async () => { await server.close(); });
beforeEach(() => {
  resetState();
  for (const email of ['ada@example.com', 'grace@example.com']) {
    state.users.push({ id: `user-${email}`, email, passwordHash, role: 'EMPLOYER', isActive: true });
  }
});

async function call(method: string, path: string, body: unknown, options: { ip?: string; token?: string } = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': options.ip ?? '198.51.100.20',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
}
const login = (email: string, password: string, ip?: string) => call('POST', '/api/auth/login', { email, password }, { ip });

function assertLockout(response: Awaited<ReturnType<typeof call>>, maxSeconds: number) {
  assert.equal(response.status, 429);
  assert.equal(response.body.error, LOCKOUT);
  assert.ok(response.body.retryAfterSeconds >= 1 && response.body.retryAfterSeconds <= maxSeconds);
  assert.equal(response.headers.get('retry-after'), String(response.body.retryAfterSeconds));
}

describe('login limits', () => {
  test('a failure is recorded per IP and per email and IP; a success is not recorded', async () => {
    assert.equal((await login('ada@example.com', 'wrong password')).status, 401);
    assert.equal(rateLimitEventCount('login-ip'), 1);
    assert.equal(rateLimitEventCount('login-pair'), 1);
    assert.equal((await login('nobody@example.com', 'anything')).status, 401);
    assert.equal(rateLimitEventCount('login-ip'), 2, 'an unknown email counts the same as a wrong password');
    const success = await login('ada@example.com', PASSWORD);
    assert.equal(success.status, 200);
    assert.ok(success.body.token);
    assert.equal(state.rateLimitEvents.length, 4, 'the success added nothing');
  });

  test('five failures lock that email from that IP, even with the right password; other emails and IPs are unaffected', async () => {
    for (let index = 0; index < 5; index += 1) assert.equal((await login('ada@example.com', 'wrong password')).status, 401);
    assertLockout(await login('ada@example.com', PASSWORD), 15 * 60);
    assert.equal(rateLimitEventCount('login-pair'), 5, 'the blocked attempt is not counted');

    assert.equal((await login('grace@example.com', PASSWORD)).status, 200, 'another email from the same computer still logs in');
    assert.equal((await login('ada@example.com', PASSWORD, '203.0.113.50')).status, 200, 'the same email from elsewhere is not locked (never keyed on the email alone)');
    assert.equal((await login('ADA@example.com ', 'wrong password')).status, 429, 'case and spacing do not get around it');

    ageRateLimitEvents(15 * 60 + 1);
    assert.equal((await login('ada@example.com', PASSWORD)).status, 200, 'the right password works again after the window');
  });

  test('the lockout looks the same whether or not the account exists', async () => {
    for (let index = 0; index < 5; index += 1) {
      await login('ada@example.com', 'wrong password');
      await login('nobody@example.com', 'wrong password');
    }
    const existing = await login('ada@example.com', 'wrong password');
    const missing = await login('nobody@example.com', 'wrong password');
    assert.equal(existing.status, missing.status);
    assert.equal(existing.body.error, missing.body.error);
    assert.deepEqual(Object.keys(existing.body).sort(), Object.keys(missing.body).sort());
  });

  test('twenty failures from one IP, across any emails, block that IP', async () => {
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await login(`person${index}@example.com`, 'wrong password')).status, 401);
    }
    assertLockout(await login('grace@example.com', PASSWORD), 15 * 60);
    assert.equal((await login('grace@example.com', PASSWORD, '203.0.113.60')).status, 200);
  });

  test('fails open: logins work when the rate-limit table cannot be used', async () => {
    state.rateLimitTableDown = true;
    assert.equal((await login('ada@example.com', 'wrong password')).status, 401);
    assert.equal((await login('ada@example.com', PASSWORD)).status, 200);
  });
});

describe('change-password limit', () => {
  const token = () => jwt.sign({ id: 'user-ada@example.com', role: 'EMPLOYER' }, process.env.JWT_SECRET as string);
  const change = (currentPassword: string) =>
    call('PATCH', '/api/auth/change-password', { currentPassword, newPassword: 'a brand new password' }, { token: token() });

  test('five wrong current passwords lock the user out for 15 minutes; a success is not recorded', async () => {
    for (let index = 0; index < 5; index += 1) assert.equal((await change('wrong password')).status, 400);
    assertLockout(await change(PASSWORD), 15 * 60);
    assert.equal(rateLimitEventCount('pwd'), 5);

    ageRateLimitEvents(15 * 60 + 1);
    assert.equal((await change(PASSWORD)).status, 200);
    assert.equal(rateLimitEventCount('pwd'), 5, 'the success added nothing');
  });
});

describe('password check timing', () => {
  test('an unknown email still runs a bcrypt comparison, against one dummy hash with the real cost', async (t) => {
    const compare = t.mock.method(bcrypt, 'compare');
    assert.equal((await login('nobody@example.com', 'a password')).status, 401);
    assert.equal(compare.mock.callCount(), 1, 'the unknown-email path compared once');
    const [plain, dummy] = compare.mock.calls[0].arguments as unknown as [string, string];
    assert.equal(plain, 'a password');
    assert.match(dummy, /^\$2[aby]\$10\$/, 'cost 10, the same as real password hashes');
    assert.notEqual(dummy, passwordHash);

    await login('someone-else@example.com', 'another password');
    assert.equal((compare.mock.calls[1].arguments as unknown as string[])[1], dummy, 'the dummy hash is made once and reused');

    await login('ada@example.com', 'wrong password');
    assert.equal(compare.mock.callCount(), 3, 'a known email compares once too');
    assert.equal((compare.mock.calls[2].arguments as unknown as string[])[1], passwordHash, 'against the account\'s own hash');
  });

  test('change-password with no account behind the token also runs the comparison', async (t) => {
    const compare = t.mock.method(bcrypt, 'compare');
    const token = jwt.sign({ id: 'user-that-does-not-exist', role: 'EMPLOYER' }, process.env.JWT_SECRET as string);
    const response = await call('PATCH', '/api/auth/change-password', { currentPassword: 'a password', newPassword: 'a brand new password' }, { token });
    assert.equal(response.status, 401);
    assert.equal(compare.mock.callCount(), 1);
    assert.match((compare.mock.calls[0].arguments as unknown as string[])[1], /^\$2[aby]\$10\$/);
  });
});

describe('registration limit', () => {
  const employer = (index: number) => ({ email: `new${index}@example.com`, password: 'a good password', companyName: 'Acme' });

  test('five registrations per IP per hour across all three forms; the sixth gets 429', async () => {
    assert.equal((await call('POST', '/api/auth/register/employer', employer(1))).status, 201, 'a normal registration works');
    assert.equal((await call('POST', '/api/auth/register/institution', {})).status, 400);
    assert.equal((await call('POST', '/api/auth/register/student', {})).status, 400);
    assert.equal((await call('POST', '/api/auth/register/employer', employer(2))).status, 201);
    assert.equal((await call('POST', '/api/auth/register/employer', employer(3))).status, 201);
    assertLockout(await call('POST', '/api/auth/register/employer', employer(4)), 60 * 60);
    assertLockout(await call('POST', '/api/auth/register/institution', {}), 60 * 60);
    assert.equal(state.users.filter((user) => user.email === 'new4@example.com').length, 0, 'the blocked registration created nothing');

    assert.equal((await call('POST', '/api/auth/register/employer', employer(5), { ip: '203.0.113.70' })).status, 201, 'another IP is unaffected');
  });
});
