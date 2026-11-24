import { state, resetState, startServer, ageRateLimitEvents, rateLimitEventCount } from './support/standIns';
import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import { generateCertificateHash } from '../src/utils/certificateHash';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(app); });
after(async () => { await server.close(); });
beforeEach(() => resetState());

let counter = 0;
/** Adds a certificate to the stand-in database and its record to the stand-in chain. */
function addCertificate(options: { status?: 'ACTIVE' | 'REVOKED'; revokedReason?: string | null; chainRevoked?: boolean; chainHash?: string; onChain?: boolean } = {}) {
  counter += 1;
  const uid = `11111111-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  const fields = {
    studentId: 'aaaaaaaa-0000-4000-8000-000000000001',
    institutionId: 'bbbbbbbb-0000-4000-8000-000000000001',
    certificateType: 'Bachelor of Science',
    programName: 'Computer Science',
    classification: 'First Class Honours',
    issueDate: new Date('2026-09-16T00:00:00.000Z'),
    certificateUid: uid
  };
  const hash = generateCertificateHash(fields);
  const certificate = {
    ...fields,
    id: `cccccccc-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    graduationDate: null,
    certificateHash: hash,
    status: options.status ?? 'ACTIVE',
    revokedReason: options.revokedReason ?? null,
    renderSnapshot: null,
    student: { fullName: 'Sample Student', studentNumber: 'STU-001' },
    institution: { id: fields.institutionId, name: 'Example University' }
  };
  state.certificates.push(certificate);
  if (options.onChain !== false) {
    state.chain.set(uid, { certificateHash: options.chainHash ?? hash, revoked: options.chainRevoked ?? false, issuedAt: 1790000000n });
  }
  return certificate;
}

async function verify(uid: string, ip = '198.51.100.10') {
  const response = await fetch(`${server.url}/api/verify/${uid}?method=qr`, { headers: { 'X-Forwarded-For': ip } });
  return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
}

const mismatchEntries = () => state.auditLogs.filter((row) => row.action === 'VERIFICATION_STATUS_MISMATCH');

describe('status cross-check with the on-chain revoked flag', () => {
  for (const row of [
    { database: 'ACTIVE', chain: false, result: 'valid', revocation: undefined, logged: 'VALID' },
    { database: 'REVOKED', chain: true, result: 'revoked', revocation: { onChain: true, statusMismatch: false }, logged: 'REVOKED' },
    { database: 'REVOKED', chain: false, result: 'revoked', revocation: { onChain: false, statusMismatch: false }, logged: 'REVOKED' },
    { database: 'ACTIVE', chain: true, result: 'revoked', revocation: { onChain: true, statusMismatch: true }, logged: 'REVOKED' }
  ] as const) {
    test(`database ${row.database}, on-chain revoked ${row.chain} -> ${row.result}`, async () => {
      const certificate = addCertificate({ status: row.database, chainRevoked: row.chain });
      const { status, body } = await verify(certificate.certificateUid);
      assert.equal(status, 200);
      assert.equal(body.result, row.result);
      assert.deepEqual(body.revocation, row.revocation);
      assert.ok(body.render, 'the certificate is still drawn for valid and revoked results');
      assert.deepEqual(state.verifications.map((entry) => entry.result), [row.logged]);
      assert.equal(state.certificateWrites, 0, 'verification never changes a certificate');
      assert.equal(certificate.status, row.database);
      assert.equal(mismatchEntries().length, row.database === 'ACTIVE' && row.chain ? 1 : 0);
    });
  }

  test('a revoked result keeps the database reason, and a mismatch without one returns null', async () => {
    const withReason = addCertificate({ status: 'REVOKED', revokedReason: 'Issued in error', chainRevoked: true });
    assert.equal((await verify(withReason.certificateUid)).body.revokedReason, 'Issued in error');
    const mismatch = addCertificate({ status: 'ACTIVE', chainRevoked: true });
    const { body } = await verify(mismatch.certificateUid);
    assert.ok('revokedReason' in body);
    assert.equal(body.revokedReason, null);
  });

  test('a hash mismatch still returns tampered first, even when the chain says revoked', async () => {
    for (const status of ['ACTIVE', 'REVOKED'] as const) {
      const certificate = addCertificate({ status, chainRevoked: true, chainHash: `0x${'ab'.repeat(32)}` });
      const { body } = await verify(certificate.certificateUid);
      assert.equal(body.result, 'tampered');
      assert.equal(body.revocation, undefined);
    }
    assert.deepEqual(state.verifications.map((entry) => entry.result), ['TAMPERED', 'TAMPERED']);
    assert.equal(mismatchEntries().length, 0);
  });

  test('pending-chain and not found are unchanged', async () => {
    const pending = addCertificate({ status: 'REVOKED', onChain: false });
    assert.equal((await verify(pending.certificateUid)).body.result, 'pending-chain');
    const unknown = await verify('99999999-0000-4000-8000-000000000099');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.result, 'not_found');
    assert.deepEqual(state.verifications.map((entry) => entry.result), ['PENDING_CHAIN', 'NOT_FOUND']);
  });
});

