# InvestFund delivery roadmap

## Product rules locked for the first release

- TypeScript-first web platform with PostgreSQL.
- Roles: user, manager, and administrator.
- Investments accept a configurable minimum and maximum (initially 300–5,000 USDT).
- Daily compounding uses an effective-dated admin rate (initially 2%); rate changes never rewrite prior accruals.
- Every financial change is represented by an immutable ledger entry. Displayed balances are derived from ledger entries, not directly edited.
- Trading is manually reported in V1 and uses a source field so MT4/MT5 ingestion can replace manual input later.
- Deposits arrive in a platform-controlled BEP20 USDT wallet.
- Admin may move excess custody funds to the trading/broker treasury. The hot wallet retains only the configured withdrawal reserve.
- Blockchain transfers, broker-funding transfers, adjustments, and reconciliations require references and audit records.
- Community V1 supports groups, text, images, replies, reactions, announcements, and moderation; it excludes video.
- The responsive web app becomes an installable PWA first, then an Android package using Capacitor.

## Core accounting model

Funds are tracked by location as well as by user liability:

1. `hot_wallet`: confirmed USDT available for withdrawals.
2. `treasury_in_transit`: funds sent but not yet confirmed at the destination.
3. `broker_treasury`: capital recorded as available for trading/held at the broker.
4. `withdrawal_reserved`: hot-wallet funds committed to approved withdrawals.
5. `fees_and_adjustments`: explicit, authorized accounting entries with reason and actor.

User balances and investments are liabilities. Wallet and broker balances are assets. Moving funds to MT5 does not change a user's investment balance or create profit; it only changes where platform assets are held.

The dashboard must continuously show:

- total user liabilities;
- hot-wallet balance and available withdrawal liquidity;
- configured reserve requirement and reserve shortfall/surplus;
- funds in transit;
- broker treasury balance;
- pending/approved withdrawals;
- unreconciled transactions; and
- total assets versus liabilities.

## Milestone 1 of 4 — Foundation and financial core

### Scope

- Initialize the TypeScript application, database migrations, tests, environment validation, and deployment configuration.
- Authentication, email verification, password reset, sessions, and security event history.
- User, manager, and administrator permissions with least-privilege route guards.
- Immutable double-entry ledger and idempotency keys for all money-changing operations.
- Wallet balance, investment creation, minimum/maximum validation, and investment lifecycle.
- Effective-dated daily-rate configuration and a retry-safe daily accrual job using exact decimal arithmetic.
- Admin audit log covering settings, roles, investments, and all financial actions.
- Initial responsive user dashboard and admin operations dashboard.

### Acceptance tests

- A user cannot invest less than 300 or more than 5,000 USDT under the initial configuration.
- A 1,000 USDT investment accrues to 1,020.00 after one 2% posting and 1,040.40 after two postings.
- Re-running an accrual job cannot post the same investment/day twice.
- Changing the rate affects only future accrual periods.
- Ledger debits and credits balance for every transaction.
- Managers cannot change rates, ledger entries, wallet configuration, or administrator roles.

## Milestone 2 of 4 — BEP20 custody, treasury, and withdrawals

### Scope

- Unique deposit attribution and confirmation-aware BEP20 USDT deposit watcher.
- Deposit address/status UI and transaction history.
- Secure wallet-service boundary; keys are never stored in frontend code, source control, ordinary database fields, or the mobile package.
- Configurable hot-wallet withdrawal reserve: fixed amount, percentage of withdrawable liabilities, or the higher of both.
- Admin treasury-transfer workflow from hot wallet to broker funding destination.
- Transfer states: drafted, approved, broadcast, confirmed, broker-credited, failed, and reconciled.
- Mandatory chain transaction hash and broker/MT5 funding reference where applicable.
- Withdrawal request, review, reservation, broadcast, confirmation, rejection, and cancellation flows.
- Low-reserve warnings and withdrawal queueing; the system never pretends unavailable liquidity has been paid.
- Daily on-chain, broker, and ledger reconciliation report.

### Acceptance tests

- A deposit is credited exactly once after the configured confirmation threshold.
- Sending funds to the broker decreases hot-wallet assets and increases in-transit assets, without altering user liabilities.
- Confirming broker receipt moves the amount from in-transit to broker treasury.
- Approved withdrawals reserve funds so they cannot be spent twice.
- Treasury transfer is blocked or warned when it would breach the reserve policy.
- Every movement can be traced from user/administrator action to ledger entries, TXID/reference, actor, and timestamps.

## Milestone 3 of 4 — Trading desk, performance, and community

### Scope

- Strategy and trading-session management.
- Instrument contract specifications and previewed P&L calculations.
- Manual open, modify, partial-close, and close trade workflows.
- Trade activity log and immutable revision history.
- Public/private Trade Explorer with open positions, closed trades, win rate, realized P&L, drawdown, and performance charts.
- Keep contractual daily accrual and trading performance visibly separate.
- Community groups, memberships, messages, image uploads, replies, reactions, pins, mentions, and manager announcements.
- Moderation: report, mute, remove, suspend, and retained moderation audit records.
- Automated strategy-room posts when trades open, change, or close.
- Real-time updates and notifications.

### Acceptance tests

- Gold and other instruments calculate P&L from configured contract specifications rather than hardcoded assumptions.
- Losses and trade edits remain visible in performance/audit history.
- A trading result never directly edits an investment or wallet balance.
- Only authorized managers can operate assigned strategies or moderate assigned rooms.
- Images are type/size validated and rendered safely; executable uploads and video are rejected.

## Milestone 4 of 4 — Installable app, security, and production readiness

### Scope

- Complete responsive UI and installable PWA with offline-safe navigation (no offline financial mutations).
- Capacitor Android application using the same TypeScript frontend and API.
- Push notifications for deposits, accruals, withdrawals, trades, mentions, and security events.
- Two-factor authentication for administrators/managers and sensitive-action reauthentication.
- Rate limits, CSRF/session protection, encrypted secrets, database backups, restore drills, monitoring, and alerts.
- Financial invariants, concurrency tests, permission tests, wallet testnet tests, and end-to-end critical flows.
- Hestia deployment, system service, reverse proxy, health checks, staging-to-production checklist, and operator runbook.
- MT5 integration interface documented for the next release (`trade_source = MANUAL | MT5`).

### Acceptance tests

- The PWA installs from the website and the Android build signs and installs on a test device.
- A compromised manager account cannot access custody secrets or administrator-only financial controls.
- Backup restoration and rollback are tested on staging.
- Ledger, on-chain wallet, withdrawal queue, and broker treasury reconcile before production launch.
- Critical deposit, invest, accrue, treasury-transfer, withdraw, trade, and chat journeys pass end-to-end tests.

## Build order inside each milestone

Each milestone follows: schema and invariants, server services, permission checks, UI, automated tests, staging deployment, manual acceptance, then milestone sign-off. We do not start the next financial feature until the prior milestone's accounting invariants pass.

## Inputs needed before Milestone 1 implementation

- Final product name (or permission to use `InvestFund` as a temporary name).
- Test domain/subdomain and deployment path.
- PostgreSQL database availability on the Hestia server.
- Email provider choice for verification/password reset, or permission to use a development mail sink initially.
- Branding can remain placeholder until Milestone 3.

Inputs such as wallet keys, database passwords, SMTP credentials, and later broker credentials must be entered directly into server secret configuration and never pasted into chat or committed to Git.
