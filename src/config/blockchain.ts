import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import env from './env';

const certificateRegistryAbi = [
  'function ISSUER_ROLE() view returns (bytes32)',
  'function isIssuer(address account) view returns (bool)',
  'function grantRole(bytes32 role, address account)',
  'function getCertificate(bytes32 certificateUid) view returns (bytes32, address, address, uint256, bool)',
  'event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)'
];

export const blockchainProvider = new JsonRpcProvider(env.BLOCKCHAIN_RPC_URL);

export const certificateRegistry = new Contract(
  env.CONTRACT_ADDRESS,
  certificateRegistryAbi,
  blockchainProvider
);

const adminWallet = new Wallet(env.ADMIN_PRIVATE_KEY, blockchainProvider);

// This signer is intentionally used only by the admin issuer-role grant endpoint.
export const adminCertificateRegistry = new Contract(
  env.CONTRACT_ADDRESS,
  certificateRegistryAbi,
  adminWallet
);