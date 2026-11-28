import { state, resetState, startServer, EMPLOYER_NAME } from './support/standIns';
import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { generateCertificateHash } from '../src/utils/certificateHash';
import { notificationText } from '../src/utils/notifications';

const INSTITUTION = { id: 'bbbbbbbb-0000-4000-8000-000000000001', userId: 'institution-user', name: 'Example University', brandColor: null, logoAssetId: null, sealAssetId: null };
const OTHER_INSTITUTION = { id: 'bbbbbbbb-0000-4000-8000-000000000002', userId: 'other-institution-user', name: 'Other College', brandColor: null, logoAssetId: null, sealAssetId: null };
const STUDENT = { id: 'aaaaaaaa-0000-4000-8000-000000000001', userId: 'student-user', institutionId: INSTITUTION.id, fullName: 'Ada Lovelace', studentNumber: 'STU-001' };
const OTHER_STUDENT = { id: 'aaaaaaaa-0000-4000-8000-000000000002', userId: 'student-user-2', institutionId: INSTITUTION.id, fullName: 'Grace Hopper', studentNumber: 'STU-002' };
const token = (id: string, role: string) => jwt.sign({ id, role }, process.env.JWT_SECRET as string);
const asInstitution = () => token(INSTITUTION.userId, 'INSTITUTION');
const asOtherInstitution = () => token(OTHER_INSTITUTION.userId, 'INSTITUTION');
const asStudent = () => token(STUDENT.userId, 'STUDENT');
const asOtherStudent = () => token(OTHER_STUDENT.userId, 'STUDENT');

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(app); });
after(async () => { await server.close(); });
beforeEach(() => {
  resetState();
  state.institutions.push({ ...INSTITUTION }, { ...OTHER_INSTITUTION });
  state.students.push({ ...STUDENT }, { ...OTHER_STUDENT });
  for (const id of [STUDENT.userId, OTHER_STUDENT.userId, INSTITUTION.userId, OTHER_INSTITUTION.userId]) {
    state.users.push({ id, email: `${id}@example.test`, notifyOnVerification: true });
  }
});

let ipCounter = 0;
async function call(method: string, path: string, options: { body?: unknown; token?: string; ip?: string } = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // A fresh address per call unless one is given, so the verification rate limit never interferes.
      'X-Forwarded-For': options.ip ?? `198.51.100.${(ipCounter++ % 250) + 1}`,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* CSV */ }
  return { status: response.status, body };
}

const notificationsOf = (userId: string) => state.notifications.filter((notification) => notification.userId === userId);

/** Issues a certificate through the real endpoint (and records it on the stand-in chain). */
async function issue(extra: Record<string, unknown> = {}, studentId = STUDENT.id) {
  const response = await call('POST', '/api/institutions/certificates', {
    token: asInstitution(),
    body: { studentId, certificateType: 'Bachelor of Science', programName: 'Computer Science', classification: 'First Class Honours', issueDate: '2026-09-16', graduationDate: '2026-06-30', ...extra }
  });
  if (response.status === 201) {
    state.chain.set(response.body.certificateUid, { certificateHash: response.body.certificateHash, revoked: false, issuedAt: 1790000000n });
  }
  return response;
}

const DETAILS = 'My name is misspelled: it should read Ada Lovelace, not Ada Lovelase.';
const requestCorrection = (certificateId: string, requestDetails = DETAILS, studentToken = asStudent()) =>
  call('POST', `/api/students/me/certificates/${certificateId}/correction-requests`, { token: studentToken, body: { requestDetails } });
const approve = (requestId: string, note?: string, institutionToken = asInstitution()) =>
  call('POST', `/api/institutions/correction-requests/${requestId}/approve`, { token: institutionToken, body: note === undefined ? {} : { note } });
const reject = (requestId: string, note?: string) =>
  call('POST', `/api/institutions/correction-requests/${requestId}/reject`, { token: asInstitution(), body: note === undefined ? {} : { note } });
const revoke = (certificateId: string, revokedReason: string) =>
  call('PATCH', `/api/institutions/certificates/${certificateId}/revoke`, { token: asInstitution(), body: { revokedReason } });

