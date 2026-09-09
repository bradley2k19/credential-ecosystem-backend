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

  return crypto.createHash('sha256').update(canonicalValue, 'utf8').digest('hex');
}

export default generateCertificateHash;