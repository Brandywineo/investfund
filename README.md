# InvestFund

TypeScript investment-accounting, treasury, manually reported trading, and community platform.

## Development status

Milestone 1 is in progress. The current foundation includes:

- TanStack Start, React 19, Tailwind CSS 4, and TypeScript;
- PostgreSQL schema and Drizzle migrations;
- user, role, session, and audit-log persistence;
- immutable double-entry ledger structures;
- configurable investment limits and effective-dated rates;
- exact-decimal compounding calculations and idempotency keys;
- financial-invariant unit tests; and
- the initial responsive investor dashboard.
- password authentication with database-backed, HTTP-only sessions;
- protected application routes and registration/login screens;
- transactional investment and daily-accrual ledger services; and
- a portable Nitro production server that binds to environment-configured host and port.

See [ROADMAP.md](./ROADMAP.md) for the four delivery milestones and acceptance criteria.

## Local setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Set `DATABASE_URL`, `APP_ORIGIN`, and a strong `SESSION_SECRET` in `.env`. Never commit production secrets.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

The application can also use Bun on deployment servers after dependencies are installed with Bun.