describe('notification triggers', () => {
  test('issuing notifies the student (and only the student)', async () => {
    const { body } = await issue();
    const [notice] = notificationsOf(STUDENT.userId);
    assert.equal(notice.type, 'CERT_ISSUED');
    assert.equal(notice.message, 'Example University issued you a Bachelor of Science certificate in Computer Science.');
    assert.equal(notice.relatedCertificateId, body.id);
    assert.equal(notificationsOf(INSTITUTION.userId).length, 0);
  });

  test('revoking notifies the student with the reason', async () => {
    const { body } = await issue();
    assert.equal((await revoke(body.id, 'Issued in error')).status, 200);
    const notice = notificationsOf(STUDENT.userId).find((item) => item.type === 'CERT_REVOKED')!;
    assert.equal(notice.message, 'Your Bachelor of Science certificate was revoked. Reason: Issued in error.');
    assert.equal(notice.relatedCertificateId, body.id);
  });

  test('a verification notifies the student and the institution, naming the verifier', async () => {
    const { body } = await issue();
    state.notifications = [];
    await call('GET', `/api/verify/${body.certificateUid}`);
    const [toStudent] = notificationsOf(STUDENT.userId);
    const [toInstitution] = notificationsOf(INSTITUTION.userId);
    assert.equal(toStudent.type, 'VERIFICATION_REQUEST');
    assert.equal(toStudent.message, 'Your Bachelor of Science certificate was verified: valid, by an anonymous verifier.');
    assert.equal(toInstitution.message, 'A Bachelor of Science certificate issued to Ada Lovelace was verified: valid.');
    assert.equal(toInstitution.relatedCertificateId, body.id);

    // An employer's check names the employer (a different result, so not deduplicated).
    await revoke(body.id, 'Issued in error');
    state.notifications = [];
    await call('GET', `/api/verify/${body.certificateUid}`, { token: token('employer-user', 'EMPLOYER') });
    assert.equal(notificationsOf(STUDENT.userId)[0].message, `Your Bachelor of Science certificate was verified: revoked, by ${EMPLOYER_NAME}.`);
    assert.equal(notificationsOf(INSTITUTION.userId)[0].message, 'A Bachelor of Science certificate issued to Ada Lovelace was verified: revoked.');
  });

  test('a tampered result uses the data integrity wording; pending says so; not found notifies nobody', async () => {
    const { body } = await issue();
    state.notifications = [];
    state.chain.set(body.certificateUid, { certificateHash: `0x${'ab'.repeat(32)}`, revoked: false, issuedAt: 1790000000n });
    assert.equal((await call('GET', `/api/verify/${body.certificateUid}`)).body.result, 'tampered');
    assert.equal(notificationsOf(STUDENT.userId)[0].message, 'A verification reported a data integrity concern for your Bachelor of Science certificate.');
    assert.equal(notificationsOf(INSTITUTION.userId)[0].message, 'A verification reported a data integrity concern for a Bachelor of Science certificate issued to Ada Lovelace.');

    const pending = await issue();
    state.chain.delete(pending.body.certificateUid);
    state.notifications = [];
    assert.equal((await call('GET', `/api/verify/${pending.body.certificateUid}`)).body.result, 'pending-chain');
    assert.equal(notificationsOf(INSTITUTION.userId)[0].message, 'A Bachelor of Science certificate issued to Ada Lovelace was verified: pending blockchain confirmation.');

    state.notifications = [];
    assert.equal((await call('GET', '/api/verify/99999999-0000-4000-8000-000000000099')).status, 404);
    assert.equal(state.notifications.length, 0);
  });

  test('a rate-limited verification is never logged and never notifies', async () => {
    const { body } = await issue();
    for (let index = 0; index < 30; index += 1) await call('GET', `/api/verify/${body.certificateUid}`, { ip: '203.0.113.9' });
    const before = { logged: state.verifications.length, notices: state.notifications.length };
    assert.equal((await call('GET', `/api/verify/${body.certificateUid}`, { ip: '203.0.113.9' })).status, 429);
    assert.deepEqual({ logged: state.verifications.length, notices: state.notifications.length }, before);
  });

  test('each recipient gets one verification notice per certificate and result per 24 hours', async () => {
    const { body } = await issue();
    state.notifications = [];
    for (let index = 0; index < 3; index += 1) await call('GET', `/api/verify/${body.certificateUid}`);
    assert.equal(notificationsOf(STUDENT.userId).length, 1);
    assert.equal(notificationsOf(INSTITUTION.userId).length, 1);
    assert.equal(notificationsOf(STUDENT.userId)[0].dedupeKey, `verified:${body.id}:VALID`);

    // A day later, it is sent again.
    for (const notice of state.notifications) notice.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await call('GET', `/api/verify/${body.certificateUid}`);
    assert.equal(notificationsOf(STUDENT.userId).length, 2);
    assert.equal(notificationsOf(INSTITUTION.userId).length, 2);
  });

  test('turning off verification notices skips the student only', async () => {
    const saved = await call('PATCH', '/api/students/me/preferences', { token: asStudent(), body: { notifyOnVerification: false } });
    assert.deepEqual(saved.body, { notifyOnVerification: false });
    assert.equal((await call('GET', '/api/students/me', { token: asStudent() })).body.notifyOnVerification, false);
    assert.equal((await call('PATCH', '/api/students/me/preferences', { token: asStudent(), body: { notifyOnVerification: 'no' } })).status, 400);

    const { body } = await issue();
    state.notifications = [];
    await call('GET', `/api/verify/${body.certificateUid}`);
    assert.equal(notificationsOf(STUDENT.userId).length, 0);
    assert.equal(notificationsOf(INSTITUTION.userId).length, 1);
  });

  test('a failing notification never breaks issuance, revocation, verification or corrections', async () => {
    state.notificationsDown = true;
    const issued = await issue();
    assert.equal(issued.status, 201);
    assert.equal(state.certificates.length, 1);
    assert.equal((await call('GET', `/api/verify/${issued.body.certificateUid}`)).body.result, 'valid');
    const requested = await requestCorrection(issued.body.id);
    assert.equal(requested.status, 201);
    assert.equal((await approve(requested.body.id)).status, 200);
    assert.equal((await revoke(issued.body.id, 'Issued in error')).status, 200);
    assert.equal(state.notifications.length, 0);
  });

  test('messages never carry an email address, an IP address or a hash, and are at most 300 characters', async () => {
    const { body } = await issue();
    await revoke(body.id, `Contact registrar@example.edu from 10.20.30.40 or 2001:db8::1 about 0x${'ab'.repeat(32)}`);
    const message = notificationsOf(STUDENT.userId).find((item) => item.type === 'CERT_REVOKED')!.message as string;
    assert.ok(!message.includes('registrar@') && !message.includes('10.20.30.40') && !message.includes('2001:db8') && !message.includes('abab'), message);
    assert.equal(notificationText('x'.repeat(500)).length, 300);
    assert.equal(notificationText('line one\nline\ttwo'), 'line one line two');
  });
});

