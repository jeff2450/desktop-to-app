/**
 * Manually generated Prisma Client types stub.
 * Derived from: apps/api/prisma/schema.prisma + actual codebase usage.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export declare const Plan: {
  FREE:     'FREE';
  STARTER:  'STARTER';
  PRO:      'PRO';
};
export declare type Plan = 'FREE' | 'STARTER' | 'PRO';

export declare const JobStatus: {
  QUEUED:    'QUEUED';
  RUNNING:   'RUNNING';
  SUCCESS:   'SUCCESS';
  FAILED:    'FAILED';
  CANCELLED: 'CANCELLED';
};
export declare type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

// ─── Model types ─────────────────────────────────────────────────────────────

export declare type User = {
  id:               string;
  email:            string;
  passwordHash:     string;
  plan:             Plan;
  stripeCustomerId: string | null;
  createdAt:        Date;
};

export declare type Session = {
  id:           string;
  userId:       string;
  refreshToken: string;
  expiresAt:    Date;
};

export declare type Job = {
  id:          string;
  userId:      string;
  status:      JobStatus;
  inputName:   string;
  sourceRepo:  string;
  config:      unknown;
  platforms:   string[];
  logs:        string | null;
  outputPath:  string | null;
  errorMsg:    string | null;
  createdAt:   Date;
  completedAt: Date | null;
  updatedAt:   Date;
};

export declare type Artifact = {
  id:        string;
  jobId:     string;
  platform:  string;
  s3Key:     string;
  sizeBytes: number;
};

// ─── Prisma namespace ─────────────────────────────────────────────────────────

export declare namespace Prisma {
  type InputJsonValue = string | number | boolean | null | InputJsonObject | InputJsonArray;
  interface InputJsonObject { [key: string]: InputJsonValue | undefined; }
  interface InputJsonArray extends Array<InputJsonValue> {}

  type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
  interface JsonObject { [key: string]: JsonValue; }
  interface JsonArray extends Array<JsonValue> {}

  type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

  interface JobGroupByOutputType {
    createdAt: Date;
    _count: number;
  }

  // Filter types — stand-alone objects, not intersected with primitives
  interface DateTimeFilter   { gte?: Date; lte?: Date; gt?: Date; lt?: Date; }
  interface StringNullFilter { not?: string | null; in?: string[]; contains?: string; }
  interface JobStatusFilter  { not?: JobStatus; in?: JobStatus[]; }
}

// ─── PrismaClient ─────────────────────────────────────────────────────────────

export declare class PrismaClient {
  constructor(options?: {
    log?: Array<'query' | 'info' | 'warn' | 'error' | { emit: 'event' | 'stdout'; level: string }>;
    datasources?: { db?: { url?: string } };
  });

  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number }
  ): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;

  readonly user:     UserDelegate;
  readonly session:  SessionDelegate;
  readonly job:      JobDelegate;
  readonly artifact: ArtifactDelegate;
}

// ─── User delegate ────────────────────────────────────────────────────────────

type UserWhereUnique = { id?: string; email?: string; stripeCustomerId?: string };

/** Partial record for user creation — stripeCustomerId and plan are optional */
type UserCreateInput = {
  email:            string;
  passwordHash:     string;
  plan?:            Plan | string;
  stripeCustomerId?: string | null;
  id?:              string;
  createdAt?:       Date;
};

interface UserDelegate {
  findUnique(args: { where: UserWhereUnique; select?: Record<string, boolean>; include?: Record<string, boolean> }): Promise<any>;
  findFirst(args?: { where?: Partial<User>; include?: Record<string, boolean> }): Promise<User | null>;
  findMany(args?: { where?: Partial<User>; orderBy?: Record<string, unknown>; take?: number; skip?: number }): Promise<User[]>;
  create(args: { data: UserCreateInput; select?: Record<string, boolean> }): Promise<any>;
  update(args: { where: UserWhereUnique; data: Partial<Omit<User, 'id'>> }): Promise<User>;
  updateMany(args: { where: Partial<User> | Record<string, unknown>; data: Partial<Omit<User, 'id'>> }): Promise<{ count: number }>;
  delete(args: { where: UserWhereUnique }): Promise<User>;
  count(args?: { where?: Partial<User> }): Promise<number>;
}

