/** The certificate fields and relations needed to know what it prints about the student and the institution. */
export interface CertificateFactSource {
  hashVersion: number;
  studentNameAtIssue: string | null;
  studentNumberAtIssue: string | null;
  institutionNameAtIssue: string | null;
  student: { fullName: string; studentNumber: string };
  institution: { name: string };
}

/**
 * What a certificate prints about the student and the institution. Version 1 certificates read the live student
 * and institution records, exactly as before. Later versions print the copy frozen (and hashed) at issuance, so
 * editing the student or the institution never changes an issued certificate. `frozen` says which it is.
 */
export function certificateFacts(certificate: CertificateFactSource) {
  if (certificate.hashVersion === 1) {
    return {
      studentName: certificate.student.fullName,
      studentNumber: certificate.student.studentNumber,
      institutionName: certificate.institution.name,
      frozen: false
    };
  }
  return {
    studentName: certificate.studentNameAtIssue ?? '',
    studentNumber: certificate.studentNumberAtIssue ?? '',
    institutionName: certificate.institutionNameAtIssue ?? '',
    frozen: true
  };
}

/** The certificate fields certificateFacts needs, for Prisma selects. */
export const certificateFactFields = {
  hashVersion: true,
  studentNameAtIssue: true,
  studentNumberAtIssue: true,
  institutionNameAtIssue: true,
  student: { select: { fullName: true, studentNumber: true } },
  institution: { select: { name: true } }
} as const;