describe('notification endpoints', () => {
  const seed = (userId: string, count: number, read = false) => {
    for (let index = 0; index < count; index += 1) {
      state.notifications.push({ id: `${userId}-${index}`, userId, type: 'CERT_ISSUED', message: `Message ${index}`, isRead: read, createdAt: new Date(Date.now() - (count - index) * 1000), relatedCertificateId: null, relatedCorrectionRequestId: null, dedupeKey: null });
    }
  };

  test('list newest first, filter unread, count unread, and send only the documented fields', async () => {
    seed(STUDENT.userId, 3);
    state.notifications[0].isRead = true;
    seed(INSTITUTION.userId, 2);
    const all = await call('GET', '/api/notifications', { token: asStudent() });
    assert.deepEqual(all.body.notifications.map((item: any) => item.message), ['Message 2', 'Message 1', 'Message 0']);
    assert.deepEqual(Object.keys(all.body.notifications[0]).sort(), ['createdAt', 'id', 'isRead', 'message', 'relatedCertificateId', 'relatedCorrectionRequestId', 'type']);
    assert.equal(all.body.unreadCount, 2);
    const unread = await call('GET', '/api/notifications?unread=true', { token: asStudent() });
    assert.equal(unread.body.notifications.length, 2);
    assert.equal((await call('GET', '/api/notifications/unread-count', { token: asStudent() })).body.unreadCount, 2);
    assert.equal((await call('GET', '/api/notifications?unread=maybe', { token: asStudent() })).status, 400);
    assert.equal((await call('GET', '/api/notifications?limit=500', { token: asStudent() })).body.pagination.limit, 50);
    assert.equal((await call('GET', '/api/notifications')).status, 401);
  });

  test('mark one read, someone else\'s is 404, and mark all read', async () => {
    seed(STUDENT.userId, 3);
    seed(INSTITUTION.userId, 1);
    assert.equal((await call('PATCH', `/api/notifications/${STUDENT.userId}-0/read`, { token: asStudent() })).status, 200);
    assert.equal(state.notifications.find((item) => item.id === `${STUDENT.userId}-0`)!.isRead, true);
    assert.equal((await call('PATCH', `/api/notifications/${INSTITUTION.userId}-0/read`, { token: asStudent() })).status, 404);
    assert.equal(state.notifications.find((item) => item.id === `${INSTITUTION.userId}-0`)!.isRead, false);
    assert.deepEqual((await call('POST', '/api/notifications/read-all', { token: asStudent() })).body, { updated: 2 });
    assert.equal(notificationsOf(INSTITUTION.userId)[0].isRead, false, 'only the signed-in user\'s');
  });

  test('notifications older than 90 days are deleted now and then', async (t) => {
    seed(STUDENT.userId, 2);
    state.notifications[0].createdAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    t.mock.method(Math, 'random', () => 0);
    await call('GET', '/api/notifications/unread-count', { token: asStudent() });
    assert.equal(state.notifications.length, 1);
  });
});

