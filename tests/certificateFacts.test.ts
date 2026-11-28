import { state, resetState, startServer } from './support/standIns';
import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { computeCertificateHash, generateCertificateHash } from '../src/utils/certificateHash';

const INSTITUTION = { id: 'bbbbbbbb-0000-4000-8000-000000000001', userId: 'institution-user', name: 'Example University', brandColor: null, logoAssetId: null, sealAssetId: null };
const STUDENT = { id: 'aaaaaaaa-0000-4000-8000-000000000001', userId: 'student-user', institutionId: INSTITUTION.id, fullName: 'Ada Lovelace', studentNumber: 'STU-001' };
const tokenFor = (id: string, role: string) => jwt.sign({ id, role }, process.env.JWT_SECRET as string);

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(app); });
after(async () => { await server.close(); });
beforeEach(() => {
  resetState();
  state.institutions.push({ ...INSTITUTION });
  state.students.push({ ...STUDENT });
});

async function call(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
const verify = (uid: string) => call('GET', `/api/verify/${uid}`);
const asInstitution = () => tokenFor(INSTITUTION.userId, 'INSTITUTION');
const asStudent = () => tokenFor(STUDENT.userId, 'STUDENT');

/** Issues a certificate through the real endpoint and records its hash on the stand-in chain. */
async function issue() {
  const response = await call('POST', '/api/institutions/certificates', {
    token: asInstitution(),
    body: { studentId: STUDENT.id, certificateType: 'Bachelor of Science', programName: 'Computer Science', classification: 'First Class Honours', issueDate: '2026-09-16', graduationDate: '2026-06-30' }
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  state.chain.set(response.body.certificateUid, { certificateHash: response.body.certificateHash, revoked: false, issuedAt: 1790000000n });
  const row = state.certificates.find((certificate) => certificate.certificateUid === response.body.certificateUid)!;
  return { response, row };
}

/** A version 1 certificate as issued before this change (no frozen facts), on the chain. */
function addVersion1Certificate() {
  const fields = {
    certificateUid: '11111111-0000-4000-8000-000000000001',
    studentId: STUDENT.id,
    institutionId: INSTITUTION.id,
    certificateType: 'Bachelor of Science',
    programName: 'Computer Science',
    classification: 'First Class Honours',
    issueDate: new Date('2025-09-16T00:00:00.000Z')
  };
  const certificateHash = generateCertificateHash(fields);
  const row = {
    ...fields,
    id: 'cccccccc-0000-4000-8000-000000000001',
    graduationDate: null,
    certificateHash,
    status: 'ACTIVE' as const,
    revokedReason: null,
    renderSnapshot: { snapshotVersion: 1, template: { id: null, name: 'Classic' }, design: {}, institution: { name: 'Example University (as at issue)', brandColor: null, logoAssetId: null, sealAssetId: null }, signatories: [] }
  };
  state.certificates.push(row);
  state.chain.set(fields.certificateUid, { certificateHash, revoked: false, issuedAt: 1790000000n });
  return row;
}

describe('issuance (hash version 2)', () => {
  test('stores the frozen facts and hash version 2, and returns the hash of exactly what was stored', async () => {
    const { response, row } = await issue();
    assert.equal(row.hashVersion, 2);
    assert.equal(row.studentNameAtIssue, 'Ada Lovelace');
    assert.equal(row.studentNumberAtIssue, 'STU-001');
    assert.equal(row.institutionNameAtIssue, 'Example University');
    assert.equal(row.certificateHash, computeCertificateHash(row as never), 'the stored hash is the dispatcher\'s hash of the stored row');
    assert.equal(response.body.certificateHash, row.certificateHash, 'the hash sent to the chain is the version 2 hash');
    assert.match(row.certificateHash, /^0x[0-9a-f]{64}$/);
    assert.notEqual(row.certificateHash, computeCertificateHash({ ...row, hashVersion: 1 } as never));
  });
});

describe('verifying a version 2 certificate', () => {
  test('is valid and shows the frozen facts everywhere, including the name drawn on the certificate', async () => {
    const { row } = await issue();
    const { body } = await verify(row.certificateUid);
    assert.equal(body.result, 'valid');
    assert.equal(body.certificate.studentName, 'Ada Lovelace');
    assert.equal(body.certificate.studentNumber, 'STU-001');
    assert.equal(body.certificate.institutionName, 'Example University');
    assert.equal(body.render.data.studentName, 'Ada Lovelace');
    assert.equal(body.render.data.graduationDate, '2026-06-30T00:00:00.000Z');
    assert.equal(body.render.snapshot.institution.name, 'Example University');
    assert.ok(!JSON.stringify(body).includes(row.certificateHash.slice(2)), 'no hash in the public response');
  });

  test('editing the student through the app changes nothing on the issued certificate', async () => {
    const { row } = await issue();
    const edit = await call('PUT', `/api/institutions/students/${STUDENT.id}`, { token: asInstitution(), body: { fullName: 'Ada King' } });
    assert.equal(edit.status, 200);
    assert.equal(state.students[0].fullName, 'Ada King', 'the live record did change');

    const { body } = await verify(row.certificateUid);
    assert.equal(body.result, 'valid');
    assert.equal(body.certificate.studentName, 'Ada Lovelace');
    assert.equal(body.render.data.studentName, 'Ada Lovelace');

    // A renamed institution does not change it either.
    state.institutions[0].name = 'Renamed University';
    const again = await verify(row.certificateUid);
    assert.equal(again.body.result, 'valid');
    assert.equal(again.body.certificate.institutionName, 'Example University');
    assert.equal(again.body.render.snapshot.institution.name, 'Example University');
  });

  for (const [what, change] of [
    ['the frozen student name', { studentNameAtIssue: 'Mallory' }],
    ['the frozen student number', { studentNumberAtIssue: 'STU-999' }],
    ['the frozen institution name', { institutionNameAtIssue: 'Fake University' }],
    ['the graduation date', { graduationDate: new Date('2026-07-01T00:00:00.000Z') }],
    ['the graduation date (removed)', { graduationDate: null }],
    ['the classification', { classification: 'Pass' }],
    ['the hash version (downgraded to 1)', { hashVersion: 1 }],
    ['the hash version (unknown)', { hashVersion: 3 }]
  ] as const) {
    test(`altering ${what} in the database makes it tampered, with nothing drawn`, async () => {
      const { row } = await issue();
      Object.assign(row, change);
      const { body } = await verify(row.certificateUid);
      assert.equal(body.result, 'tampered');
      assert.equal(body.render, undefined);
      assert.equal(body.certificate, undefined);
    });
  }

  test('altering the institution name inside the stored snapshot cannot change the name drawn', async () => {
    const { row } = await issue();
    row.renderSnapshot = { ...(row.renderSnapshot as object), institution: { ...(row.renderSnapshot as any).institution, name: 'Fake University' } };
    const { body } = await verify(row.certificateUid);
    assert.equal(body.result, 'valid');
    assert.equal(body.render.snapshot.institution.name, 'Example University', 'the hashed, frozen name is drawn');
  });
});

describe('the institution and student certificate pages (version 2)', () => {
  test('return the frozen facts in the same fields, even after the student is edited', async () => {
    const { row } = await issue();
    await call('PUT', `/api/institutions/students/${STUDENT.id}`, { token: asInstitution(), body: { fullName: 'Ada King' } });
    state.institutions[0].name = 'Renamed University';

    const institutionView = await call('GET', `/api/institutions/certificates/${row.id}`, { token: asInstitution() });
    assert.equal(institutionView.status, 200);
    assert.deepEqual(institutionView.body.student, { fullName: 'Ada Lovelace', studentNumber: 'STU-001' });
    assert.equal(institutionView.body.institutionName, 'Example University');
    assert.equal(institutionView.body.renderSnapshot.institution.name, 'Example University');
    assert.equal(institutionView.body.certificateHash, undefined, 'no hash');

    const studentView = await call('GET', `/api/students/me/certificates/${row.id}`, { token: asStudent() });
    assert.equal(studentView.status, 200);
    assert.deepEqual(studentView.body.student, { fullName: 'Ada Lovelace', studentNumber: 'STU-001' });
    assert.equal(studentView.body.institutionName, 'Example University');
    assert.equal(studentView.body.renderSnapshot.institution.name, 'Example University');
    assert.ok(!JSON.stringify(studentView.body).includes(row.certificateHash.slice(2)), 'no hash');
    for (const internal of ['hashVersion', 'studentNameAtIssue', 'studentNumberAtIssue', 'institutionNameAtIssue']) {
      assert.ok(!(internal in studentView.body) && !(internal in institutionView.body), `${internal} is not sent`);
    }
  });
});

describe('version 1 certificates (as before)', () => {
  test('verify as today: the original hash, the live records, and the stored snapshot name drawn', async () => {
    const row = addVersion1Certificate();
    const { body } = await verify(row.certificateUid);
    assert.equal(body.result, 'valid');
    assert.equal(body.certificate.studentName, 'Ada Lovelace');
    assert.equal(body.certificate.institutionName, 'Example University');
    assert.equal(body.render.snapshot.institution.name, 'Example University (as at issue)', 'the snapshot name, unchanged behaviour');
    assert.equal(computeCertificateHash({ ...row, hashVersion: 1, studentNameAtIssue: null, studentNumberAtIssue: null, institutionNameAtIssue: null } as never), row.certificateHash);

    // As before, a version 1 certificate shows the live student record.
    state.students[0].fullName = 'Ada King';
    const after = await verify(row.certificateUid);
    assert.equal(after.body.result, 'valid');
    assert.equal(after.body.certificate.studentName, 'Ada King');

    const studentView = await call('GET', `/api/students/me/certificates/${row.id}`, { token: asStudent() });
    assert.equal(studentView.body.student.fullName, 'Ada King');
  });

  test('a changed classification is still tampered, and upgrading the version to 2 is tampered too', async () => {
    const row = addVersion1Certificate();
    Object.assign(row, { classification: 'Pass' });
    assert.equal((await verify(row.certificateUid)).body.result, 'tampered');
    Object.assign(row, { classification: 'First Class Honours', hashVersion: 2, studentNameAtIssue: 'Ada Lovelace', studentNumberAtIssue: 'STU-001', institutionNameAtIssue: 'Example University' });
    assert.equal((await verify(row.certificateUid)).body.result, 'tampered');
  });
});
