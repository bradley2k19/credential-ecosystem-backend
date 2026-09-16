"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCertificateHash = generateCertificateHash;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Hash format, kept stable for future verification:
 * studentId|institutionId|certificateType|programName|classification|issueDate|certificateUid
 * Dates use Date.toISOString(); a missing classification is represented by an empty field.
 */
function generateCertificateHash(input) {
    const canonicalValue = [
        input.studentId,
        input.institutionId,
        input.certificateType,
        input.programName,
        input.classification ?? '',
        input.issueDate.toISOString(),
        input.certificateUid
    ].join('|');
    return `0x${crypto_1.default.createHash('sha256').update(canonicalValue, 'utf8').digest('hex')}`;
}
exports.default = generateCertificateHash;
