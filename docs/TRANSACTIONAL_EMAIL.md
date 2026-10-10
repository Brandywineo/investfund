# Transactional email

Enabled delivery now queues password-change alerts (Profile and password reset), one welcome email after verification, confirmed deposit receipts, investment activation receipts, and withdrawal request/broadcast/confirmed/restored outcomes. Password reset and verification emails use the configured expiry and APP_ORIGIN, which must be https://investfund.site in production.

There are no statements, daily profit emails, or support-reply emails. Ledger and private in-app support remain the places to read those updates. Existing financial events are not backfilled. New receipts are skipped while delivery is disabled.

Financial receipts are inserted in the business transaction: a failed transaction cannot send a success receipt. Migration 0030 adds a nullable unique event key to protect business-event retries. The email worker uses a stable Resend idempotency key for delivery retries and recovers claims abandoned for five minutes. Provider idempotency is bounded by the provider's retention window; it does not guarantee deduplication forever. The service timeout is raised to 450 seconds for a full 25-message batch with 15-second request timeouts.

Deploy with Bun: pull main, install dependencies, run db:migrate before restarting the application and workers, and build. Copy deploy/investfund-email.service and deploy/investfund-email.timer into /etc/systemd/system, daemon-reload, enable the email timer, and run the worker once. Restart any long-running signer process using the custody service so it loads the new broadcast receipt hook. Scheduled chain/accrual processes load the code on their next invocation; do not reset scanning checkpoints for this release.

Validation uses an isolated PostgreSQL-compatible PGlite database with the entire migration sequence. Tests cover exact deposit receipts, event retries, transaction rollback, activation failure, withdrawal restoration and confirmation, welcome token reuse, reset expiry/session revocation/new login, Profile password changes, disabled delivery, and interrupted delivery retries. Live recipient delivery still depends on the production configuration and provider.