describe('correction requests', () => {
  test('a student can request a correction to an active certificate of theirs; the institution is notified', async () => {
    const { body: certificate } = await issue();
    state.notifications = [];
    const { status, body } = await requestCorrection(certificate.id);
    assert.equal(status, 201);
    assert.equal(body.stage, 'pending');
    assert.equal(body.requestDetails, DETAILS);
    assert.deepEqual(body.certificate, { id: certificate.id, certificateUid: certificate.certificateUid, certificateType: 'Bachelor of Science', programName: 'Computer Science', status: 'ACTIVE' });
    assert.equal(body.replacement, null);
    const [notice] = notificationsOf(INSTITUTION.userId);
    assert.equal(notice.type, 'CORRECTION_REQUEST');
    assert.equal(notice.message, 'Ada Lovelace requested a correction to Bachelor of Science (Computer Science).');
    assert.equal(notice.relatedCorrectionRequestId, body.id);
    assert.equal(notificationsOf(STUDENT.userId).length, 0);
  });

  test('length, ownership, status and one pending request per certificate are enforced', async () => {
    const { body: certificate } = await issue();
    assert.equal((await requestCorrection(certificate.id, 'too short')).status, 400);
    assert.equal((await requestCorrection(certificate.id, 'x'.repeat(1001))).status, 400);
    assert.equal((await requestCorrection(certificate.id, DETAILS, asOtherStudent())).status, 404, 'another student\'s certificate');
    assert.equal((await requestCorrection(certificate.id)).status, 201);
    assert.equal((await requestCorrection(certificate.id)).status, 409, 'one pending request per certificate');

    const { body: revoked } = await issue();
    await revoke(revoked.id, 'Issued in error');
    assert.equal((await requestCorrection(revoked.id)).status, 409, 'only active certificates');
  });

  test('at most 5 requests per student per day', async () => {
    for (let index = 0; index < 5; index += 1) {
      const { body } = await issue();
      assert.equal((await requestCorrection(body.id)).status, 201);
    }
    const { body } = await issue();
    const blocked = await requestCorrection(body.id);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'You can request at most 5 corrections a day. Please try again later.');
  });

  test('the institution sees only its own requests, with the student as printed on the certificate', async () => {
    const { body: certificate } = await issue();
    const { body: request } = await requestCorrection(certificate.id);
    // The student's live record changes later; the request still shows the frozen name.
    await call('PUT', `/api/institutions/students/${STUDENT.id}`, { token: asInstitution(), body: { fullName: 'Ada King' } });

    const list = await call('GET', '/api/institutions/correction-requests', { token: asInstitution() });
    assert.equal(list.body.pendingCount, 1);
    assert.deepEqual(list.body.correctionRequests[0].student, { fullName: 'Ada Lovelace', studentNumber: 'STU-001' });
    assert.equal(list.body.correctionRequests[0].certificate.id, certificate.id);
    assert.equal((await call('GET', '/api/institutions/correction-requests?status=approved', { token: asInstitution() })).body.correctionRequests.length, 0);

    const other = await call('GET', '/api/institutions/correction-requests', { token: asOtherInstitution() });
    assert.equal(other.body.correctionRequests.length, 0);
    assert.equal((await call('GET', `/api/institutions/correction-requests/${request.id}`, { token: asOtherInstitution() })).status, 404);
    assert.equal((await approve(request.id, undefined, asOtherInstitution())).status, 404);
  });

  test('rejecting needs a note, notifies the student and logs the decision without the request text', async () => {
    const { body: certificate } = await issue();
    const { body: request } = await requestCorrection(certificate.id);
    assert.equal((await reject(request.id)).status, 400);
    const rejected = await reject(request.id, 'The name matches our records.');
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.stage, 'rejected');
    assert.equal(rejected.body.resolutionNote, 'The name matches our records.');
    assert.ok(rejected.body.resolvedAt);
    const notice = notificationsOf(STUDENT.userId).find((item) => item.type === 'CORRECTION_RESOLVED')!;
    assert.equal(notice.message, 'Your correction request was rejected. The name matches our records.');
    const entry = state.auditLogs.find((item) => item.action === 'CORRECTION_REJECTED')!;
    assert.equal(entry.userId, INSTITUTION.userId);
    assert.equal(entry.entityId, request.id);
    assert.ok(!JSON.stringify(entry).includes('misspelled') && !JSON.stringify(entry).includes('matches our records'));
    assert.equal((await approve(request.id)).status, 409, 'only a pending request can be decided');
  });

  test('approving changes nothing about the original certificate', async () => {
    const { body: certificate } = await issue();
    const { body: request } = await requestCorrection(certificate.id);
    const original = JSON.parse(JSON.stringify(state.certificates[0]));
    const writesBefore = state.certificateWrites;
    const approved = await approve(request.id);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.stage, 'approved_awaiting_reissue');
    assert.equal(state.certificateWrites, writesBefore, 'no certificate write');
    assert.deepEqual(JSON.parse(JSON.stringify(state.certificates[0])), original);
    assert.equal(notificationsOf(STUDENT.userId).find((item) => item.type === 'CORRECTION_RESOLVED')!.message, 'Your correction request was approved.');
    assert.ok(state.auditLogs.some((item) => item.action === 'CORRECTION_APPROVED'));
  });

  test('reissuing checks the request: same institution, approved, not yet replaced, same student', async () => {
    const { body: certificate } = await issue();
    const { body: request } = await requestCorrection(certificate.id);
    assert.equal((await issue({ correctionRequestId: request.id })).status, 409, 'not approved yet');
    await approve(request.id);
    assert.equal((await issue({ correctionRequestId: request.id }, OTHER_STUDENT.id)).status, 400, 'a different student');
    const otherInstitution = await call('POST', '/api/institutions/certificates', {
      token: asOtherInstitution(),
      body: { studentId: STUDENT.id, certificateType: 'X', programName: 'Y', issueDate: '2026-09-16', correctionRequestId: request.id }
    });
    assert.equal(otherInstitution.status, 404, 'another institution\'s request (or student)');
    assert.equal((await issue({ correctionRequestId: 'aaaaaaaa-9999-4000-8000-000000000000' })).status, 404, 'no such request');
    assert.equal(state.certificates.length, 1, 'none of those created a certificate');

    const replacement = await issue({ correctionRequestId: request.id });
    assert.equal(replacement.status, 201);
    assert.equal(state.correctionRequests[0].replacementCertificateId, replacement.body.id);
    assert.equal((await issue({ correctionRequestId: request.id })).status, 409, 'already replaced');
    assert.equal(state.certificates.length, 2);
  });

  test('the stages run pending, approved, replacement issued, completed; and the student is told about the replacement', async () => {
    const { body: certificate } = await issue();
    const { body: request } = await requestCorrection(certificate.id);
    const stage = async () => (await call('GET', '/api/students/me/correction-requests', { token: asStudent() })).body.correctionRequests[0].stage;
    assert.equal(await stage(), 'pending');
    await approve(request.id, 'We will reissue it.');
    assert.equal(await stage(), 'approved_awaiting_reissue');

    // The name is fixed on the student record first, then the replacement is issued.
    await call('PUT', `/api/institutions/students/${STUDENT.id}`, { token: asInstitution(), body: { fullName: 'Ada Lovelace (corrected)' } });
    state.notifications = [];
    const { body: replacement } = await issue({ correctionRequestId: request.id });
    assert.equal(await stage(), 'replacement_issued');
    const notice = notificationsOf(STUDENT.userId)[0];
    assert.equal(notice.type, 'CERT_ISSUED');
    assert.equal(notice.message, `Example University issued you a corrected Bachelor of Science certificate in Computer Science. It replaces your earlier certificate ${certificate.certificateUid}.`);

    await revoke(certificate.id, `Replaced by corrected certificate ${replacement.certificateUid} after a correction request`);
    assert.equal(await stage(), 'completed');
    const studentView = (await call('GET', '/api/students/me/correction-requests', { token: asStudent() })).body.correctionRequests[0];
    assert.deepEqual(studentView.replacement, { id: replacement.id, certificateUid: replacement.certificateUid, certificateType: 'Bachelor of Science' });
    assert.equal(studentView.resolutionNote, 'We will reissue it.');
    const institutionView = (await call('GET', `/api/institutions/correction-requests/${request.id}`, { token: asInstitution() })).body;
    assert.equal(institutionView.stage, 'completed');

    // The old certificate verifies as revoked, the new one as valid with the corrected name.
    assert.equal((await call('GET', `/api/verify/${certificate.certificateUid}`)).body.result, 'revoked');
    const fresh = await call('GET', `/api/verify/${replacement.certificateUid}`);
    assert.equal(fresh.body.result, 'valid');
    assert.equal(fresh.body.certificate.studentName, 'Ada Lovelace (corrected)');
  });
});

