/**
 * Test stand-ins for the database and the blockchain. Import this first in every test file: it fixes the
 * configuration and replaces src/config/db and src/config/blockchain in the module cache before any app code
 * loads them, so no test can reach the real database or chain (the configured addresses lead nowhere anyway).
 */
import Module from 'module';
import path from 'path';
import { once } from 'events';
import type { AddressInfo } from 'net';
import type { Express } from 'express';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://stand-in:stand-in@127.0.0.1:9/stand-in',
  JWT_SECRET: 'test-only-secret',
  FRONTEND_URL: 'http://localhost:3999',
  BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:9',
  CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
  ADMIN_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
  NODE_ENV: 'test'
});

type Row = Record<string, any>;
type DateFilter = { gt?: Date; gte?: Date; lt?: Date };

export interface FakeCertificate {
  id: string;
  certificateUid: string;
  studentId: string;
  institutionId: string;
  certificateType: string;
  programName: string;
  classification: string | null;
  issueDate: Date;
  graduationDate: Date | null;
  certificateHash: string;
  status: 'ACTIVE' | 'REVOKED';
  revokedReason: string | null;
  renderSnapshot: unknown;
  // Embedded relations, for certificates whose student and institution are not in state.students/institutions.
  student?: { fullName: string; studentNumber: string };
  institution?: { id: string; name: string };
  // Database defaults apply when absent: hash version 1 and no frozen facts.
  hashVersion?: number;
  studentNameAtIssue?: string | null;
  studentNumberAtIssue?: string | null;
  institutionNameAtIssue?: string | null;
}

export interface ChainRecord {
  certificateHash: string;
  revoked: boolean;
  issuedAt: bigint;
}

/** Everything the stand-ins hold or saw. Reset between tests with resetState(). */
export const state = {
  certificates: [] as FakeCertificate[],
  users: [] as Row[],
  verifications: [] as Row[],
  auditLogs: [] as Row[],
  rateLimitEvents: [] as { id: string; scope: string; keyHash: string; createdAt: Date }[],
  // Live student and institution records, joined into certificates the way the database joins them.
  students: [] as Row[],
  institutions: [] as Row[],
  chain: new Map<string, ChainRecord>(),
  certificateWrites: 0,
  // When true, every rate-limit table operation fails (to test that the limiter fails open).
  rateLimitTableDown: false,
  nextId: 1
};

export function resetState() {
  state.certificates = [];
  state.users = [];
  state.verifications = [];
  state.auditLogs = [];
  state.rateLimitEvents = [];
  state.students = [];
  state.institutions = [];
  state.chain = new Map();
  state.certificateWrites = 0;
  state.rateLimitTableDown = false;
}

const newId = () => `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`;
const matchesDate = (value: Date, filter: DateFilter) =>
  (filter.gt === undefined || value > filter.gt)
  && (filter.gte === undefined || value >= filter.gte)
  && (filter.lt === undefined || value < filter.lt);
const rateLimitTable = () => {
  if (state.rateLimitTableDown) throw new Error('stand-in: rate limit table unavailable');
  return state.rateLimitEvents;
};
const refuseWrite = () => {
  state.certificateWrites += 1;
  throw new Error('stand-in: certificates must never be written here');
};

/**
 * A certificate as the database returns it: column defaults filled in (hash version 1, no frozen facts), and the
 * student and institution joined LIVE from their own records, so editing those records shows up here exactly as
 * it would in Postgres. Certificates that carry their own `student` / `institution` objects keep them.
 */
function withRelations(row: Row) {
  const student = state.students.find((item) => item.id === row.studentId);
  const institution = state.institutions.find((item) => item.id === row.institutionId);
  return {
    hashVersion: 1,
    studentNameAtIssue: null,
    studentNumberAtIssue: null,
    institutionNameAtIssue: null,
    blockchainTransactions: [],
    ...row,
    student: student ? { fullName: student.fullName, studentNumber: student.studentNumber } : row.student,
    institution: institution ? { name: institution.name } : row.institution
  };
}
const matchesWhere = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

/** Returns only the selected fields, as Prisma does (nested `{ select }` for relations); everything without one. */
function project(row: Row | null | undefined, select?: Row): any {
  if (!row || !select) return row ?? null;
  const picked: Row = {};
  for (const [key, choice] of Object.entries(select)) {
    if (!choice) continue;
    const value = row[key];
    if (choice !== true && typeof choice === 'object' && 'select' in choice) {
      picked[key] = Array.isArray(value) ? value.map((item) => project(item, choice.select)) : project(value, choice.select);
    } else {
      picked[key] = value;
    }
  }
  return picked;
}

