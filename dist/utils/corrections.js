"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.correctionRequestFields = exports.RESOLUTION_NOTE_MAX = exports.REQUEST_DETAILS_MAX = exports.REQUEST_DETAILS_MIN = void 0;
exports.correctionStage = correctionStage;
exports.toStudentCorrection = toStudentCorrection;
exports.toInstitutionCorrection = toInstitutionCorrection;
const client_1 = require("@prisma/client");
const certificateFacts_1 = require("./certificateFacts");
function correctionStage(request) {
    if (request.status === client_1.CorrectionStatus.PENDING)
        return 'pending';
    if (request.status === client_1.CorrectionStatus.REJECTED)
        return 'rejected';
    if (!request.replacementCertificateId)
        return 'approved_awaiting_reissue';
    return request.certificate.status === client_1.CertificateStatus.REVOKED ? 'completed' : 'replacement_issued';
}
exports.REQUEST_DETAILS_MIN = 20;
exports.REQUEST_DETAILS_MAX = 1000;
exports.RESOLUTION_NOTE_MAX = 1000;
/** Everything either view of a correction request needs, in one select. */
exports.correctionRequestFields = {
    id: true,
    requestDetails: true,
    status: true,
    resolutionNote: true,
    requestedAt: true,
    resolvedAt: true,
    replacementCertificateId: true,
    certificate: {
        select: {
            id: true,
            certificateUid: true,
            certificateType: true,
            programName: true,
            status: true,
            // The student's name and number as printed on the original certificate (frozen for version 2).
            ...certificateFacts_1.certificateFactFields
        }
    },
    replacementCertificate: { select: { id: true, certificateUid: true, certificateType: true } }
};
/** What the student sees: their request, its stage, the institution's note and any replacement certificate. */
function toStudentCorrection(request) {
    return {
        id: request.id,
        requestDetails: request.requestDetails,
        status: request.status,
        stage: correctionStage(request),
        resolutionNote: request.resolutionNote,
        requestedAt: request.requestedAt,
        resolvedAt: request.resolvedAt,
        certificate: {
            id: request.certificate.id,
            certificateUid: request.certificate.certificateUid,
            certificateType: request.certificate.certificateType,
            programName: request.certificate.programName,
            status: request.certificate.status
        },
        replacement: request.replacementCertificate
            ? { id: request.replacementCertificate.id, certificateUid: request.replacementCertificate.certificateUid, certificateType: request.replacementCertificate.certificateType }
            : null
    };
}
/** What the institution sees: the same, plus the student as printed on the original certificate. */
function toInstitutionCorrection(request) {
    const facts = (0, certificateFacts_1.certificateFacts)(request.certificate);
    return {
        ...toStudentCorrection(request),
        student: { fullName: facts.studentName, studentNumber: facts.studentNumber }
    };
}
