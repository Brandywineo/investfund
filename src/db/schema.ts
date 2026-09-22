import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  bigint,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  serial,
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
  'APPROVED',
  'PROCESSING',
  'BROADCAST',
  'CONFIRMED',
  'BROKER_CREDITED',
  'FAILED',
  'RECONCILED',
])
export const withdrawalStatus = pgEnum('withdrawal_status', [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'BROADCAST',
  'CONFIRMED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
])
export const walletAddressStatus = pgEnum('wallet_address_status', [
  'ACTIVE',
  'ROTATED',
  'PAUSED',
])
export const sweepStatus = pgEnum('sweep_status', [
  'WAITING_FINALITY',
  'BELOW_THRESHOLD',
  'READY',
  'GAS_BROADCAST',
  'SWEEP_BROADCAST',
  'SWEPT',
  'FAILED',
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
  confirmationThreshold: integer('confirmation_threshold').default(1).notNull(),
  reserveFixed: numeric('reserve_fixed', { precision: 20, scale: 8 })
    .default('0')
    .notNull(),
  reservePercent: numeric('reserve_percent', { precision: 9, scale: 6 })
    .default('0')
    .notNull(),
  chainId: integer('chain_id').default(56).notNull(),
  tokenContractAddress: text('token_contract_address'),
  autoSweepEnabled: boolean('auto_sweep_enabled').default(true).notNull(),
  minimumSweepAmount: numeric('minimum_sweep_amount', {
    precision: 20,
    scale: 8,
  })
    .default('10')
    .notNull(),
  minimumWithdrawalAmount: numeric('minimum_withdrawal_amount', {
    precision: 20,
    scale: 8,
  })
    .default('50')
    .notNull(),
  ...timestamps,
})

export const walletAddresses = pgTable(
  'wallet_addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    derivationIndex: serial('derivation_index').notNull(),
    address: text('address').notNull(),
    network: text('network').default('BEP20').notNull(),
    status: walletAddressStatus('status').default('ACTIVE').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSweptAt: timestamp('last_swept_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('wallet_addresses_address_unique').on(
      sql`lower(${table.address})`,
    ),
    uniqueIndex('wallet_addresses_derivation_index_unique').on(
      table.derivationIndex,
    ),
    uniqueIndex('wallet_addresses_active_user_unique')
      .on(table.userId)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
)

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
    walletAddressId: uuid('wallet_address_id').references(
      () => walletAddresses.id,
      { onDelete: 'restrict' },
    ),
    chainId: integer('chain_id'),
    tokenContractAddress: text('token_contract_address'),
    senderAddress: text('sender_address'),
    blockNumber: bigint('block_number', { mode: 'number' }),
    blockHash: text('block_hash'),
    logIndex: integer('log_index'),
    confirmations: integer('confirmations').default(0).notNull(),
    chainFinalizedAt: timestamp('chain_finalized_at', { withTimezone: true }),
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
    uniqueIndex('deposits_chain_event_unique').on(
      table.chainId,
      table.tokenContractAddress,
      table.txHash,
      table.logIndex,
    ),
    index('deposits_user_status_idx').on(table.userId, table.status),
    check('deposit_amount_positive', sql`${table.amount} > 0`),
  ],
)

export const walletSweeps = pgTable(
  'wallet_sweeps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddressId: uuid('wallet_address_id')
      .references(() => walletAddresses.id, { onDelete: 'restrict' })
      .notNull(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    status: sweepStatus('status').default('WAITING_FINALITY').notNull(),
    gasTxHash: text('gas_tx_hash'),
    sweepTxHash: text('sweep_tx_hash'),
    failureReason: text('failure_reason'),
    requestedBy: uuid('requested_by').references(() => users.id),
    broadcastAt: timestamp('broadcast_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('wallet_sweeps_status_idx').on(table.status),
    uniqueIndex('wallet_sweeps_active_address_unique')
      .on(table.walletAddressId)
      .where(
        sql`${table.status} in ('READY', 'GAS_BROADCAST', 'SWEEP_BROADCAST')`,
      ),
    uniqueIndex('wallet_sweeps_tx_hash_unique').on(table.sweepTxHash),
    check('wallet_sweep_amount_positive', sql`${table.amount} > 0`),
  ],
)

export const chainWatcherState = pgTable('chain_watcher_state', {
  id: integer('id').primaryKey().default(1),
  chainId: integer('chain_id').notNull(),
  lastScannedBlock: bigint('last_scanned_block', { mode: 'number' }).notNull(),
  lastHeadBlock: bigint('last_head_block', { mode: 'number' }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...timestamps,
})

export const treasuryTransfers = pgTable(
  'treasury_transfers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    destination: text('destination').notNull(),
    direction: text('direction').default('OUTBOUND').notNull(),
    reason: text('reason').default('Legacy treasury transfer').notNull(),
    status: treasuryTransferStatus('status').default('DRAFTED').notNull(),
    txHash: text('tx_hash'),
    signedTransaction: text('signed_transaction'),
    chainNonce: integer('chain_nonce'),
    brokerReference: text('broker_reference'),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    broadcastAt: timestamp('broadcast_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
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
    signedTransaction: text('signed_transaction'),
    chainNonce: integer('chain_nonce'),
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
