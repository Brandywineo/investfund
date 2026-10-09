import {
  Contract,
  Interface,
  formatUnits,
  getAddress,
  id,
  isAddress,
  zeroPadValue,
} from 'ethers'
import type { Filter, Log } from 'ethers'
import { and, eq, inArray, isNull, sql, lte } from 'drizzle-orm'
import { getDb, getPool } from '#/db'
import { hasSufficientHotGas, scannerBlockRanges } from '#/domain/chain-worker'
import { classifyDepositTransfer } from '#/domain/deposit-transfer'
import {
  chainWatcherState,
  controlledWalletTransfers,
  depositGasRecoveries,
  custodySettings,
  deposits,
  platformWallets,
  platformWalletTransactions,
  walletAddresses,
  walletSets,
  walletSweeps,
  treasuryTransfers,
  treasuryTransactionAttempts,
  withdrawals,
} from '#/db/schema'
import {
  advanceTreasuryStatus,
  confirmDeposit,
  failBroadcastTreasuryTransfer,
  settleBroadcastWithdrawal,
} from './custody.service'
import { settleControlledWalletTransfer } from './controlled-wallet-transfer.service'
import {
  processAdminAlertOutbox,
  queueConfirmedHotWalletAlerts,
} from './admin-alert.service'
import { RpcPool } from './rpc-pool'
import {
  getSignerPlatformWallets,
  requestTreasuryBroadcast,
  requestControlledWalletTransferBroadcast,
  requestDepositGasRecovery,
  requestSignedTransactionRebroadcast,
  requestWalletSweep,
  requestWithdrawalBroadcast,
} from './signer-api'

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)')
const TOKEN_ABI = [
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]
const tokenInterface = new Interface(TOKEN_ABI)
const RPC_COST = {
  getLogs: 60,
  nativeBlockBatch: 100,
} as const

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

function chunks<T>(values: Array<T>, size: number) {
  const output: Array<Array<T>> = []
  for (let index = 0; index < values.length; index += size)
    output.push(values.slice(index, index + size))
  return output
}

async function retry<T>(operation: () => Promise<T>, attempts = 3) {
  let lastCause: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (cause) {
      if (String(cause).includes('LOG_RANGE_LIMIT')) throw cause
      lastCause = cause
      if (attempt < attempts) await wait(250 * 2 ** (attempt - 1))
    }
  }
  throw lastCause
}

async function mapConcurrent<T, TResult>(
  values: Array<T>,
  concurrency: number,
  operation: (value: T) => Promise<TResult>,
) {
  const output = new Array<TResult>(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await operation(values[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  )
  return output
}

export async function chunkedLogs(input: {
  rpcPool: RpcPool
  filter: Filter
  fromBlock: number
  toBlock: number
  chunkBlocks: number
  concurrency: number
}) {
  if (input.fromBlock > input.toBlock) return [] as Array<Log>
  const ranges = scannerBlockRanges(
    input.fromBlock,
    input.toBlock,
    input.chunkBlocks,
  )
  async function query(range: {
    fromBlock: number
    toBlock: number
  }): Promise<Array<Log>> {
    try {
      return await retry(() =>
        input.rpcPool.run(
          async ({ provider }) => {
            try {
              return await provider.getLogs({ ...input.filter, ...range })
            } catch (error) {
              if (
                /block range|too many results|response size|query returned|limited to|maximum.*blocks/i.test(
                  String(error),
                )
              )
                throw new Error('LOG_RANGE_LIMIT', { cause: error })
              throw error
            }
          },
          { cost: RPC_COST.getLogs },
        ),
      )
    } catch (error) {
      if (
        !String(error).includes('LOG_RANGE_LIMIT') ||
        range.fromBlock === range.toBlock
      )
        throw error
      const midpoint = Math.floor((range.fromBlock + range.toBlock) / 2)
      const left = await query({
        fromBlock: range.fromBlock,
        toBlock: midpoint,
      })
      const right = await query({
        fromBlock: midpoint + 1,
        toBlock: range.toBlock,
      })
      return [...left, ...right]
    }
  }
  const groups = await mapConcurrent(ranges, input.concurrency, query)
  return groups.flat()
}

type RpcBlock = {
  number?: string
  transactions?: Array<{
    hash: string
    from: string
    to: string | null
    value: string
  }>
}

export async function nativeTransfers(
  rpcPool: RpcPool,
  fromBlock: number,
  toBlock: number,
  concurrency: number,
) {
  const blockNumbers = Array.from(
    { length: toBlock - fromBlock + 1 },
    (_, index) => fromBlock + index,
  )
  const groups = await mapConcurrent(
    chunks(blockNumbers, 10),
    concurrency,
    (batch) =>
      retry(async () => {
        return rpcPool.run(
          async ({ url }) => {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(
                batch.map((blockNumber, index) => ({
                  jsonrpc: '2.0',
                  id: index + 1,
                  method: 'eth_getBlockByNumber',
                  params: [`0x${blockNumber.toString(16)}`, true],
                })),
              ),
              signal: AbortSignal.timeout(20_000),
            })
            if (!response.ok) {
              const cause = new Error(
                `Native transaction scan returned HTTP ${response.status}`,
              ) as Error & { status: number }
              cause.status = response.status
              throw cause
            }
            const payload = (await response.json()) as Array<{
              result?: RpcBlock
              error?: { code?: number; message?: string }
            }>
            if (!Array.isArray(payload))
              throw new Error(
                'RPC provider does not support batched native scans',
              )
            const failure = payload.find((item) => item.error)
            if (failure?.error) {
              const cause = new Error(
                failure.error.message || 'Native transaction scan failed',
              ) as Error & { code?: number }
              cause.code = failure.error.code
              throw cause
            }
            const blocks = payload.flatMap((item) =>
              item.result ? [item.result] : [],
            )
            const returned = new Set(
              blocks.map((block) =>
                block.number ? Number(BigInt(block.number)) : -1,
              ),
            )
            if (
              blocks.length !== batch.length ||
              returned.size !== batch.length ||
              batch.some((number) => !returned.has(number))
            )
              throw new Error(
                'Native scan returned incomplete blocks; checkpoint retained',
              )
            return blocks
          },
          { cost: RPC_COST.nativeBlockBatch },
        )
      }),
  )
  return groups.flat()
}

