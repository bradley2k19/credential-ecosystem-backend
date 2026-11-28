import crypto from 'crypto';

export interface CertificateHashInput {
  studentId: string;
  institutionId: string;
  certificateType: string;
  programName: string;
  classification: string | null;
  issueDate: Date;
  certificateUid: string;
}

/**
 * Hash format, kept stable for future verification:
 * studentId|institutionId|certificateType|programName|classification|issueDate|certificateUid
 * Dates use Date.toISOString(); a missing classification is represented by an empty field.
 */
export function generateCertificateHash(input: CertificateHashInput) {
  const canonicalValue = [
    input.studentId,
    input.institutionId,
    input.certificateType,
    input.programName,
    input.classification ?? '',
    input.issueDate.toISOString(),
    input.certificateUid
  ].join('|');

  return `0x${crypto.createHash('sha256').update(canonicalValue, 'utf8').digest('hex')}`;
}

/** The hash version given to every newly issued certificate. */
export const CURRENT_HASH_VERSION = 2;
export const HASH_V2_TAG = 'v2';

export interface CertificateHashV2Input {
  certificateUid: string;
  studentId: string;
  institutionId: string;
  studentName: string | null;
  studentNumber: string | null;
  institutionName: string | null;
  certificateType: string;
  programName: string;
  classification: string | null;
  issueDate: Date;
  graduationDate: Date | null;
}

/** Unicode NFC, trimmed, inner runs of whitespace collapsed to one space; null, undefined and '' are all ''. */
function canonicalText(value: unknown) {
  if (value === null || value === undefined) return '';
  return (typeof value === 'string' ? value : String(value)).normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** The UTC date part, YYYY-MM-DD, or '' when there is no date. */
function canonicalDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * Hash version 2 covers every fact the certificate prints, in this fixed order, starting with the version tag.
 * The values are serialised as a JSON array, so field boundaries are unambiguous.
 */
export function canonicalCertificateValuesV2(input: CertificateHashV2Input): string[] {
  return [
    HASH_V2_TAG,
    canonicalText(input.certificateUid),
    canonicalText(input.studentId),
    canonicalText(input.institutionId),
    canonicalText(input.studentName),
    canonicalText(input.studentNumber),
    canonicalText(input.institutionName),
    canonicalText(input.certificateType),
    canonicalText(input.programName),
    canonicalText(input.classification),
    canonicalDate(input.issueDate),
    canonicalDate(input.graduationDate)
  ];
}

/** SHA-256 of the JSON-serialised values, in the same 0x-prefixed form as version 1. */
export function hashCanonicalValues(values: string[]) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex')}`;
}

export function generateCertificateHashV2(input: CertificateHashV2Input) {
  return hashCanonicalValues(canonicalCertificateValuesV2(input));
}

/** A certificate as stored: everything either hash version needs, from the certificate row alone. */
export interface StoredCertificateForHash {
  hashVersion: number;
  certificateUid: string;
  studentId: string;
  institutionId: string;
  certificateType: string;
  programName: string;
  classification: string | null;
  issueDate: Date;
  graduationDate: Date | null;
  studentNameAtIssue: string | null;
  studentNumberAtIssue: string | null;
  institutionNameAtIssue: string | null;
}

/**
 * The one place that picks the hash function, used by both issuance and verification so they can never
 * disagree. Version 2 uses only the certificate's own stored fields (its frozen copies), never the student or
 * institution records. Version 1 is exactly the original function. An unknown version has no hash (null), so it
 * can never match.
 */
export function computeCertificateHash(certificate: StoredCertificateForHash): string | null {
  switch (certificate.hashVersion) {
    case 1:
      return generateCertificateHash({
        studentId: certificate.studentId,
        institutionId: certificate.institutionId,
        certificateType: certificate.certificateType,
        programName: certificate.programName,
        classification: certificate.classification,
        issueDate: certificate.issueDate,
        certificateUid: certificate.certificateUid
      });
    case 2:
      return generateCertificateHashV2({
        certificateUid: certificate.certificateUid,
        studentId: certificate.studentId,
        institutionId: certificate.institutionId,
        studentName: certificate.studentNameAtIssue,
        studentNumber: certificate.studentNumberAtIssue,
        institutionName: certificate.institutionNameAtIssue,
        certificateType: certificate.certificateType,
        programName: certificate.programName,
        classification: certificate.classification,
        issueDate: certificate.issueDate,
        graduationDate: certificate.graduationDate
      });
    default:
      return null;
  }
}

export default generateCertificateHash;