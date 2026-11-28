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
type DateFilter = { gt?: Date; gte?: Date; lt?: Date; lte?: Date };

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
  [key: string]: unknown;
}

export interface ChainRecord {
  certificateHash: string;
  revoked: boolean;
  issuedAt: bigint;
}

export const EMPLOYER_ID = 'eeeeeeee-0000-4000-8000-00000000000e';
export const EMPLOYER_NAME = 'Acme Hiring';

/** Everything the stand-ins hold or saw. Reset between tests with resetState(). */
export const state = {
  certificates: [] as FakeCertificate[],
  users: [] as Row[],
  verifications: [] as Row[],
  auditLogs: [] as Row[],
  rateLimitEvents: [] as { id: string; scope: string; keyHash: string; createdAt: Date }[],
  notifications: [] as Row[],
  correctionRequests: [] as Row[],
  // Live student and institution records, joined into certificates the way the database joins them.
  students: [] as Row[],
  institutions: [] as Row[],
  chain: new Map<string, ChainRecord>(),
  // Calls that wrote to a certificate (only revocation may).
  certificateWrites: 0,
  // When true, every rate-limit table operation fails (to test that the limiter fails open).
  rateLimitTableDown: false,
  // When true, every notification table operation fails (to test that a failed notification breaks nothing).
  notificationsDown: false,
  nextId: 1
};

export function resetState() {
  state.certificates = [];
  state.users = [];
  state.verifications = [];
  state.auditLogs = [];
  state.rateLimitEvents = [];
  state.notifications = [];
  state.correctionRequests = [];
  state.students = [];
  state.institutions = [];
  state.chain = new Map();
  state.certificateWrites = 0;
  state.rateLimitTableDown = false;
  state.notificationsDown = false;
}

const newId = () => `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`;
const matchesDate = (value: Date, filter: DateFilter) =>
  (filter.gt === undefined || value > filter.gt)
  && (filter.gte === undefined || value >= filter.gte)
  && (filter.lt === undefined || value < filter.lt)
  && (filter.lte === undefined || value <= filter.lte);
const isPlainObject = (value: unknown): value is Row => value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value);

/** A small subset of Prisma's where: equality, null, { in }, { not }, date ranges, OR, and relation filters. */
function matches(row: Row | null | undefined, where: Row | undefined): boolean {
  if (!where) return true;
  if (!row) return false;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === 'OR') return (condition as Row[]).some((option) => matches(row, option));
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (isPlainObject(condition)) {
      if ('in' in condition) return (condition.in as unknown[]).includes(value);
      if ('not' in condition) return value !== condition.not;
      if (['gt', 'gte', 'lt', 'lte'].some((operator) => operator in condition)) return value instanceof Date && matchesDate(value, condition);
      return matches(value, condition);
    }
    return value === condition;
  });
}

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

/** findMany over rows: where, orderBy (one key), skip, take and select. */
function query(rows: Row[], args: Row = {}) {
  let found = rows.filter((row) => matches(row, args.where));
  const [orderKey, direction] = Object.entries(args.orderBy ?? {})[0] ?? [];
  if (orderKey) {
    found = [...found].sort((a, b) => {
      const difference = new Date(a[orderKey]).getTime() - new Date(b[orderKey]).getTime();
      return direction === 'desc' ? -difference : difference;
    });
  }
  found = found.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take);
  return found.map((row) => project(row, args.select));
}

/**
 * A certificate as the database returns it: column defaults filled in (hash version 1, no frozen facts), and the
 * student and institution joined LIVE from their own records, so editing those records shows up here exactly as
 * it would in Postgres. Certificates that carry their own `student` / `institution` objects keep them.
 */
function withRelations(row: Row): Row {
  const student = state.students.find((item) => item.id === row.studentId);
  const institution = state.institutions.find((item) => item.id === row.institutionId);
  const studentUser = student && state.users.find((user) => user.id === student.userId);
  return {
    hashVersion: 1,
    studentNameAtIssue: null,
    studentNumberAtIssue: null,
    institutionNameAtIssue: null,
    blockchainTransactions: [],
    ...row,
    student: student
      ? { ...student, user: { notifyOnVerification: studentUser ? studentUser.notifyOnVerification !== false : true } }
      : row.student,
    institution: institution ? { ...institution } : row.institution
  };
}

/** A student with their user and institution joined. */
function withStudentRelations(row: Row | undefined): Row | undefined {
  if (!row) return row;
  const user = state.users.find((item) => item.id === row.userId);
  return {
    ...row,
    user: user ? { notifyOnVerification: true, ...user } : null,
    institution: state.institutions.find((item) => item.id === row.institutionId) ?? null
  };
}

/** A correction request with its certificates and student joined. */
function withRequestRelations(row: Row): Row {
  const certificate = state.certificates.find((item) => item.id === row.certificateId);
  const replacement = row.replacementCertificateId ? state.certificates.find((item) => item.id === row.replacementCertificateId) : null;
  return {
    resolutionNote: null,
    resolvedAt: null,
    replacementCertificateId: null,
    ...row,
    certificate: certificate ? withRelations(certificate) : null,
    replacementCertificate: replacement ? withRelations(replacement) : null,
    student: state.students.find((item) => item.id === row.studentId) ?? null
  };
}