describe('status mismatch audit entry', () => {
  test('is written once, with no user, the certificate uid and both statuses, and no hash', async () => {
    const certificate = addCertificate({ status: 'ACTIVE', chainRevoked: true });
    await verify(certificate.certificateUid);
    const [entry] = mismatchEntries();
    assert.equal(entry.userId, null);
    assert.equal(entry.entityType, 'certificate');
    assert.equal(entry.entityId, certificate.id);
    assert.deepEqual(entry.details, { certificateUid: certificate.certificateUid, databaseStatus: 'ACTIVE', onChainRevoked: true });
    assert.ok(!JSON.stringify(entry).includes(certificate.certificateHash.slice(2)), 'no hash in the entry');
  });

  test('is written at most once per certificate per hour', async () => {
    const certificate = addCertificate({ status: 'ACTIVE', chainRevoked: true });
    const other = addCertificate({ status: 'ACTIVE', chainRevoked: true });
    for (let index = 0; index < 4; index += 1) await verify(certificate.certificateUid);
    assert.equal(mismatchEntries().length, 1, 'repeated verifications within the hour add nothing');
    await verify(other.certificateUid);
    assert.equal(mismatchEntries().length, 2, 'another certificate gets its own entry');

    // An hour later (the existing entry is 61 minutes old), the next verification writes a new one.
    mismatchEntries()[0].createdAt = new Date(Date.now() - 61 * 60 * 1000);
    await verify(certificate.certificateUid);
    assert.equal(mismatchEntries().filter((entry) => entry.entityId === certificate.id).length, 2);
    // Every one of these verifications was still logged as REVOKED.
    assert.ok(state.verifications.every((entry) => entry.result === 'REVOKED'));
  });
});

describe('verification rate limit', () => {
  test('30 requests per minute per IP; the 31st gets 429 with Retry-After and writes no verification row', async () => {
    const certificate = addCertificate();
    for (let index = 0; index < 30; index += 1) assert.equal((await verify(certificate.certificateUid)).status, 200);
    const blocked = await verify(certificate.certificateUid);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too many verification requests. Please wait a minute and try again.');
    assert.ok(Number.isInteger(blocked.body.retryAfterSeconds) && blocked.body.retryAfterSeconds >= 1 && blocked.body.retryAfterSeconds <= 60);
    assert.equal(blocked.headers.get('retry-after'), String(blocked.body.retryAfterSeconds));
    assert.equal(state.verifications.length, 30, 'the blocked request was not logged');
    assert.equal(rateLimitEventCount('verify'), 30, 'the blocked request was not counted');

    // Another address is not affected; the first one is allowed again once the minute has passed.
    assert.equal((await verify(certificate.certificateUid, '198.51.100.99')).status, 200);
    ageRateLimitEvents(61);
    assert.equal((await verify(certificate.certificateUid)).status, 200);
  });

  test('the verification log and the limiter use the same client IP', async () => {
    const certificate = addCertificate();
    await verify(certificate.certificateUid, '203.0.113.45');
    assert.equal(state.verifications[0].ipAddress, '203.0.113.45');
    assert.ok(state.rateLimitEvents.every((event) => !event.keyHash.includes('203.0.113.45')), 'the raw IP is not stored');
  });

  test('fails open: if the rate-limit table cannot be used, verification still works', async () => {
    const certificate = addCertificate();
    state.rateLimitTableDown = true;
    const { status, body } = await verify(certificate.certificateUid);
    assert.equal(status, 200);
    assert.equal(body.result, 'valid');
    assert.equal(state.verifications.length, 1);
  });
});