export const fakePrisma: Row = {
  certificate: {
    async findUnique({ where, select }: Row) {
      const row = state.certificates.find((item) => (where.certificateUid ? item.certificateUid === where.certificateUid : item.id === where.id));
      return row ? project(withRelations(row), select) : null;
    },
    async findFirst({ where, select }: Row) {
      const row = state.certificates.find((item) => matchesWhere(item, where));
      return row ? project(withRelations(row), select) : null;
    },
    async create({ data, select }: Row) {
      const row = { id: newId(), createdAt: new Date(), updatedAt: new Date(), ...data };
      state.certificates.push(row);
      return project(withRelations(row), select);
    },
    update: refuseWrite,
    updateMany: refuseWrite,
    upsert: refuseWrite,
    delete: refuseWrite
  },
  certificateVerification: {
    async create({ data }: Row) {
      const row = { id: newId(), verifiedAt: new Date(), ...data };
      state.verifications.push(row);
      return row;
    }
  },
  employer: {
    async findFirst() {
      return { id: 'eeeeeeee-0000-4000-8000-00000000000e' };
    }
  },
  auditLog: {
    async findFirst({ where }: Row) {
      return state.auditLogs.find((row) => row.action === where.action
        && row.entityType === where.entityType
        && row.entityId === where.entityId
        && (!where.createdAt || matchesDate(row.createdAt, where.createdAt))) ?? null;
    },
    async create({ data }: Row) {
      const row = { id: newId(), createdAt: new Date(), ipAddress: null, ...data };
      state.auditLogs.push(row);
      return row;
    }
  },
  user: {
    async findUnique({ where }: Row) {
      return state.users.find((user) => (where.email !== undefined ? user.email === where.email : user.id === where.id)) ?? null;
    },
    async update({ where, data }: Row) {
      const user = state.users.find((item) => item.id === where.id);
      Object.assign(user!, data);
      return user;
    }
  },
  institution: {
    async findUnique({ where, select }: Row) {
      return project(state.institutions.find((item) => matchesWhere(item, where)), select);
    }
  },
  student: {
    async findFirst({ where, select }: Row) {
      return project(state.students.find((item) => matchesWhere(item, where)), select);
    },
    async findUnique({ where, select }: Row) {
      return project(state.students.find((item) => matchesWhere(item, where)), select);
    },
    async update({ where, data }: Row) {
      const student = state.students.find((item) => item.id === where.id);
      Object.assign(student!, data);
      return student;
    }
  },
  // Issuance with no saved template: the built-in design, and no active signatories.
  certificateTemplate: {
    async findFirst() {
      return null;
    }
  },
  signatory: {
    async findMany() {
      return [];
    }
  },
  async $transaction(work: (tx: Row) => Promise<unknown>) {
    const create = (table: Row[]) => async ({ data }: Row) => {
      const row = { id: newId(), ...data };
      table.push(row);
      return row;
    };
    // The transaction client can do everything the client can, plus the creates registration uses.
    return work({
      ...fakePrisma,
      user: { ...fakePrisma.user, create: create(state.users) },
      institution: { ...fakePrisma.institution, create: create([]) },
      student: { ...fakePrisma.student, create: create([]) },
      employer: { create: create([]) }
    });
  },
  rateLimitEvent: {
    async findMany({ where, orderBy, take }: Row) {
      const rows = rateLimitTable()
        .filter((row) => row.scope === where.scope && row.keyHash === where.keyHash && matchesDate(row.createdAt, where.createdAt))
        .sort((a, b) => (orderBy?.createdAt === 'desc' ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime()));
      return rows.slice(0, take ?? rows.length).map((row) => ({ createdAt: row.createdAt }));
    },
    async create({ data }: Row) {
      const row = { id: newId(), createdAt: new Date(), ...data };
      rateLimitTable().push(row);
      return row;
    },
    async deleteMany({ where }: Row) {
      const before = rateLimitTable().length;
      state.rateLimitEvents = rateLimitTable().filter((row) => !matchesDate(row.createdAt, where.createdAt));
      return { count: before - state.rateLimitEvents.length };
    }
  }
};

/** The contract's getCertificate result, shaped like an ethers Result (named fields and positions). */
function chainResult(record: ChainRecord) {
  const issuer = '0x0000000000000000000000000000000000000002';
  return Object.assign([record.certificateHash, issuer, record.revoked, record.issuedAt], { ...record, issuer });
}

const fakeBlockchain = {
  __esModule: true,
  blockchainProvider: {},
  certificateRegistry: {
    async getCertificate(certificateUid: string) {
      return chainResult(state.chain.get(certificateUid) ?? { certificateHash: `0x${'0'.repeat(64)}`, revoked: false, issuedAt: 0n });
    }
  },
  adminCertificateRegistry: {},
  getFeeOverrides: async () => ({})
};

function stubModule(fromSrc: string, exports: object) {
  const filename = require.resolve(path.join(__dirname, '..', '..', 'src', fromSrc));
  const stub = new Module(filename);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

stubModule('config/db', { __esModule: true, default: fakePrisma });
stubModule('config/blockchain', fakeBlockchain);

/** Starts the real Express app on a free local port. */
export async function startServer(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

/** Moves stored rate-limit events back in time, as if `seconds` had passed. */
export function ageRateLimitEvents(seconds: number) {
  for (const event of state.rateLimitEvents) event.createdAt = new Date(event.createdAt.getTime() - seconds * 1000);
}

/** The number of stored rate-limit events for a scope. */
export function rateLimitEventCount(scope: string) {
  return state.rateLimitEvents.filter((event) => event.scope === scope).length;
}