const rateLimitTable = () => {
  if (state.rateLimitTableDown) throw new Error('stand-in: rate limit table unavailable');
  return state.rateLimitEvents;
};
const notificationTable = () => {
  if (state.notificationsDown) throw new Error('stand-in: notification table unavailable');
  return state.notifications;
};
const refuseWrite = () => {
  state.certificateWrites += 1;
  throw new Error('stand-in: certificates must never be written here');
};
const updateRows = (rows: Row[], where: Row, data: Row) => {
  const found = rows.filter((row) => matches(row, where));
  for (const row of found) Object.assign(row, data);
  return { count: found.length };
};

export const fakePrisma: Row = {
  certificate: {
    async findUnique({ where, select }: Row) {
      const row = state.certificates.find((item) => (where.certificateUid ? item.certificateUid === where.certificateUid : item.id === where.id));
      return row ? project(withRelations(row), select) : null;
    },
    async findFirst({ where, select }: Row) {
      const row = state.certificates.map(withRelations).find((item) => matches(item, where));
      return row ? project(row, select) : null;
    },
    async findMany(args: Row) {
      return query(state.certificates.map(withRelations), args);
    },
    async count({ where }: Row = {}) {
      return state.certificates.map(withRelations).filter((row) => matches(row, where)).length;
    },
    async create({ data, select }: Row) {
      const row = { id: newId(), createdAt: new Date(), updatedAt: new Date(), ...data };
      state.certificates.push(row as FakeCertificate);
      return project(withRelations(row), select);
    },
    // Only revocation writes to a certificate; every write is counted.
    async update({ where, data, select }: Row) {
      state.certificateWrites += 1;
      const row = state.certificates.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return project(withRelations(row), select);
    },
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
      return { id: EMPLOYER_ID };
    },
    async findUnique({ where }: Row) {
      return where.id === EMPLOYER_ID ? { companyName: EMPLOYER_NAME } : null;
    }
  },
  auditLog: {
    async findFirst({ where }: Row) {
      return state.auditLogs.find((row) => matches(row, where)) ?? null;
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
    async update({ where, data, select }: Row) {
      const user = state.users.find((item) => item.id === where.id);
      Object.assign(user!, data);
      return project(user, select);
    }
  },
  institution: {
    async findUnique({ where, select }: Row) {
      return project(state.institutions.find((item) => matches(item, where)), select);
    }
  },
  student: {
    async findFirst({ where, select }: Row) {
      return project(withStudentRelations(state.students.find((item) => matches(item, where))), select);
    },
    async findUnique({ where, select }: Row) {
      return project(withStudentRelations(state.students.find((item) => matches(item, where))), select);
    },
    async update({ where, data, select }: Row) {
      const student = state.students.find((item) => item.id === where.id);
      Object.assign(student!, data);
      return project(student, select);
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
  notification: {
    async findFirst({ where, select }: Row) {
      return project(notificationTable().find((row) => matches(row, where)), select);
    },
    async findMany(args: Row) {
      return query(notificationTable(), args);
    },
    async count({ where }: Row = {}) {
      return notificationTable().filter((row) => matches(row, where)).length;
    },
    async create({ data }: Row) {
      const row = { id: newId(), createdAt: new Date(), isRead: false, ...data };
      notificationTable().push(row);
      return row;
    },
    async updateMany({ where, data }: Row) {
      return updateRows(notificationTable(), where, data);
    },
    async deleteMany({ where }: Row) {
      const before = notificationTable().length;
      state.notifications = notificationTable().filter((row) => !matches(row, where));
      return { count: before - state.notifications.length };
    }
  },
  credentialCorrectionRequest: {
    async findUnique({ where, select }: Row) {
      const row = state.correctionRequests.find((item) => item.id === where.id);
      return row ? project(withRequestRelations(row), select) : null;
    },
    async findFirst({ where, select }: Row) {
      const row = state.correctionRequests.map(withRequestRelations).find((item) => matches(item, where));
      return row ? project(row, select) : null;
    },
    async findMany(args: Row) {
      return query(state.correctionRequests.map(withRequestRelations), args);
    },
    async count({ where }: Row = {}) {
      return state.correctionRequests.map(withRequestRelations).filter((row) => matches(row, where)).length;
    },
    async create({ data, select }: Row) {
      // Column defaults, as the database fills them in.
      const row = { id: newId(), status: 'PENDING', requestedAt: new Date(), resolvedAt: null, resolutionNote: null, replacementCertificateId: null, resolvedById: null, ...data };
      state.correctionRequests.push(row);
      return project(withRequestRelations(row), select);
    },
    async updateMany({ where, data }: Row) {
      return updateRows(state.correctionRequests, where, data);
    }
  },
  async $transaction(work: ((tx: Row) => Promise<unknown>) | Promise<unknown>[]) {
    if (Array.isArray(work)) return Promise.all(work);
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
