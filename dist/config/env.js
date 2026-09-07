"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'FRONTEND_URL',
    'BLOCKCHAIN_RPC_URL',
    'PRIVATE_KEY'
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
exports.env = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    FRONTEND_URL: process.env.FRONTEND_URL,
    BLOCKCHAIN_RPC_URL: process.env.BLOCKCHAIN_RPC_URL,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
    NODE_ENV: process.env.NODE_ENV || 'development'
};
exports.default = exports.env;
