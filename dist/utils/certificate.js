"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCertificateHash = generateCertificateHash;
const crypto_1 = __importDefault(require("crypto"));
function generateCertificateHash(bufferOrString) {
    const hash = crypto_1.default.createHash('sha256');
    hash.update(bufferOrString);
    return hash.digest('hex');
}
exports.default = { generateCertificateHash };
