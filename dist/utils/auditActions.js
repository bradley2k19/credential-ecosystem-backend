"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_MISMATCH_ACTION = void 0;
/**
 * System audit entry (no user): verification found a certificate revoked on the blockchain while the database
 * says it is active. Written by the verification controller, listed on the admin audit log.
 */
exports.STATUS_MISMATCH_ACTION = 'VERIFICATION_STATUS_MISMATCH';
