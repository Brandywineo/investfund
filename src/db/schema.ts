import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', ['USER', 'MANAGER', 'ADMIN'])
export const userStatus = pgEnum('user_status', [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
])
export const investmentStatus = pgEnum('investment_status', [
  'ACTIVE',
  'PAUSED',
  'MATURED',
  'CANCELLED',
])
export const normalBalance = pgEnum('normal_balance', ['DEBIT', 'CREDIT'])
export const ledgerAccountType = pgEnum('ledger_account_type', [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
])
export const depositStatus = pgEnum('deposit_status', [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
])
export const treasuryTransferStatus = pgEnum('treasury_transfer_status', [
  'DRAFTED',
  'BROADCAST',
  'BROKER_CREDITED',
  'FAILED',
  'RECONCILED',
])
export const withdrawalStatus = pgEnum('withdrawal_status', [
  'REQUESTED',
  'APPROVED',
  'BROADCAST',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: userRole('role').default('USER').notNull(),
    status: userStatus('status').default('PENDING_VERIFICATION').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_unique').on(sql`lower(${table.email})`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('email_verification_user_idx').on(table.userId)],
)

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('password_reset_user_idx').on(table.userId)],
)

export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey().default(1),
  currency: text('currency').default('USDT').notNull(),
  minimumInvestment: numeric('minimum_investment', { precision: 20, scale: 8 })
    .default('300')
    .notNull(),
  maximumInvestment: numeric('maximum_investment', { precision: 20, scale: 8 })
    .default('5000')
    .notNull(),
  compoundingEnabled: boolean('compounding_enabled').default(true).notNull(),
  ...timestamps,
})

export const custodySettings = pgTable('custody_settings', {
  id: integer('id').primaryKey().default(1),
  network: text('network').default('BEP20').notNull(),
  depositAddress: text('deposit_address'),
  confirmationThreshold: integer('confirmation_threshold')
    .default(15)
    .notNull(),
  reserveFixed: numeric('reserve_fixed', { precision: 20, scale: 8 })
    .default('0')
    .notNull(),
  reservePercent: numeric('reserve_percent', { precision: 9, scale: 6 })
    .default('0')
    .notNull(),
  ...timestamps,
})

export const accrualRates = pgTable(
  'accrual_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dailyRatePercent: numeric('daily_rate_percent', {
      precision: 9,
      scale: 6,
    }).notNull(),
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('accrual_rates_effective_idx').on(table.effectiveFrom),
    check('accrual_rate_non_negative', sql`${table.dailyRatePercent} >= 0`),
  ],
)

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    type: ledgerAccountType('type').notNull(),
    normalBalance: normalBalance('normal_balance').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    currency: text('currency').default('USDT').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('ledger_accounts_owner_idx').on(table.ownerUserId)],
)

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: text('event_type').notNull(),
    referenceType: text('reference_type').notNull(),
    referenceId: uuid('reference_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    description: text('description').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('ledger_transactions_effective_idx').on(table.effectiveAt)],
)

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    transactionId: uuid('transaction_id')
      .references(() => ledgerTransactions.id, { onDelete: 'restrict' })
      .notNull(),
    lineNumber: integer('line_number').notNull(),
    accountId: uuid('account_id')
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' })
      .notNull(),
    debit: numeric('debit', { precision: 20, scale: 8 }).default('0').notNull(),
    credit: numeric('credit', { precision: 20, scale: 8 })
      .default('0')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId, table.lineNumber] }),
    index('ledger_entries_account_idx').on(table.accountId),
    check(
      'ledger_entry_one_side_only',
      sql`(${table.debit} > 0 AND ${table.credit} = 0) OR (${table.credit} > 0 AND ${table.debit} = 0)`,
    ),
  ],
)

export const investments = pgTable(
  'investments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    principal: numeric('principal', { precision: 20, scale: 8 }).notNull(),
    compoundedBalance: numeric('compounded_balance', {
      precision: 20,
      scale: 8,
    }).notNull(),
    status: investmentStatus('status').default('ACTIVE').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
    lastAccruedOn: timestamp('last_accrued_on', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('investments_user_status_idx').on(table.userId, table.status),
    check('investment_principal_positive', sql`${table.principal} > 0`),
    check(
      'investment_balance_non_negative',
      sql`${table.compoundedBalance} >= 0`,
    ),
  ],
)

export const dailyAccruals = pgTable(
  'daily_accruals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    investmentId: uuid('investment_id')
      .references(() => investments.id, { onDelete: 'restrict' })
      .notNull(),
    accrualDate: timestamp('accrual_date', { withTimezone: true }).notNull(),
    openingBalance: numeric('opening_balance', {
      precision: 20,
      scale: 8,
    }).notNull(),
    ratePercent: numeric('rate_percent', { precision: 9, scale: 6 }).notNull(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    closingBalance: numeric('closing_balance', {
      precision: 20,
      scale: 8,
    }).notNull(),
    ledgerTransactionId: uuid('ledger_transaction_id')
      .references(() => ledgerTransactions.id, { onDelete: 'restrict' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('daily_accrual_investment_date_unique').on(
      table.investmentId,
      table.accrualDate,
    ),
  ],
)

export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    network: text('network').default('BEP20').notNull(),
    txHash: text('tx_hash'),
    status: depositStatus('status').default('PENDING').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    ledgerTransactionId: uuid('ledger_transaction_id').references(
      () => ledgerTransactions.id,
    ),
    rejectionReason: text('rejection_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('deposits_tx_hash_unique').on(table.txHash),
    index('deposits_user_status_idx').on(table.userId, table.status),
    check('deposit_amount_positive', sql`${table.amount} > 0`),
  ],
)

export const treasuryTransfers = pgTable(
  'treasury_transfers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    destination: text('destination').notNull(),
    status: treasuryTransferStatus('status').default('DRAFTED').notNull(),
    txHash: text('tx_hash'),
    brokerReference: text('broker_reference'),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    broadcastAt: timestamp('broadcast_at', { withTimezone: true }),
    brokerCreditedAt: timestamp('broker_credited_at', { withTimezone: true }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    hotWalletLedgerTransactionId: uuid(
      'hot_wallet_ledger_transaction_id',
    ).references(() => ledgerTransactions.id),
    brokerLedgerTransactionId: uuid('broker_ledger_transaction_id').references(
      () => ledgerTransactions.id,
    ),
    failureReason: text('failure_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('treasury_transfers_tx_hash_unique').on(table.txHash),
    index('treasury_transfers_status_idx').on(table.status),
    check('treasury_transfer_amount_positive', sql`${table.amount} > 0`),
  ],
)

export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    destinationAddress: text('destination_address').notNull(),
    network: text('network').default('BEP20').notNull(),
    status: withdrawalStatus('status').default('REQUESTED').notNull(),
    txHash: text('tx_hash'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    broadcastAt: timestamp('broadcast_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    reservationLedgerTransactionId: uuid(
      'reservation_ledger_transaction_id',
    ).references(() => ledgerTransactions.id),
    paymentLedgerTransactionId: uuid(
      'payment_ledger_transaction_id',
    ).references(() => ledgerTransactions.id),
    rejectionReason: text('rejection_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('withdrawals_tx_hash_unique').on(table.txHash),
    index('withdrawals_user_status_idx').on(table.userId, table.status),
    check('withdrawal_amount_positive', sql`${table.amount} > 0`),
  ],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  ],
)
