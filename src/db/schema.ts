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

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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

export const accrualRates = pgTable(
  'accrual_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dailyRatePercent: numeric('daily_rate_percent', { precision: 9, scale: 6 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    credit: numeric('credit', { precision: 20, scale: 8 }).default('0').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    compoundedBalance: numeric('compounded_balance', { precision: 20, scale: 8 }).notNull(),
    status: investmentStatus('status').default('ACTIVE').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
    lastAccruedOn: timestamp('last_accrued_on', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('investments_user_status_idx').on(table.userId, table.status),
    check('investment_principal_positive', sql`${table.principal} > 0`),
    check('investment_balance_non_negative', sql`${table.compoundedBalance} >= 0`),
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
    openingBalance: numeric('opening_balance', { precision: 20, scale: 8 }).notNull(),
    ratePercent: numeric('rate_percent', { precision: 9, scale: 6 }).notNull(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    closingBalance: numeric('closing_balance', { precision: 20, scale: 8 }).notNull(),
    ledgerTransactionId: uuid('ledger_transaction_id')
      .references(() => ledgerTransactions.id, { onDelete: 'restrict' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('daily_accrual_investment_date_unique').on(
      table.investmentId,
      table.accrualDate,
    ),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audit_logs_entity_idx').on(table.entityType, table.entityId)],
)
