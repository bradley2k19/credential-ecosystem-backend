import dotenv from 'dotenv';

dotenv.config();

const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'FRONTEND_URL',
  'BLOCKCHAIN_RPC_URL',
  'CONTRACT_ADDRESS',
  'ADMIN_PRIVATE_KEY',
  'ADMIN_SECRET_KEY'
] as const;

type RequiredEnv = typeof required[number];

const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL as string,
  JWT_SECRET: process.env.JWT_SECRET as string,
  FRONTEND_URL: process.env.FRONTEND_URL as string,
  BLOCKCHAIN_RPC_URL: process.env.BLOCKCHAIN_RPC_URL as string,
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS as string,
  ADMIN_PRIVATE_KEY: process.env.ADMIN_PRIVATE_KEY as string,
  ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY as string,
  PORT: process.env.PORT ? Number(process.env.PORT) : 3001,
  NODE_ENV: process.env.NODE_ENV || 'development'
};

export default env;
