"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCertificateRegistry = exports.certificateRegistry = exports.blockchainProvider = void 0;
exports.getFeeOverrides = getFeeOverrides;
const ethers_1 = require("ethers");
const env_1 = __importDefault(require("./env"));
const certificateRegistryAbi = [
    'function ISSUER_ROLE() view returns (bytes32)',
    'function isIssuer(address account) view returns (bool)',
    'function grantRole(bytes32 role, address account)',
    'function getCertificate(string certificateUid) view returns (bytes32 certificateHash, address issuer, bool revoked, uint256 issuedAt)',
    'event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)'
];
exports.blockchainProvider = new ethers_1.JsonRpcProvider(env_1.default.BLOCKCHAIN_RPC_URL);
exports.certificateRegistry = new ethers_1.Contract(env_1.default.CONTRACT_ADDRESS, certificateRegistryAbi, exports.blockchainProvider);
// Polygon Amoy rejects transactions whose priority fee (gas tip cap) is below 25 gwei, but RPC fee
// estimates often suggest about 1.5 gwei. 30 gwei keeps a safe margin above that minimum.
const MIN_PRIORITY_FEE_PER_GAS = (0, ethers_1.parseUnits)('30', 'gwei');
function maxBigInt(a, b) {
    return a > b ? a : b;
}
// Fee overrides for backend-signed write transactions, so the network's minimum priority fee is always met.
async function getFeeOverrides() {
    const feeData = await exports.blockchainProvider.getFeeData();
    const maxPriorityFeePerGas = maxBigInt(feeData.maxPriorityFeePerGas ?? 0n, MIN_PRIORITY_FEE_PER_GAS);
    const maxFeePerGas = maxBigInt(feeData.maxFeePerGas ?? 0n, 2n * maxPriorityFeePerGas);
    return { maxPriorityFeePerGas, maxFeePerGas };
}
const adminWallet = new ethers_1.Wallet(env_1.default.ADMIN_PRIVATE_KEY, exports.blockchainProvider);
// This signer is intentionally used only by the admin issuer-role grant endpoint.
exports.adminCertificateRegistry = new ethers_1.Contract(env_1.default.CONTRACT_ADDRESS, certificateRegistryAbi, adminWallet);
