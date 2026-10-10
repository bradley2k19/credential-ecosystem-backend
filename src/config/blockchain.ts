import { Contract, JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import env from './env';

const certificateRegistryAbi = [
  'function ISSUER_ROLE() view returns (bytes32)',
  'function isIssuer(address account) view returns (bool)',
  'function grantRole(bytes32 role, address account)',
  'function getCertificate(string certificateUid) view returns (bytes32 certificateHash, address issuer, bool revoked, uint256 issuedAt)',
  'event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)'
];

export const blockchainProvider = new JsonRpcProvider(env.BLOCKCHAIN_RPC_URL);

export const certificateRegistry = new Contract(
  env.CONTRACT_ADDRESS,
  certificateRegistryAbi,
  blockchainProvider
);

// Polygon Amoy rejects transactions whose priority fee (gas tip cap) is below 25 gwei, but RPC fee
// estimates often suggest about 1.5 gwei. 30 gwei keeps a safe margin above that minimum.
const MIN_PRIORITY_FEE_PER_GAS = parseUnits('30', 'gwei');

function maxBigInt(a: bigint, b: bigint) {
  return a > b ? a : b;
}

// Fee overrides for backend-signed write transactions, so the network's minimum priority fee is always met.
export async function getFeeOverrides() {
  const feeData = await blockchainProvider.getFeeData();
  const maxPriorityFeePerGas = maxBigInt(feeData.maxPriorityFeePerGas ?? 0n, MIN_PRIORITY_FEE_PER_GAS);
  const maxFeePerGas = maxBigInt(feeData.maxFeePerGas ?? 0n, 2n * maxPriorityFeePerGas);
  return { maxPriorityFeePerGas, maxFeePerGas };
}

const adminWallet = new Wallet(env.ADMIN_PRIVATE_KEY, blockchainProvider);

// This signer is intentionally used only by the admin issuer-role grant endpoint.
export const adminCertificateRegistry = new Contract(
  env.CONTRACT_ADDRESS,
  certificateRegistryAbi,
  adminWallet
);