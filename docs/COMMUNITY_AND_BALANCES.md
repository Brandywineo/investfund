# Community and admin balances

The community page now contains three shared rooms: Announcements, Investor lounge and Trading desk. All active signed-in users can read them. Users join a room before sending messages or reacting. Admins can create rooms and assign an active manager; managers moderate only their assigned rooms.

Supported features: text messages, PNG/JPEG/WebP attachments up to 1 MB, replies, three reactions, pinned updates, reports, retained removals, 24-hour room mutes, and announcement notifications in the existing bell. Messages refresh every 15 seconds while the tab is visible. Loading history pauses automatic refresh until the user returns to the latest messages. Private invitation-only rooms, mentions, video, WebSocket delivery and automated trade posts are not part of this version.

Attachments are stored in PostgreSQL and served through an authenticated, non-cached image endpoint. Hidden messages also hide their attachments. For higher image volume, migrate attachments to dedicated object storage.

The admin user list now shows each user's available and invested ledger balances, reserved withdrawals, total current balance, pending net payout and requested/deferred investment exits. Users can be searched by name/email or filtered to those with requests. Withdrawal cards also show the current total and its breakdown.

Current balance = available ledger balance + invested ledger balance + pending gross withdrawals. Confirmed deposit/withdrawal totals remain historical activity. Investment exits are already included in invested funds and are never added to current balance a second time. Available funds exclude money already reserved for withdrawal. Pending withdrawal statuses are REQUESTED, APPROVED, PROCESSING and BROADCAST; pending exit statuses are REQUESTED and DEFERRED. These views do not change financial balances.

## Deploy

Run from the existing InvestFund checkout as its deployment user:

```bash
git pull --ff-only origin main
bun install
bun run db:migrate
bun run build
```

Bun loads the checkout's `.env`; DATABASE_URL must point to the existing InvestFund PostgreSQL database. Migration `0026_community_rooms.sql` creates five community tables and seeds the three rooms. Run the migration before restarting the application service. Restart the existing app service using your established systemd deployment procedure; no chain, signer or MT5 configuration changes are needed.

After restart, check `/community`, `/admin/users`, and `/admin/withdrawals`. Publish a test announcement from admin, then verify the user's notification bell. Test a discussion-room message and image, a report/removal, and compare the user balance breakdown with the user ledger. Do not approve or pay a withdrawal just to test these views.

## Validation

`npm run typecheck`, `npm test`, production build and lint checks cover the change. PostgreSQL integration tests use PGlite, apply the entire migration sequence, and exercise real query/transaction logic with only session and HTTP transport mocked. They cover membership, room-scoped manager access, announcement restrictions, retry safety, rate limiting, muted members, retained moderation, hidden image access, notification creation, cursor pagination and exact-decimal current-balance totals.
