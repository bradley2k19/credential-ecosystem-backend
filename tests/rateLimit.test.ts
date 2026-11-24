import './support/standIns';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, longestWait, type RateLimitStore } from '../src/utils/rateLimit';

const RULE = { scope: 'unit', limit: 3, windowSeconds: 60 };
const T0 = new Date('2026-11-24T10:00:00.000Z').getTime();

/** An in-memory store, a clock that only moves when told, and a record of what was logged. */
function setup(options: { random?: number; failing?: boolean } = {}) {
  const events: { scope: string; keyHash: string; createdAt: Date }[] = [];
  const deletedBefore: Date[] = [];
  const logged: string[] = [];
  let time = T0;
  const fail = () => {
    if (options.failing) throw new Error('database unavailable');
  };
  const store: RateLimitStore = {
    async recentEvents(scope, keyHash, since, take) {
      fail();
      return events
        .filter((event) => event.scope === scope && event.keyHash === keyHash && event.createdAt > since)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, take);
    },
    async addEvent(scope, keyHash, createdAt) {
      fail();
      events.push({ scope, keyHash, createdAt });
    },
    async deleteOlderThan(cutoff) {
      fail();
      deletedBefore.push(cutoff);
    }
  };
  const limiter = createRateLimiter({
    store,
    secret: 'unit-secret',
    now: () => new Date(time),
    random: () => options.random ?? 0.5,
    logError: (message, error) => logged.push(`${message} ${error instanceof Error ? error.message : String(error)}`)
  });
  return { limiter, events, deletedBefore, logged, at: (seconds: number) => { time = T0 + seconds * 1000; } };
}

describe('rate limiter', () => {
  test('allows up to the limit, then blocks with retryAfterSeconds counted from the oldest event in the window', async () => {
    const { limiter, events, at } = setup();
    for (const second of [0, 10, 20]) {
      at(second);
      assert.deepEqual(await limiter.checkAndRecord(RULE, '203.0.113.7'), { allowed: true });
    }
    at(30);
    assert.deepEqual(await limiter.checkAndRecord(RULE, '203.0.113.7'), { allowed: false, retryAfterSeconds: 30 });
    assert.equal(events.length, 3, 'a blocked request is not recorded');
  });

  test('retryAfterSeconds rounds up and is never below one second', async () => {
    const { limiter, at } = setup();
    for (const second of [0, 1, 2]) {
      at(second);
      await limiter.checkAndRecord(RULE, 'key');
    }
    at(59.2);
    assert.deepEqual(await limiter.checkAndRecord(RULE, 'key'), { allowed: false, retryAfterSeconds: 1 });
  });

  test('allows again once the oldest event leaves the window', async () => {
    const { limiter, at } = setup();
    for (const second of [0, 10, 20]) {
      at(second);
      await limiter.checkAndRecord(RULE, 'key');
    }
    at(59.999);
    assert.equal((await limiter.checkAndRecord(RULE, 'key')).allowed, false);
    at(60);
    assert.deepEqual(await limiter.checkAndRecord(RULE, 'key'), { allowed: true });
    at(65);
    assert.deepEqual(await limiter.checkAndRecord(RULE, 'key'), { allowed: false, retryAfterSeconds: 5 });
  });

  test('when more than the limit are recorded (concurrent requests), the wait covers enough of them to expire', async () => {
    const { limiter, events, at } = setup();
    const keyHash = limiter.hashKey(RULE.scope, 'key');
    for (const second of [0, 5, 10, 15, 20]) events.push({ scope: RULE.scope, keyHash, createdAt: new Date(T0 + second * 1000) });
    at(30);
    // Five events, limit three: the third newest (at 10 s) must leave the window, at 70 s.
    assert.deepEqual(await limiter.check(RULE, 'key'), { allowed: false, retryAfterSeconds: 40 });
  });

  test('keys are counted separately per key and per scope', async () => {
    const { limiter } = setup();
    for (let index = 0; index < 3; index += 1) await limiter.checkAndRecord(RULE, 'first');
    assert.equal((await limiter.checkAndRecord(RULE, 'first')).allowed, false);
    assert.equal((await limiter.checkAndRecord(RULE, 'second')).allowed, true);
    assert.equal((await limiter.checkAndRecord({ ...RULE, scope: 'other' }, 'first')).allowed, true);
  });

  test('keys are stored only as an HMAC-SHA256, never raw', async () => {
    const { limiter, events } = setup();
    await limiter.checkAndRecord(RULE, '203.0.113.7');
    await limiter.record(RULE, 'someone@example.com\n203.0.113.7');
    for (const event of events) {
      assert.match(event.keyHash, /^[0-9a-f]{64}$/);
      assert.ok(!event.keyHash.includes('203.0.113.7') && !event.keyHash.includes('someone'));
    }
    assert.equal(limiter.hashKey('a', 'key'), limiter.hashKey('a', 'key'));
    assert.notEqual(limiter.hashKey('a', 'key'), limiter.hashKey('b', 'key'));
    const otherSecret = createRateLimiter({ store: {} as RateLimitStore, secret: 'another-secret' });
    assert.notEqual(otherSecret.hashKey('a', 'key'), limiter.hashKey('a', 'key'));
  });

  test('check only counts; record only records', async () => {
    const { limiter, events } = setup();
    assert.deepEqual(await limiter.check(RULE, 'key'), { allowed: true });
    assert.equal(events.length, 0);
    for (let index = 0; index < 3; index += 1) await limiter.record(RULE, 'key');
    assert.equal(events.length, 3);
    assert.equal((await limiter.check(RULE, 'key')).allowed, false);
    assert.equal(events.length, 3);
  });

  test('fails open: a database failure allows the request and is logged without the key', async () => {
    const { limiter, logged } = setup({ failing: true });
    assert.deepEqual(await limiter.checkAndRecord(RULE, '203.0.113.7'), { allowed: true });
    assert.deepEqual(await limiter.check(RULE, '203.0.113.7'), { allowed: true });
    await assert.doesNotReject(limiter.record(RULE, '203.0.113.7'));
    assert.equal(logged.length, 3);
    assert.ok(logged.every((line) => line.includes('database unavailable') && !line.includes('203.0.113.7')));
  });

  test('deletes events older than a day on about one call in fifty, and only then', async () => {
    const lucky = setup({ random: 0.01 });
    lucky.at(100);
    await lucky.limiter.checkAndRecord(RULE, 'key');
    await lucky.limiter.record(RULE, 'key');
    assert.deepEqual(lucky.deletedBefore.map((cutoff) => cutoff.getTime()), [T0 + 100_000 - 86_400_000, T0 + 100_000 - 86_400_000]);

    const usual = setup({ random: 0.5 });
    await usual.limiter.checkAndRecord(RULE, 'key');
    await usual.limiter.record(RULE, 'key');
    assert.equal(usual.deletedBefore.length, 0);
  });

  test('longestWait picks the longest wait among blocked decisions', () => {
    assert.equal(longestWait([{ allowed: true }, { allowed: true }]), null);
    assert.equal(longestWait([{ allowed: false, retryAfterSeconds: 30 }, { allowed: true }, { allowed: false, retryAfterSeconds: 90 }]), 90);
  });
});
