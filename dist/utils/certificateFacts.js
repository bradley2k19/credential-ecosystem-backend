"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.certificateFactFields = void 0;
exports.certificateFacts = certificateFacts;
/**
 * What a certificate prints about the student and the institution. Version 1 certificates read the live student
 * and institution records, exactly as before. Later versions print the copy frozen (and hashed) at issuance, so
 * editing the student or the institution never changes an issued certificate. `frozen` says which it is.
 */
function certificateFacts(certificate) {
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
exports.certificateFactFields = {
    hashVersion: true,
    studentNameAtIssue: true,
    studentNumberAtIssue: true,
    institutionNameAtIssue: true,
    student: { select: { fullName: true, studentNumber: true } },
    institution: { select: { name: true } }
};
