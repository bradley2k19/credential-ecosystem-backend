"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCertificateRegistry = exports.certificateRegistry = exports.blockchainProvider = void 0;
const ethers_1 = require("ethers");
const env_1 = __importDefault(require("./env"));
const certificateRegistryAbi = [
    'function ISSUER_ROLE() view returns (bytes32)',
    'function isIssuer(address account) view returns (bool)',
    'function grantRole(bytes32 role, address account)',
    'function getCertificate(bytes32 certificateUid) view returns (bytes32, address, address, uint256, bool)',
    'event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)'
];
exports.blockchainProvider = new ethers_1.JsonRpcProvider(env_1.default.BLOCKCHAIN_RPC_URL);
exports.certificateRegistry = new ethers_1.Contract(env_1.default.CONTRACT_ADDRESS, certificateRegistryAbi, exports.blockchainProvider);
const adminWallet = new ethers_1.Wallet(env_1.default.ADMIN_PRIVATE_KEY, exports.blockchainProvider);
// This signer is intentionally used only by the admin issuer-role grant endpoint.
exports.adminCertificateRegistry = new ethers_1.Contract(env_1.default.CONTRACT_ADDRESS, certificateRegistryAbi, adminWallet);