describe('frozen values in lists and the CSV export', () => {
  test('version 2 certificates show the frozen facts; version 1 certificates keep the live records', async () => {
    const { body: certificate } = await issue();
    // A version 1 certificate from before (no frozen facts).
    const v1 = { studentId: STUDENT.id, institutionId: INSTITUTION.id, certificateType: 'Diploma', programName: 'History', classification: null, issueDate: new Date('2024-06-01T00:00:00.000Z'), certificateUid: '11111111-0000-4000-8000-000000000001' };
    state.certificates.push({ ...v1, id: 'cccccccc-0000-4000-8000-000000000001', graduationDate: null, certificateHash: generateCertificateHash(v1), status: 'ACTIVE', revokedReason: null, renderSnapshot: null, createdAt: new Date('2024-06-01T00:00:00.000Z') });

    await call('PUT', `/api/institutions/students/${STUDENT.id}`, { token: asInstitution(), body: { fullName: 'Ada King' } });
    state.institutions[0].name = 'Renamed University';

    const institutionList = (await call('GET', '/api/institutions/certificates', { token: asInstitution() })).body.certificates;
    const byUid = (rows: any[], uid: string) => rows.find((row) => row.certificateUid === uid);
    assert.deepEqual(byUid(institutionList, certificate.certificateUid).student, { fullName: 'Ada Lovelace', studentNumber: 'STU-001' });
    assert.deepEqual(byUid(institutionList, v1.certificateUid).student, { fullName: 'Ada King', studentNumber: 'STU-001' });
    assert.ok(!('studentNameAtIssue' in byUid(institutionList, certificate.certificateUid)));

    const studentList = (await call('GET', '/api/students/me/certificates', { token: asStudent() })).body.certificates;
    assert.equal(byUid(studentList, certificate.certificateUid).institutionName, 'Example University');
    assert.equal(byUid(studentList, v1.certificateUid).institutionName, 'Renamed University');

    const csv = (await call('GET', '/api/institutions/reports/certificates.csv', { token: asInstitution() })).body as string;
    const line = (uid: string) => csv.split('\n').find((row) => row.startsWith(uid))!;
    assert.match(line(certificate.certificateUid), /,Ada Lovelace,STU-001,/);
    assert.match(line(v1.certificateUid), /,Ada King,STU-001,/);
  });
});
