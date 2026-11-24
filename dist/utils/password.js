"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.comparePassword = comparePassword;
exports.verifyPassword = verifyPassword;
const crypto_1 = require("crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const SALT_ROUNDS = 10;
// A hash of a random value nobody knows, made once at start-up with the same cost as real hashes. When there is no
// account to check a password against, the password is compared with this instead, so that takes as long as
// checking a real account's password and the response time does not reveal whether an account exists.
const dummyHash = bcrypt_1.default.hash((0, crypto_1.randomBytes)(32).toString('hex'), SALT_ROUNDS);
// Never an unhandled rejection at start-up; a failure would surface on the first comparison that needs it.
dummyHash.catch(() => undefined);
async function hashPassword(plain) {
    return bcrypt_1.default.hash(plain, SALT_ROUNDS);
}
async function comparePassword(plain, hash) {
    return bcrypt_1.default.compare(plain, hash);
}
/**
 * Checks a password against an account's hash. Without an account (`hash` missing) it still runs a bcrypt
 * comparison, against the dummy hash, and returns false, so both cases take about the same time.
 */
async function verifyPassword(plain, hash) {
    if (hash)
        return bcrypt_1.default.compare(plain, hash);
    await bcrypt_1.default.compare(plain, await dummyHash);
    return false;
}
exports.default = { hashPassword, comparePassword, verifyPassword };