// ─── Session delegate ─────────────────────────────────────────────────────────

type SessionWhereUnique = { id?: string; refreshToken?: string };
type SessionWithUser    = Session & { user: User };

interface SessionDelegate {
  findUnique(args: { where: SessionWhereUnique; include: { user: true } }): Promise<SessionWithUser | null>;
  findUnique(args: { where: SessionWhereUnique; include?: Record<string, boolean> }): Promise<Session | null>;
  findMany(args?: { where?: Partial<Session> }): Promise<Session[]>;
  create(args: { data: Omit<Session, 'id'> & { id?: string } }): Promise<Session>;
  update(args: { where: SessionWhereUnique; data: Partial<Omit<Session, 'id'>> }): Promise<Session>;
  delete(args: { where: SessionWhereUnique }): Promise<Session>;
  deleteMany(args?: { where?: Partial<Session> }): Promise<{ count: number }>;
}

// ─── Job delegate ─────────────────────────────────────────────────────────────

type JobWhereUnique  = { id?: string };
type JobWithArtifacts = Job & { artifacts: Artifact[] };

type JobCountWhere = {
  userId?:    string;
  createdAt?: Prisma.DateTimeFilter;
  status?:    Prisma.JobStatusFilter;
};

type JobCreateData = {
  userId:      string;
  sourceRepo:  string;
  config:      Prisma.InputJsonValue;
  platforms:   string[];
  inputName:   string;
  status?:     JobStatus;
  logs?:       string | null;
  outputPath?: string | null;
  errorMsg?:   string | null;
  completedAt?: Date | null;
};

interface JobDelegate {
  findUnique(args: { where: JobWhereUnique; select: Record<string, boolean> }): Promise<Partial<Job> | null>;
  findUnique(args: { where: JobWhereUnique; include?: Record<string, boolean> }): Promise<JobWithArtifacts | null>;
  findFirst(args?: { where?: Partial<Job> & { userId?: string; id?: string }; include?: Record<string, boolean>; orderBy?: Record<string, unknown> }): Promise<JobWithArtifacts | null>;
  findMany(args?: { where?: Partial<Job> & { userId?: string }; include?: Record<string, boolean>; orderBy?: Record<string, unknown>; take?: number; skip?: number }): Promise<JobWithArtifacts[]>;
  create(args: { data: JobCreateData; include?: Record<string, boolean> }): Promise<JobWithArtifacts>;
  update(args: { where: JobWhereUnique; data: Partial<Omit<Job, 'id'>> }): Promise<Job>;
  delete(args: { where: JobWhereUnique }): Promise<Job>;
  count(args?: { where?: JobCountWhere }): Promise<number>;
  groupBy(args: { by: string[]; where?: Record<string, unknown>; _count?: boolean; orderBy?: Record<string, unknown> }): Promise<Prisma.JobGroupByOutputType[]>;
}

// ─── Artifact delegate ────────────────────────────────────────────────────────

interface ArtifactDelegate {
  findMany(args?: { where?: Partial<Artifact>; orderBy?: Record<string, unknown> }): Promise<Artifact[]>;
  create(args: { data: Omit<Artifact, 'id'> & { id?: string } }): Promise<Artifact>;
  createMany(args: { data: Array<Omit<Artifact, 'id'> & { id?: string }> }): Promise<{ count: number }>;
  delete(args: { where: { id?: string } }): Promise<Artifact>;
  deleteMany(args?: { where?: Partial<Artifact> }): Promise<{ count: number }>;
}

export {};