async function finalizedBlock(rpcPool: RpcPool, head: number) {
  try {
    const block = await rpcPool.run(
      ({ provider }) =>
        provider.send('eth_getBlockByNumber', ['finalized', false]) as Promise<{
          number?: string
        } | null>,
    )
    if (block?.number) return Number(BigInt(block.number))
  } catch {
    // Providers without the finalized tag fall back to two-block finality.
  }
  return Math.max(0, head - 2)
}

async function runChainWorkerBatch(scanNative = true) {
  const db = getDb()
  const settings = await db
    .select()
    .from(custodySettings)
    .where(eq(custodySettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  if (
    !settings?.tokenContractAddress ||
    !isAddress(settings.tokenContractAddress)
  )
    throw new Error('A valid USDT token contract must be configured')

  const state = await db
    .select()
    .from(chainWatcherState)
    .where(eq(chainWatcherState.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  const rpcPool = new RpcPool({
    chainId: settings.chainId,
    startIndex: state?.activeRpcIndex ?? 0,
  })
  try {
    const network = await rpcPool.run(({ provider }) => provider.getNetwork())
    if (Number(network.chainId) !== settings.chainId)
      throw new Error('RPC chain ID does not match custody settings')
    const head = await rpcPool.run(({ provider }) => provider.getBlockNumber())
    const finalized = Math.min(head, await finalizedBlock(rpcPool, head))
    const configuredStart = Number(process.env.BSC_START_BLOCK || 0)
    const configuredScanBlocks = Number(process.env.BSC_SCAN_BLOCKS || 50)
    const normalScanBlocks = Number.isSafeInteger(configuredScanBlocks)
      ? Math.min(1_000, Math.max(1, configuredScanBlocks))
      : 50
    const configuredLogChunkBlocks = Number(
      process.env.BSC_LOG_CHUNK_BLOCKS || 10,
    )
    const logChunkBlocks = Number.isSafeInteger(configuredLogChunkBlocks)
      ? Math.min(100, Math.max(1, configuredLogChunkBlocks))
      : 10
    const configuredRpcConcurrency = Number(
      process.env.BSC_RPC_CONCURRENCY || 4,
    )
    const rpcConcurrency = Number.isSafeInteger(configuredRpcConcurrency)
      ? Math.min(10, Math.max(1, configuredRpcConcurrency))
      : 4
    const configuredAddressBatch = Number(
      process.env.BSC_ADDRESS_BATCH_SIZE || 1,
    )
    const addressBatchSize = Number.isSafeInteger(configuredAddressBatch)
      ? Math.min(50, Math.max(1, configuredAddressBatch))
      : 1
    const fromBlock = state
      ? state.lastScannedBlock + 1
      : configuredStart > 0
        ? configuredStart
        : Math.max(0, head - 20)
    // Public RPC endpoints commonly impose stricter eth_getLogs limits than
    // dedicated providers. A private provider can opt into a larger window.
    const catchup = finalized - fromBlock > 1_000
    const scanBlocks = catchup
      ? Math.max(1_000, normalScanBlocks)
      : normalScanBlocks
    const toBlock = Math.min(finalized, fromBlock + scanBlocks - 1)
    let nativeCheckpoint =
      state?.lastNativeScannedBlock ?? state?.lastScannedBlock ?? fromBlock - 1
    let nativeError = state?.lastNativeError ?? null
    const addressRows = await db
      .select()
      .from(walletAddresses)
      .where(inArray(walletAddresses.status, ['ACTIVE', 'ROTATED']))
    const addressMap = new Map(
      addressRows.map((row) => [row.address.toLowerCase(), row]),
    )
    const decimals = Number(
      await rpcPool.run(({ provider }) =>
        new Contract(
          settings.tokenContractAddress!,
          TOKEN_ABI,
          provider,
        ).decimals(),
      ),
    )
    const tokenBalanceOf = (address: string) =>
      rpcPool.run(
        ({ provider }) =>
          new Contract(
            settings.tokenContractAddress!,
            TOKEN_ABI,
            provider,
          ).balanceOf(address) as Promise<bigint>,
      )
    const nativeBalanceOf = (address: string) =>
      rpcPool.run(({ provider }) => provider.getBalance(address))
    const transactionReceipt = (txHash: string) =>
      rpcPool.run(({ provider }) => provider.getTransactionReceipt(txHash))
    const transactionByHash = (txHash: string) =>
      rpcPool.run(({ provider }) => provider.getTransaction(txHash))
    const settleTreasuryAttempts = async (
      transferId: string,
      currentTxHash: string,
    ) => {
      const attempts = await db
        .select({
          id: treasuryTransactionAttempts.id,
          txHash: treasuryTransactionAttempts.txHash,
        })
        .from(treasuryTransactionAttempts)
        .where(eq(treasuryTransactionAttempts.treasuryTransferId, transferId))
      const hashes = Array.from(
        new Set([currentTxHash, ...attempts.map((attempt) => attempt.txHash)]),
      )
      for (const txHash of hashes) {
        const receipt = await transactionReceipt(txHash)
        if (receipt?.status !== 1) continue
        await advanceTreasuryStatus(
          transferId,
          'BROADCAST',
          'CONFIRMED',
          undefined,
        )
        await db
          .update(treasuryTransactionAttempts)
          .set({
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(treasuryTransactionAttempts.txHash, txHash))
        return true
      }
      return false
    }
    let credited = 0

    const signerWallets = await getSignerPlatformWallets()
    for (const signerSet of signerWallets.walletSets) {
      const walletSet = await db
        .insert(walletSets)
        .values({
          name:
            signerSet.signerKey === 'primary'
              ? 'Primary Wallet'
              : signerSet.signerKey,
          signerKey: signerSet.signerKey,
          fingerprint: signerSet.fingerprint,
          status: signerSet.signerKey === 'primary' ? 'ACTIVE' : 'READY',
          activatedAt:
            signerSet.signerKey === 'primary' ? new Date() : undefined,
        })
        .onConflictDoUpdate({
          target: walletSets.signerKey,
          set: { fingerprint: signerSet.fingerprint, updatedAt: new Date() },
        })
        .returning({ id: walletSets.id })
        .then((rows) => rows.at(0))
      if (!walletSet) throw new Error('Could not synchronize wallet set')
      const signerWalletDefinitions = [
        {
          walletSetId: walletSet.id,
          role: 'HOT_WITHDRAWAL' as const,
          address: getAddress(signerSet.hot.address),
          derivationPath: signerSet.hot.derivationPath,
        },
        {
          walletSetId: walletSet.id,
          role: 'SWEEP_GAS' as const,
          address: getAddress(signerSet.gas.address),
          derivationPath: signerSet.gas.derivationPath,
        },
      ]
      for (const definition of signerWalletDefinitions) {
        await db
          .insert(platformWallets)
          .values(definition)
          .onConflictDoUpdate({
            target: [platformWallets.walletSetId, platformWallets.role],
            set: {
              address: definition.address,
              derivationPath: definition.derivationPath,
              updatedAt: new Date(),
            },
          })
      }
    }
    let managedWalletRows = await db.select().from(platformWallets)
    const configuredMaintenanceInterval = Number(
      process.env.BSC_MAINTENANCE_INTERVAL_MS || 60_000,
    )
    const maintenanceIntervalMs = Number.isFinite(configuredMaintenanceInterval)
      ? Math.max(10_000, configuredMaintenanceInterval)
      : 60_000
    const maintenanceBefore = Date.now() - maintenanceIntervalMs
    const maintenanceDue = managedWalletRows.some(
      (wallet) =>
        !wallet.balanceCheckedAt ||
        wallet.balanceCheckedAt.getTime() < maintenanceBefore,
    )
    if (maintenanceDue) {
      await Promise.all(
        managedWalletRows.map(async (wallet) => {
          const [tokenBalance, nativeBalance] = await Promise.all([
            tokenBalanceOf(wallet.address),
            nativeBalanceOf(wallet.address),
          ])
          await db
            .update(platformWallets)
            .set({
              tokenBalance: formatUnits(tokenBalance, decimals),
              nativeBalance: formatUnits(nativeBalance, 18),
              balanceCheckedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(platformWallets.id, wallet.id))
        }),
      )
    }
    managedWalletRows = await db.select().from(platformWallets)

    // Receipt settlement is intentionally independent from historical scanning.
    // A provider backlog must never prevent the platform from recognizing a
    // confirmed or reverted transaction that it already broadcast.
    const droppedBefore = Date.now() - 2 * 60_000
    if (maintenanceDue) {
      const earlyBroadcastWithdrawals = await db
        .select({
          id: withdrawals.id,
          txHash: withdrawals.txHash,
          broadcastAt: withdrawals.broadcastAt,
        })
        .from(withdrawals)
        .where(eq(withdrawals.status, 'BROADCAST'))
      for (const withdrawal of earlyBroadcastWithdrawals) {
        if (!withdrawal.txHash) continue
        const receipt = await transactionReceipt(withdrawal.txHash)
        if (receipt)
          await settleBroadcastWithdrawal(withdrawal.id, receipt.status === 1)
        else if (
          withdrawal.broadcastAt &&
          withdrawal.broadcastAt.getTime() < droppedBefore &&
          !(await transactionByHash(withdrawal.txHash))
        )
          await requestSignedTransactionRebroadcast('WITHDRAWAL', withdrawal.id)
      }
      const earlyBroadcastTreasury = await db
        .select({
          id: treasuryTransfers.id,
          txHash: treasuryTransfers.txHash,
          broadcastAt: treasuryTransfers.broadcastAt,
        })
        .from(treasuryTransfers)
        .where(eq(treasuryTransfers.status, 'BROADCAST'))
      for (const transfer of earlyBroadcastTreasury) {
        if (!transfer.txHash) continue
        if (await settleTreasuryAttempts(transfer.id, transfer.txHash)) continue
        const receipt = await transactionReceipt(transfer.txHash)
        if (receipt?.status === 0)
          await failBroadcastTreasuryTransfer(transfer.id)
        else if (
          transfer.broadcastAt &&
          transfer.broadcastAt.getTime() < droppedBefore &&
          !(await transactionByHash(transfer.txHash))
        )
          await requestSignedTransactionRebroadcast('TREASURY', transfer.id)
      }
      const earlyBroadcastControlled = await db
        .select({
          id: controlledWalletTransfers.id,
          txHash: controlledWalletTransfers.txHash,
          broadcastAt: controlledWalletTransfers.broadcastAt,
        })
        .from(controlledWalletTransfers)
        .where(eq(controlledWalletTransfers.status, 'BROADCAST'))
      for (const transfer of earlyBroadcastControlled) {
        if (!transfer.txHash) continue
        const receipt = await transactionReceipt(transfer.txHash)
        if (receipt)
          await settleControlledWalletTransfer(
            transfer.id,
            receipt.status === 1,
          )
        else if (
          transfer.broadcastAt &&
          transfer.broadcastAt.getTime() < droppedBefore &&
          !(await transactionByHash(transfer.txHash))
        )
          await requestSignedTransactionRebroadcast('CONTROLLED', transfer.id)
      }
      const broadcastRecoveries = await db
        .select({
          id: depositGasRecoveries.id,
          txHash: depositGasRecoveries.txHash,
        })
        .from(depositGasRecoveries)
        .where(eq(depositGasRecoveries.status, 'BROADCAST'))
      for (const recovery of broadcastRecoveries) {
        if (!recovery.txHash) continue
        const receipt = await transactionReceipt(recovery.txHash)
        if (!receipt) continue
        await db
          .update(depositGasRecoveries)
          .set({
            status: receipt.status === 1 ? 'CONFIRMED' : 'FAILED',
            confirmedAt: receipt.status === 1 ? new Date() : null,
            failureReason:
              receipt.status === 1 ? null : 'On-chain transaction reverted',
            updatedAt: new Date(),
          })
          .where(eq(depositGasRecoveries.id, recovery.id))
      }
    }

    const [
      knownSweeps,
      knownWithdrawals,
      knownTreasury,
      knownControlledTransfers,
      knownGasRecoveries,
      recordedGasSweeps,
    ] = await Promise.all([
      db
        .select({
          id: walletSweeps.id,
          sweepTxHash: walletSweeps.sweepTxHash,
          gasTxHash: walletSweeps.gasTxHash,
        })
        .from(walletSweeps),
      db
        .select({ id: withdrawals.id, txHash: withdrawals.txHash })
        .from(withdrawals),
      db
        .select({
          id: treasuryTransfers.id,
          txHash: treasuryTransfers.txHash,
          purpose: treasuryTransfers.purpose,
          direction: treasuryTransfers.direction,
        })
        .from(treasuryTransfers),
      db
        .select({
          id: controlledWalletTransfers.id,
          txHash: controlledWalletTransfers.txHash,
        })
        .from(controlledWalletTransfers),
      db
        .select({
          id: depositGasRecoveries.id,
          txHash: depositGasRecoveries.txHash,
        })
        .from(depositGasRecoveries),
      db
        .select({ relatedId: platformWalletTransactions.relatedId })
        .from(platformWalletTransactions)
        .where(
          and(
            eq(platformWalletTransactions.asset, 'BNB'),
            eq(platformWalletTransactions.classification, 'SWEEP_GAS'),
          ),
        ),
    ])
    const sweepByHash = new Map(
      knownSweeps
        .filter((row) => row.sweepTxHash)
        .map((row) => [row.sweepTxHash!.toLowerCase(), row]),
    )
    const withdrawalByHash = new Map(
      knownWithdrawals
        .filter((row) => row.txHash)
        .map((row) => [row.txHash!.toLowerCase(), row]),
    )
    const treasuryByHash = new Map(
      knownTreasury
        .filter((row) => row.txHash)
        .map((row) => [row.txHash!.toLowerCase(), row]),
    )
    const controlledTransferByHash = new Map(
      knownControlledTransfers
        .filter((row) => row.txHash)
        .map((row) => [row.txHash!.toLowerCase(), row]),
    )
    const gasRecoveryByHash = new Map(
      knownGasRecoveries
        .filter((row) => row.txHash)
        .map((row) => [row.txHash!.toLowerCase(), row]),
    )
    let platformTransactions = 0
    let dustIgnored = 0

    if (fromBlock <= toBlock) {
      const platformWalletByAddress = new Map(
        managedWalletRows.map((wallet) => [
          wallet.address.toLowerCase(),
          wallet,
        ]),
      )
      const platformWalletTopics = managedWalletRows.map((wallet) =>
        zeroPadValue(getAddress(wallet.address), 32),
      )
      if (platformWalletTopics.length > 0) {
        for (const direction of ['INCOMING', 'OUTGOING'] as const) {
          const logs = await chunkedLogs({
            rpcPool,
            filter: {
              address: settings.tokenContractAddress,
              topics:
                direction === 'INCOMING'
                  ? [TRANSFER_TOPIC, null, platformWalletTopics]
                  : [TRANSFER_TOPIC, platformWalletTopics],
            },
            fromBlock,
            toBlock,
            chunkBlocks: catchup
              ? Math.max(100, logChunkBlocks)
              : logChunkBlocks,
            concurrency: rpcConcurrency,
          })
          for (const log of logs) {
            const parsed = tokenInterface.parseLog(log)
            if (!parsed) continue
            const rawValue = parsed.args.value as bigint
            if (rawValue <= 0n) continue
            const walletAddress = String(
              direction === 'INCOMING' ? parsed.args.to : parsed.args.from,
            ).toLowerCase()
            const wallet = platformWalletByAddress.get(walletAddress)
            if (!wallet) continue
            const txHash = log.transactionHash.toLowerCase()
            const knownSweep = sweepByHash.get(txHash)
            const knownWithdrawal = withdrawalByHash.get(txHash)
            const knownTransfer = treasuryByHash.get(txHash)
            const knownControlledTransfer = controlledTransferByHash.get(txHash)
            const relation = knownSweep
              ? {
                  classification: 'USER_SWEEP',
                  relatedType: 'wallet_sweep',
                  relatedId: knownSweep.id,
                }
              : knownWithdrawal
                ? {
                    classification: 'USER_WITHDRAWAL',
                    relatedType: 'withdrawal',
                    relatedId: knownWithdrawal.id,
                  }
                : knownTransfer
                  ? {
                      classification:
                        knownTransfer.direction === 'RETURN'
                          ? 'MT5_RETURN'
                          : knownTransfer.purpose,
                      relatedType: 'treasury_transfer',
                      relatedId: knownTransfer.id,
                    }
                  : knownControlledTransfer
                    ? {
                        classification: 'CONTROLLED_WALLET_TRANSFER',
                        relatedType: 'controlled_wallet_transfer',
                        relatedId: knownControlledTransfer.id,
                      }
                    : {
                        classification:
                          direction === 'INCOMING' &&
                          classifyDepositTransfer({
                            rawValue,
                            tokenDecimals: decimals,
                            minimumCreditedAmount:
                              settings.minimumCreditedDepositAmount,
                          }) === 'DUST'
                            ? 'DUST'
                            : direction === 'INCOMING' &&
                                wallet.role === 'SWEEP_GAS'
                              ? 'GAS_TOP_UP'
                              : null,
                        relatedType: null,
                        relatedId: null,
                      }
            const inserted = await db
              .insert(platformWalletTransactions)
              .values({
                platformWalletId: wallet.id,
                eventKey: `${settings.chainId}:${wallet.role}:${txHash}:${log.index}`,
                chainId: settings.chainId,
                txHash: log.transactionHash,
                logIndex: log.index,
                blockNumber: log.blockNumber,
                direction,
                asset: 'USDT',
                amount: formatUnits(rawValue, decimals),
                fromAddress: String(parsed.args.from),
                toAddress: String(parsed.args.to),
                status: log.blockNumber <= finalized ? 'CONFIRMED' : 'PENDING',
                confirmations: head - log.blockNumber + 1,
                ...relation,
              })
              .onConflictDoNothing()
              .returning({ id: platformWalletTransactions.id })
              .then((rows) => rows.at(0))
            if (inserted) platformTransactions += 1
            if (inserted && relation.classification === 'DUST') dustIgnored += 1
          }
        }
      }
    }

    const gasWalletRow = managedWalletRows.find(
      (wallet) => wallet.role === 'SWEEP_GAS',
    )
    const recordedGasSweepIds = new Set(
      recordedGasSweeps.flatMap((row) =>
        row.relatedId ? [row.relatedId] : [],
      ),
    )
    if (gasWalletRow && maintenanceDue) {
      for (const sweep of knownSweeps.filter(
        (row) => row.gasTxHash && !recordedGasSweepIds.has(row.id),
      )) {
        const transaction = await transactionByHash(sweep.gasTxHash!).catch(
          () => null,
        )
        if (!transaction || transaction.value <= 0n || !transaction.to) continue
        const receipt = await transactionReceipt(sweep.gasTxHash!).catch(
          () => null,
        )
        await db
          .insert(platformWalletTransactions)
          .values({
            platformWalletId: gasWalletRow.id,
            eventKey: `${settings.chainId}:SWEEP_GAS:${sweep.gasTxHash!.toLowerCase()}:native`,
            chainId: settings.chainId,
            txHash: sweep.gasTxHash!,
            blockNumber: receipt?.blockNumber,
            direction: 'OUTGOING',
            asset: 'BNB',
            amount: formatUnits(transaction.value, 18),
            fromAddress: transaction.from,
            toAddress: transaction.to,
            status: receipt
              ? receipt.status === 1
                ? 'CONFIRMED'
                : 'FAILED'
              : 'PENDING',
            confirmations: receipt ? head - receipt.blockNumber + 1 : 0,
            classification: 'SWEEP_GAS',
            relatedType: 'wallet_sweep',
            relatedId: sweep.id,
          })
          .onConflictDoNothing()
      }
    }

    await db
      .update(platformWalletTransactions)
      .set({
        status: 'CONFIRMED',
        confirmations: sql`${head} - ${platformWalletTransactions.blockNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformWalletTransactions.chainId, settings.chainId),
          eq(platformWalletTransactions.status, 'PENDING'),
          sql`${platformWalletTransactions.blockNumber} is not null and ${platformWalletTransactions.blockNumber} <= ${finalized}`,
        ),
      )

    try {
      await queueConfirmedHotWalletAlerts()
      await processAdminAlertOutbox(10)
    } catch (cause) {
      console.error(
        'Administrator alert processing failed without interrupting the chain scan',
        cause,
      )
    }

    if (fromBlock <= toBlock && addressRows.length > 0) {
      // Some public BSC nodes reject OR filters containing multiple recipient
      // topics. Query one address at a time by default; private RPCs can opt in
      // to larger batches.
      for (const addressChunk of chunks(addressRows, addressBatchSize)) {
        const recipientTopics = addressChunk.map((row) =>
          zeroPadValue(getAddress(row.address), 32),
        )
        const recipientFilter =
          recipientTopics.length === 1 ? recipientTopics[0] : recipientTopics
        const logs = await chunkedLogs({
          rpcPool,
          filter: {
            address: settings.tokenContractAddress,
            topics: [TRANSFER_TOPIC, null, recipientFilter],
          },
          fromBlock,
          toBlock,
          chunkBlocks: catchup ? Math.max(100, logChunkBlocks) : logChunkBlocks,
          concurrency: rpcConcurrency,
        })
        for (const log of logs) {
          const parsed = tokenInterface.parseLog(log)
          if (!parsed) continue
          const rawValue = parsed.args.value as bigint
          const disposition = classifyDepositTransfer({
            rawValue,
            tokenDecimals: decimals,
            minimumCreditedAmount: settings.minimumCreditedDepositAmount,
          })
          if (disposition === 'ZERO_VALUE') continue
          const recipient = String(parsed.args.to).toLowerCase()
          const walletAddress = addressMap.get(recipient)
          if (!walletAddress) continue
          const amount = formatUnits(rawValue, decimals)
          const inserted = await db
            .insert(deposits)
            .values({
              userId: walletAddress.userId,
              walletAddressId: walletAddress.id,
              amount,
              network: settings.network,
              txHash: log.transactionHash,
              chainId: settings.chainId,
              tokenContractAddress: settings.tokenContractAddress.toLowerCase(),
              senderAddress: String(parsed.args.from),
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              logIndex: log.index,
              confirmations: head - log.blockNumber + 1,
              status: disposition === 'DUST' ? 'IGNORED_DUST' : 'PENDING',
              rejectionReason:
                disposition === 'DUST'
                  ? `Below ${settings.minimumCreditedDepositAmount} USDT credit threshold`
                  : null,
            })
            .onConflictDoNothing()
            .returning({ id: deposits.id })
            .then((rows) => rows.at(0))
          if (disposition === 'CREDIT') {
            const pending =
              inserted ??
              (await db
                .select({ id: deposits.id })
                .from(deposits)
                .where(
                  and(
                    eq(deposits.chainId, settings.chainId),
                    eq(
                      deposits.tokenContractAddress,
                      settings.tokenContractAddress.toLowerCase(),
                    ),
                    eq(deposits.txHash, log.transactionHash),
                    eq(deposits.logIndex, log.index),
                    eq(deposits.status, 'PENDING'),
                  ),
                )
                .limit(1)
                .then((rows) => rows.at(0)))
            if (pending) {
              await confirmDeposit(pending.id)
              credited += 1
            }
          }
          if (inserted && disposition === 'DUST') dustIgnored += 1
          await db
            .update(walletAddresses)
            .set({ lastSeenAt: new Date(), updatedAt: new Date() })
            .where(eq(walletAddresses.id, walletAddress.id))
        }
      }
    }

    // Recover events persisted before a previous credit transaction failed.
    const pendingDeposits = await db
      .select({ id: deposits.id })
      .from(deposits)
      .where(
        and(
          eq(deposits.status, 'PENDING'),
          eq(deposits.source, 'AUTOMATIC'),
          eq(deposits.chainId, settings.chainId),
          eq(
            deposits.tokenContractAddress,
            settings.tokenContractAddress.toLowerCase(),
          ),
          lte(deposits.blockNumber, finalized),
        ),
      )
      .limit(100)
    for (const deposit of pendingDeposits) {
      await confirmDeposit(deposit.id)
      credited += 1
    }

    if (scanNative) {
      try {
        const nativeFromBlock = nativeCheckpoint + 1
        const nativeToBlock = Math.min(
          finalized,
          nativeFromBlock + normalScanBlocks - 1,
        )
        const nativeBlocks = await nativeTransfers(
          rpcPool,
          nativeFromBlock,
          nativeToBlock,
          rpcConcurrency,
        )
        for (const block of nativeBlocks) {
          const blockNumber = block.number ? Number(BigInt(block.number)) : null
          for (const transaction of block.transactions ?? []) {
            if (!transaction.to || BigInt(transaction.value) <= 0n) continue
            const fromWallet = managedWalletRows.find(
              (wallet) =>
                wallet.address.toLowerCase() === transaction.from.toLowerCase(),
            )
            const toWallet = managedWalletRows.find(
              (wallet) =>
                wallet.address.toLowerCase() === transaction.to!.toLowerCase(),
            )
            for (const match of [
              fromWallet
                ? { wallet: fromWallet, direction: 'OUTGOING' as const }
                : null,
              toWallet
                ? { wallet: toWallet, direction: 'INCOMING' as const }
                : null,
            ].filter((item): item is NonNullable<typeof item> =>
              Boolean(item),
            )) {
              const knownGasSweep = knownSweeps.find(
                (sweep) =>
                  sweep.gasTxHash?.toLowerCase() ===
                  transaction.hash.toLowerCase(),
              )
              const knownControlledTransfer = controlledTransferByHash.get(
                transaction.hash.toLowerCase(),
              )
              const knownGasRecovery = gasRecoveryByHash.get(
                transaction.hash.toLowerCase(),
              )
              const classification = knownGasSweep
                ? 'SWEEP_GAS'
                : knownControlledTransfer
                  ? 'CONTROLLED_WALLET_TRANSFER'
                  : knownGasRecovery
                    ? 'DEPOSIT_GAS_RECOVERY'
                    : match.direction === 'INCOMING' &&
                        match.wallet.role === 'SWEEP_GAS'
                      ? 'GAS_TOP_UP'
                      : null
              const inserted = await db
                .insert(platformWalletTransactions)
                .values({
                  platformWalletId: match.wallet.id,
                  eventKey: `${settings.chainId}:${match.wallet.role}:${transaction.hash.toLowerCase()}:native`,
                  chainId: settings.chainId,
                  txHash: transaction.hash,
                  blockNumber,
                  direction: match.direction,
                  asset: 'BNB',
                  amount: formatUnits(BigInt(transaction.value), 18),
                  fromAddress: transaction.from,
                  toAddress: transaction.to,
                  status:
                    blockNumber !== null && blockNumber <= finalized
                      ? 'CONFIRMED'
                      : 'PENDING',
                  confirmations:
                    blockNumber === null ? 0 : head - blockNumber + 1,
                  classification,
                  relatedType: knownGasSweep
                    ? 'wallet_sweep'
                    : knownControlledTransfer
                      ? 'controlled_wallet_transfer'
                      : knownGasRecovery
                        ? 'deposit_gas_recovery'
                        : null,
                  relatedId:
                    knownGasSweep?.id ??
                    knownControlledTransfer?.id ??
                    knownGasRecovery?.id ??
                    null,
                })
                .onConflictDoNothing()
                .returning({ id: platformWalletTransactions.id })
                .then((rows) => rows.at(0))
              if (inserted) platformTransactions += 1
            }
          }
        }
        nativeCheckpoint = Math.max(nativeCheckpoint, nativeToBlock)
        nativeError = null
      } catch {
        nativeError =
          'Native history scan failed; checkpoint retained for retry'
        console.error('Native scan deferred; deposit scan will continue')
      }
    }

    const staleBefore = Date.now() - maintenanceIntervalMs
    const balanceRows = addressRows
      .filter(
        (row) =>
          !row.balanceCheckedAt || row.balanceCheckedAt.getTime() < staleBefore,
      )
      .slice(0, 20)
    for (const addressChunk of chunks(balanceRows, 10)) {
      await Promise.all(
        addressChunk.map(async (addressRow) => {
          try {
            const [tokenBalance, nativeBalance] = await Promise.all([
              tokenBalanceOf(addressRow.address),
              nativeBalanceOf(addressRow.address),
            ])
            await db
              .update(walletAddresses)
              .set({
                tokenBalance: formatUnits(tokenBalance, decimals),
                nativeBalance: formatUnits(nativeBalance, 18),
                balanceCheckedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(walletAddresses.id, addressRow.id))
          } catch (cause) {
            console.error(`Balance check ${addressRow.id} failed`, cause)
          }
        }),
      )
    }

    await db
      .update(deposits)
      .set({
        chainFinalizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deposits.chainId, settings.chainId),
          isNull(deposits.chainFinalizedAt),
          sql`${deposits.blockNumber} <= ${finalized}`,
        ),
      )
    await db
      .update(deposits)
      .set({ confirmations: sql`${head} - ${deposits.blockNumber} + 1` })
      .where(eq(deposits.chainId, settings.chainId))

    let swept = 0
    if (settings.autoSweepEnabled) {
      const readyAddresses = await db
        .selectDistinct({ id: walletAddresses.id })
        .from(walletAddresses)
        .innerJoin(deposits, eq(deposits.walletAddressId, walletAddresses.id))
        .leftJoin(
          walletSweeps,
          and(
            eq(walletSweeps.walletAddressId, walletAddresses.id),
            inArray(walletSweeps.status, [
              'READY',
              'GAS_BROADCAST',
              'SWEEP_BROADCAST',
            ]),
          ),
        )
        .where(
          and(
            inArray(walletAddresses.status, ['ACTIVE', 'ROTATED']),
            eq(deposits.status, 'CONFIRMED'),
            sql`${deposits.chainFinalizedAt} is not null`,
            isNull(walletSweeps.id),
          ),
        )
      for (const address of readyAddresses) {
        try {
          await requestWalletSweep(address.id)
          swept += 1
        } catch {
          // Below-threshold and temporary signer failures are retried next run.
        }
      }
    }

    if (maintenanceDue) {
      const pendingSweeps = await db
        .select()
        .from(walletSweeps)
        .where(eq(walletSweeps.status, 'SWEEP_BROADCAST'))
      for (const sweep of pendingSweeps) {
        if (!sweep.sweepTxHash) continue
        const receipt = await transactionReceipt(sweep.sweepTxHash)
        if (!receipt) continue
        if (receipt.status === 1) {
          await db
            .update(walletSweeps)
            .set({
              status: 'SWEPT',
              confirmedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(walletSweeps.id, sweep.id))
          await db
            .update(walletAddresses)
            .set({ lastSweptAt: new Date(), updatedAt: new Date() })
            .where(eq(walletAddresses.id, sweep.walletAddressId))
        } else {
          await db
            .update(walletSweeps)
            .set({
              status: 'FAILED',
              failureReason: 'Sweep transaction reverted',
              updatedAt: new Date(),
            })
            .where(eq(walletSweeps.id, sweep.id))
        }
      }
    }

    let withdrawalsBroadcast = 0
    const interruptedWithdrawals = await db
      .select({ id: withdrawals.id })
      .from(withdrawals)
      .where(eq(withdrawals.status, 'PROCESSING'))
    for (const withdrawal of interruptedWithdrawals) {
      try {
        await requestWithdrawalBroadcast(withdrawal.id)
      } catch (cause) {
        console.error(`Withdrawal retry ${withdrawal.id} failed`, cause)
      }
    }
    const approvedWithdrawals = await db
      .select({
        id: withdrawals.id,
        sourcePlatformWalletId: withdrawals.sourcePlatformWalletId,
      })
      .from(withdrawals)
      .where(eq(withdrawals.status, 'APPROVED'))
    const minimumHotGasForTokenTransfer =
      process.env.MIN_HOT_GAS_BNB ?? '0.00002'
    for (const withdrawal of approvedWithdrawals) {
      const sourceWallet = managedWalletRows.find(
        (wallet) => wallet.id === withdrawal.sourcePlatformWalletId,
      )
      const hotWalletHasGasBeforeTransfers = hasSufficientHotGas(
        sourceWallet?.nativeBalance ?? '0',
        minimumHotGasForTokenTransfer,
      )
      if (!hotWalletHasGasBeforeTransfers) {
        console.warn(
          `Withdrawal ${withdrawal.id} waiting for confirmed hot-wallet BNB`,
        )
        continue
      }
      try {
        await requestWithdrawalBroadcast(withdrawal.id)
        withdrawalsBroadcast += 1
      } catch (cause) {
        console.error(`Withdrawal ${withdrawal.id} failed`, cause)
      }
    }

    // Platform BNB movements are processed before token transfers. Treasury and
    // user transfers are gated below until the hot wallet has confirmed gas.
    const interruptedControlledTransfers = await db
      .select({ id: controlledWalletTransfers.id })
      .from(controlledWalletTransfers)
      .where(eq(controlledWalletTransfers.status, 'PROCESSING'))
    for (const transfer of interruptedControlledTransfers) {
      try {
        await requestControlledWalletTransferBroadcast(transfer.id)
      } catch (cause) {
        console.error(`Controlled transfer retry ${transfer.id} failed`, cause)
      }
    }
    const approvedControlledTransfers = await db
      .select({ id: controlledWalletTransfers.id })
      .from(controlledWalletTransfers)
      .where(eq(controlledWalletTransfers.status, 'APPROVED'))
    let controlledTransfersBroadcast = 0
    for (const transfer of approvedControlledTransfers) {
      try {
        await requestControlledWalletTransferBroadcast(transfer.id)
        controlledTransfersBroadcast += 1
      } catch (cause) {
        console.error(`Controlled transfer ${transfer.id} failed`, cause)
      }
    }

    const approvedGasRecoveries = await db
      .select({ id: depositGasRecoveries.id })
      .from(depositGasRecoveries)
      .where(inArray(depositGasRecoveries.status, ['APPROVED', 'PROCESSING']))
    for (const recovery of approvedGasRecoveries) {
      try {
        await requestDepositGasRecovery(recovery.id)
      } catch (cause) {
        console.error(`Deposit gas recovery ${recovery.id} failed`, cause)
      }
    }

    const interruptedTreasury = await db
      .select({ id: treasuryTransfers.id })
      .from(treasuryTransfers)
      .where(eq(treasuryTransfers.status, 'PROCESSING'))
    for (const transfer of interruptedTreasury) {
      try {
        await requestTreasuryBroadcast(transfer.id)
      } catch (cause) {
        console.error(`Treasury retry ${transfer.id} failed`, cause)
      }
    }
    const approvedTreasury = await db
      .select({ id: treasuryTransfers.id })
      .from(treasuryTransfers)
      .where(eq(treasuryTransfers.status, 'APPROVED'))
    let treasuryBroadcast = 0
    const hotWallet = managedWalletRows.find(
      (wallet) => wallet.role === 'HOT_WITHDRAWAL',
    )
    const pendingHotFunding = await db
      .select({ id: controlledWalletTransfers.id })
      .from(controlledWalletTransfers)
      .where(
        and(
          eq(controlledWalletTransfers.destinationRole, 'HOT_WITHDRAWAL'),
          inArray(controlledWalletTransfers.status, [
            'APPROVED',
            'PROCESSING',
            'BROADCAST',
          ]),
        ),
      )
      .limit(1)
      .then((rows) => rows.at(0))
    const hotWalletHasGas = hasSufficientHotGas(
      hotWallet?.nativeBalance ?? '0',
      minimumHotGasForTokenTransfer,
    )
    for (const transfer of approvedTreasury) {
      if (!hotWalletHasGas || pendingHotFunding) {
        console.warn(
          `Treasury transfer ${transfer.id} waiting for confirmed hot-wallet BNB`,
        )
        continue
      }
      try {
        await requestTreasuryBroadcast(transfer.id)
        treasuryBroadcast += 1
      } catch (cause) {
        console.error(`Treasury transfer ${transfer.id} failed`, cause)
      }
    }
    const rpcSnapshot = rpcPool.snapshot()
    const rpcFailoverCount =
      (state?.rpcFailoverCount ?? 0) + rpcSnapshot.failovers
    await db
      .insert(chainWatcherState)
      .values({
        id: 1,
        chainId: settings.chainId,
        lastScannedBlock: Math.max(state?.lastScannedBlock ?? 0, toBlock),
        lastNativeScannedBlock: nativeCheckpoint,
        lastNativeError: nativeError,
        lastHeadBlock: head,
        lastRunAt: new Date(),
        lastError: null,
        activeRpcIndex: rpcSnapshot.activeIndex,
        rpcFailoverCount,
        lastRpcFailoverAt:
          rpcSnapshot.lastFailoverAt ?? state?.lastRpcFailoverAt ?? null,
      })
      .onConflictDoUpdate({
        target: chainWatcherState.id,
        set: {
          lastScannedBlock: Math.max(state?.lastScannedBlock ?? 0, toBlock),
          lastNativeScannedBlock: nativeCheckpoint,
          lastNativeError: nativeError,
          lastHeadBlock: head,
          lastRunAt: new Date(),
          lastError: null,
          activeRpcIndex: rpcSnapshot.activeIndex,
          rpcFailoverCount,
          lastRpcFailoverAt:
            rpcSnapshot.lastFailoverAt ?? state?.lastRpcFailoverAt ?? null,
          updatedAt: new Date(),
        },
      })
    return {
      fromBlock,
      toBlock,
      head,
      finalized,
      credited,
      swept,
      withdrawalsBroadcast,
      treasuryBroadcast,
      controlledTransfersBroadcast,
      platformTransactions,
      dustIgnored,
      activeRpc: rpcSnapshot.activeIndex + 1,
      rpcEndpoints: rpcSnapshot.endpointCount,
      rpcFailovers: rpcSnapshot.failovers,
    }
  } finally {
    rpcPool.destroy()
  }
}

async function runChainWorkerLocked() {
  const configuredMaxBatches = Number(process.env.BSC_CATCHUP_MAX_BATCHES || 10)
  const maxBatches = Number.isSafeInteger(configuredMaxBatches)
    ? Math.min(50, Math.max(1, configuredMaxBatches))
    : 10
  const configuredMaxRuntimeMs = Number(
    process.env.BSC_CATCHUP_MAX_RUNTIME_MS || 240_000,
  )
  const maxRuntimeMs = Number.isFinite(configuredMaxRuntimeMs)
    ? Math.min(5 * 60_000, Math.max(5_000, configuredMaxRuntimeMs))
    : 240_000
  const startedAt = Date.now()
  let firstBatch: Awaited<ReturnType<typeof runChainWorkerBatch>> | null = null
  let lastBatch: Awaited<ReturnType<typeof runChainWorkerBatch>> | null = null
  let batches = 0
  let credited = 0
  let swept = 0
  let withdrawalsBroadcast = 0
  let treasuryBroadcast = 0
  let controlledTransfersBroadcast = 0
  let platformTransactions = 0
  let dustIgnored = 0
  let rpcFailovers = 0

  while (batches < maxBatches && Date.now() - startedAt < maxRuntimeMs) {
    const batch = await runChainWorkerBatch(batches === 0)
    firstBatch ??= batch
    lastBatch = batch
    batches += 1
    credited += batch.credited
    swept += batch.swept
    withdrawalsBroadcast += batch.withdrawalsBroadcast
    treasuryBroadcast += batch.treasuryBroadcast
    controlledTransfersBroadcast += batch.controlledTransfersBroadcast
    platformTransactions += batch.platformTransactions
    dustIgnored += batch.dustIgnored
    rpcFailovers += batch.rpcFailovers
    if (batch.toBlock >= batch.finalized) break
  }

  if (!firstBatch || !lastBatch)
    throw new Error('Chain worker did not complete a scanner batch')

  return {
    ...lastBatch,
    fromBlock: firstBatch.fromBlock,
    batches,
    credited,
    swept,
    withdrawalsBroadcast,
    treasuryBroadcast,
    controlledTransfersBroadcast,
    platformTransactions,
    dustIgnored,
    rpcFailovers,
    runtimeMs: Date.now() - startedAt,
  }
}

export async function runChainWorker() {
  const connection = await getPool().connect()
  let locked = false
  try {
    const result = await connection.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(569001) AS acquired',
    )
    locked = result.rows[0]?.acquired === true
    if (!locked) throw new Error('Another chain scanner is already running')
    return await runChainWorkerLocked()
  } finally {
    try {
      if (locked) await connection.query('SELECT pg_advisory_unlock(569001)')
    } finally {
      connection.release()
    }
  }
}
