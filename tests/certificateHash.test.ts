import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  canonicalCertificateValuesV2,
  computeCertificateHash,
  generateCertificateHash,
  generateCertificateHashV2,
  hashCanonicalValues,
  type CertificateHashV2Input,
  type StoredCertificateForHash
} from '../src/utils/certificateHash';

interface GoldenFixture {
  name: string;
  input: { studentId: string; institutionId: string; certificateType: string; programName: string; classification: string | null; issueDate: string; certificateUid: string };
  hash: string;
}
// Produced by the committed version 1 code before version 2 existed (see generatedFrom in the file).
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'certificateHashV1.golden.json'), 'utf8')) as { fixtures: GoldenFixture[] };
const v1Input = (fixture: GoldenFixture) => ({ ...fixture.input, issueDate: new Date(fixture.input.issueDate) });

const BASE: CertificateHashV2Input = {
  certificateUid: '22222222-0000-4000-8000-000000000001',
  studentId: 'aaaaaaaa-0000-4000-8000-000000000001',
  institutionId: 'bbbbbbbb-0000-4000-8000-000000000001',
  studentName: 'Ada Lovelace',
  studentNumber: 'STU-001',
  institutionName: 'Example University',
  certificateType: 'Bachelor of Science',
  programName: 'Computer Science',
  classification: 'First Class Honours',
  issueDate: new Date('2026-09-16T00:00:00.000Z'),
  graduationDate: new Date('2026-06-30T00:00:00.000Z')
};
const v2 = (changes: Partial<CertificateHashV2Input> = {}) => generateCertificateHashV2({ ...BASE, ...changes });

describe('version 1 (unchanged)', () => {
  test('the golden fixtures hash exactly as the committed code did', () => {
    assert.ok(golden.fixtures.length >= 5);
    for (const fixture of golden.fixtures) assert.equal(generateCertificateHash(v1Input(fixture)), fixture.hash, fixture.name);
  });

  test('the dispatcher gives version 1 certificates exactly the golden hashes, ignoring every version 2 field', () => {
    for (const fixture of golden.fixtures) {
      const stored: StoredCertificateForHash = {
        ...v1Input(fixture),
        hashVersion: 1,
        graduationDate: new Date('2020-01-01T00:00:00.000Z'),
        studentNameAtIssue: 'Anything',
        studentNumberAtIssue: 'Anything',
        institutionNameAtIssue: 'Anything'
      };
      assert.equal(computeCertificateHash(stored), fixture.hash, fixture.name);
    }
  });
});

