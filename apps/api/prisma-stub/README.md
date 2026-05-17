# Prisma Client Stub

This folder contains hand-crafted TypeScript types for `@prisma/client` that match
the project schema (`prisma/schema.prisma`). They are needed in CI/build environments
where `prisma generate` cannot download the engine binaries.

## When you need this

If you're on a machine with internet access to `prisma.sh`, just run:

```bash
cd apps/api
npx prisma generate
```

That generates the real types and you're done — no stub needed.

## When `prisma generate` is blocked (CI, sandboxed envs)

Run the setup script from the monorepo root:

```bash
node apps/api/prisma-stub/apply.mjs
```

This copies `default.d.ts` over the shell `@prisma/client` package so TypeScript
can resolve `PrismaClient`, `Plan`, `JobStatus`, etc.