describe('version 2', () => {
  test('is deterministic and has the same form as version 1', () => {
    assert.equal(v2(), v2());
    assert.match(v2(), /^0x[0-9a-f]{64}$/);
    assert.notEqual(v2(), generateCertificateHash({ ...BASE, classification: BASE.classification }));
  });

  test('changing any one of the twelve inputs changes the hash', () => {
    const changes: [string, Partial<CertificateHashV2Input>][] = [
      ['certificateUid', { certificateUid: '22222222-0000-4000-8000-000000000002' }],
      ['studentId', { studentId: 'aaaaaaaa-0000-4000-8000-000000000002' }],
      ['institutionId', { institutionId: 'bbbbbbbb-0000-4000-8000-000000000002' }],
      ['studentName', { studentName: 'Ada King' }],
      ['studentNumber', { studentNumber: 'STU-002' }],
      ['institutionName', { institutionName: 'Example College' }],
      ['certificateType', { certificateType: 'Master of Science' }],
      ['programName', { programName: 'Mathematics' }],
      ['classification', { classification: 'Second Class Honours' }],
      ['issueDate', { issueDate: new Date('2026-09-17T00:00:00.000Z') }],
      ['graduationDate', { graduationDate: new Date('2026-07-01T00:00:00.000Z') }]
    ];
    const seen = new Set([v2()]);
    for (const [field, change] of changes) {
      const changed = v2(change);
      assert.notEqual(changed, v2(), `${field} is covered`);
      seen.add(changed);
    }
    assert.equal(seen.size, changes.length + 1, 'every change gives a different hash');
    assert.notEqual(v2({ graduationDate: null }), v2(), 'removing the graduation date is covered too');

    // The twelfth input is the version tag: it is hashed, so the same facts under another tag hash differently.
    const values = canonicalCertificateValuesV2(BASE);
    assert.equal(values[0], 'v2');
    assert.equal(values.length, 12);
    assert.equal(hashCanonicalValues(values), v2());
    assert.notEqual(hashCanonicalValues(['v3', ...values.slice(1)]), v2());
    assert.notEqual(hashCanonicalValues(['v1', ...values.slice(1)]), v2());
  });

  test('the inputs are in the documented order', () => {
    assert.deepEqual(canonicalCertificateValuesV2(BASE), [
      'v2', BASE.certificateUid, BASE.studentId, BASE.institutionId, 'Ada Lovelace', 'STU-001', 'Example University',
      'Bachelor of Science', 'Computer Science', 'First Class Honours', '2026-09-16', '2026-06-30'
    ]);
  });

  test('NFC and NFD forms of the same text hash the same', () => {
    const nfc = 'Zoë Ångström';
    const nfd = nfc.normalize('NFD');
    assert.notEqual(nfc, nfd);
    assert.equal(v2({ studentName: nfc }), v2({ studentName: nfd }));
    assert.equal(v2({ institutionName: 'Université' }), v2({ institutionName: 'Université' }));
  });

  test('null, undefined and an empty string hash the same', () => {
    assert.equal(v2({ classification: null }), v2({ classification: '' }));
    assert.equal(v2({ classification: null }), v2({ classification: undefined as unknown as null }));
    assert.equal(v2({ studentNumber: null }), v2({ studentNumber: '' }));
    assert.equal(v2({ graduationDate: null }), v2({ graduationDate: undefined as unknown as null }));
    assert.notEqual(v2({ classification: null }), v2(), 'but a missing value differs from a present one');
  });

  test('whitespace around or inside a value does not change the hash', () => {
    assert.equal(v2({ studentName: '  Ada   Lovelace \t' }), v2());
    assert.equal(v2({ studentName: 'Ada\n\tLovelace' }), v2());
    assert.equal(v2({ institutionName: ' Example  University ' }), v2());
    assert.notEqual(v2({ studentName: 'AdaLovelace' }), v2(), 'removing a space is still a change');
  });

  test('dates count by their UTC day only', () => {
    assert.equal(v2({ issueDate: new Date('2026-09-16T23:59:59.999Z') }), v2());
    assert.notEqual(v2({ issueDate: new Date('2026-09-15T23:59:59.999Z') }), v2());
  });

  test('field boundaries are unambiguous (version 1 can be fooled by a "|"; version 2 cannot)', () => {
    const one = { ...BASE, certificateType: 'A|B', programName: 'C' };
    const two = { ...BASE, certificateType: 'A', programName: 'B|C' };
    assert.equal(generateCertificateHash(one), generateCertificateHash(two), 'version 1 joins with "|"');
    assert.notEqual(generateCertificateHashV2(one), generateCertificateHashV2(two));
  });
});

describe('dispatcher', () => {
  const storedV2: StoredCertificateForHash = {
    hashVersion: 2,
    certificateUid: BASE.certificateUid,
    studentId: BASE.studentId,
    institutionId: BASE.institutionId,
    certificateType: BASE.certificateType,
    programName: BASE.programName,
    classification: BASE.classification,
    issueDate: BASE.issueDate,
    graduationDate: BASE.graduationDate,
    studentNameAtIssue: 'Ada Lovelace',
    studentNumberAtIssue: 'STU-001',
    institutionNameAtIssue: 'Example University'
  };

  test('version 2 uses only the stored fields, including the frozen copies', () => {
    assert.equal(computeCertificateHash(storedV2), v2());
    // Live student and institution records riding along are never read.
    const withLiveRecords = { ...storedV2, student: { fullName: 'Someone Else', studentNumber: 'X' }, institution: { name: 'Elsewhere' } };
    assert.equal(computeCertificateHash(withLiveRecords), v2());
    assert.notEqual(computeCertificateHash({ ...storedV2, studentNameAtIssue: 'Ada King' }), v2());
  });

  test('an unknown version has no hash, so it can never match', () => {
    assert.equal(computeCertificateHash({ ...storedV2, hashVersion: 3 }), null);
    assert.equal(computeCertificateHash({ ...storedV2, hashVersion: 0 }), null);
  });
});
