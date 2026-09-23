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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { hasSufficientHotGas, scannerBlockRanges } from '#/domain/chain-worker'
import {
  chainWatcherState,
  controlledWalletTransfers,
  custodySettings,
  deposits,
  platformWallets,
  platformWalletTransactions,
  walletAddresses,
  walletSweeps,
  treasuryTransfers,
  withdrawals,
} from '#/db/schema'
import {
  advanceTreasuryStatus,
  confirmDeposit,
  failBroadcastTreasuryTransfer,
  settleBroadcastWithdrawal,
} from './custody.service'
import { settleControlledWalletTransfer } from './controlled-wallet-transfer.service'
import { RpcPool } from './rpc-pool'
import {
  getSignerPlatformWallets,
  requestTreasuryBroadcast,
  requestControlledWalletTransferBroadcast,
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

async function chunkedLogs(input: {
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
  const groups = await mapConcurrent(ranges, input.concurrency, (range) =>
    retry(() =>
      input.rpcPool.run(({ provider }) =>
        provider.getLogs({
          ...input.filter,
          fromBlock: range.fromBlock,
          toBlock: range.toBlock,
        }),
      ),
    ),
  )
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

async function nativeTransfers(
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
        return rpcPool.run(async ({ url }) => {
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
            throw new Error('RPC provider does not support batched native scans')
          const failure = payload.find((item) => item.error)
          if (failure?.error) {
            const cause = new Error(
              failure.error.message || 'Native transaction scan failed',
            ) as Error & { code?: number }
            cause.code = failure.error.code
            throw cause
          }
          return payload.flatMap((item) => (item.result ? [item.result] : []))
        })
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

export async function runChainWorker() {
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
  const network = await rpcPool.run(({ provider }) => provider.getNetwork())
  if (Number(network.chainId) !== settings.chainId)
    throw new Error('RPC chain ID does not match custody settings')
  const head = await rpcPool.run(({ provider }) => provider.getBlockNumber())
  const finalized = await finalizedBlock(rpcPool, head)
  const configuredStart = Number(process.env.BSC_START_BLOCK || 0)
  const configuredScanBlocks = Number(process.env.BSC_SCAN_BLOCKS || 50)
  const scanBlocks = Number.isSafeInteger(configuredScanBlocks)
    ? Math.min(1_000, Math.max(1, configuredScanBlocks))
    : 50
  const configuredLogChunkBlocks = Number(
    process.env.BSC_LOG_CHUNK_BLOCKS || 10,
  )
  const logChunkBlocks = Number.isSafeInteger(configuredLogChunkBlocks)
    ? Math.min(100, Math.max(1, configuredLogChunkBlocks))
    : 10
  const configuredRpcConcurrency = Number(process.env.BSC_RPC_CONCURRENCY || 4)
  const rpcConcurrency = Number.isSafeInteger(configuredRpcConcurrency)
    ? Math.min(10, Math.max(1, configuredRpcConcurrency))
    : 4
  const configuredAddressBatch = Number(process.env.BSC_ADDRESS_BATCH_SIZE || 1)
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
  const toBlock = Math.min(head, fromBlock + scanBlocks - 1)
  const addressRows = await db
    .select()
    .from(walletAddresses)
    .where(eq(walletAddresses.status, 'ACTIVE'))
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
  let credited = 0

  const signerWallets = await getSignerPlatformWallets()
  const signerWalletDefinitions = [
    {
      role: 'HOT_WITHDRAWAL' as const,
      address: getAddress(signerWallets.hot.address),
      derivationPath: signerWallets.hot.derivationPath,
    },
    {
      role: 'SWEEP_GAS' as const,
      address: getAddress(signerWallets.gas.address),
      derivationPath: signerWallets.gas.derivationPath,
    },
  ]
  for (const definition of signerWalletDefinitions) {
    await db
      .insert(platformWallets)
      .values(definition)
      .onConflictDoUpdate({
        target: platformWallets.role,
        set: {
          address: definition.address,
          derivationPath: definition.derivationPath,
          updatedAt: new Date(),
        },
      })
  }
  let managedWalletRows = await db.select().from(platformWallets)
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
  managedWalletRows = await db.select().from(platformWallets)

  // Receipt settlement is intentionally independent from historical scanning.
  // A provider backlog must never prevent the platform from recognizing a
  // confirmed or reverted transaction that it already broadcast.
  const droppedBefore = Date.now() - 2 * 60_000
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
    const receipt = await transactionReceipt(transfer.txHash)
    if (receipt?.status === 1)
      await advanceTreasuryStatus(
        transfer.id,
        'BROADCAST',
        'CONFIRMED',
        undefined,
      )
    else if (receipt?.status === 0)
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
      await settleControlledWalletTransfer(transfer.id, receipt.status === 1)
    else if (
      transfer.broadcastAt &&
      transfer.broadcastAt.getTime() < droppedBefore &&
      !(await transactionByHash(transfer.txHash))
    )
      await requestSignedTransactionRebroadcast('CONTROLLED', transfer.id)
  }

  const [
    knownSweeps,
    knownWithdrawals,
    knownTreasury,
    knownControlledTransfers,
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
  let platformTransactions = 0

  if (fromBlock <= toBlock) {
    for (const wallet of managedWalletRows) {
      for (const direction of ['INCOMING', 'OUTGOING'] as const) {
        const walletTopic = zeroPadValue(getAddress(wallet.address), 32)
        const logs = await chunkedLogs({
          rpcPool,
          filter: {
            address: settings.tokenContractAddress,
            topics:
              direction === 'INCOMING'
                ? [TRANSFER_TOPIC, null, walletTopic]
                : [TRANSFER_TOPIC, walletTopic],
          },
          fromBlock,
          toBlock,
          chunkBlocks: logChunkBlocks,
          concurrency: rpcConcurrency,
        })
        for (const log of logs) {
          const parsed = tokenInterface.parseLog(log)
          if (!parsed) continue
          const txHash = log.transactionHash.toLowerCase()
          const knownSweep = sweepByHash.get(txHash)
          const knownWithdrawal = withdrawalByHash.get(txHash)
          const knownTransfer = treasuryByHash.get(txHash)
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
                : {
                    classification:
                      direction === 'INCOMING' && wallet.role === 'SWEEP_GAS'
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
              amount: formatUnits(parsed.args.value as bigint, decimals),
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
        }
      }
    }

    {
      const nativeBlocks = await nativeTransfers(
        rpcPool,
        fromBlock,
        toBlock,
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
          ].filter((item): item is NonNullable<typeof item> => Boolean(item))) {
            const knownGasSweep = knownSweeps.find(
              (sweep) =>
                sweep.gasTxHash?.toLowerCase() ===
                transaction.hash.toLowerCase(),
            )
            const knownControlledTransfer = controlledTransferByHash.get(
              transaction.hash.toLowerCase(),
            )
            const classification = knownGasSweep
              ? 'SWEEP_GAS'
              : knownControlledTransfer
                ? 'CONTROLLED_WALLET_TRANSFER'
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
                    : null,
                relatedId:
                  knownGasSweep?.id ?? knownControlledTransfer?.id ?? null,
              })
              .onConflictDoNothing()
              .returning({ id: platformWalletTransactions.id })
              .then((rows) => rows.at(0))
            if (inserted) platformTransactions += 1
          }
        }
      }
    }
  }

  const gasWalletRow = managedWalletRows.find(
    (wallet) => wallet.role === 'SWEEP_GAS',
  )
  const recordedGasSweepIds = new Set(
    recordedGasSweeps.flatMap((row) => (row.relatedId ? [row.relatedId] : [])),
  )
  if (gasWalletRow) {
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
        chunkBlocks: logChunkBlocks,
        concurrency: rpcConcurrency,
      })
      for (const log of logs) {
        const parsed = tokenInterface.parseLog(log)
        if (!parsed) continue
        const recipient = String(parsed.args.to).toLowerCase()
        const walletAddress = addressMap.get(recipient)
        if (!walletAddress) continue
        const amount = formatUnits(parsed.args.value as bigint, decimals)
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
            status: 'PENDING',
          })
          .onConflictDoNothing()
          .returning({ id: deposits.id })
          .then((rows) => rows.at(0))
        if (inserted) {
          await confirmDeposit(inserted.id)
          credited += 1
        }
        await db
          .update(walletAddresses)
          .set({ lastSeenAt: new Date(), updatedAt: new Date() })
          .where(eq(walletAddresses.id, walletAddress.id))
      }
    }
  }

  const staleBefore = Date.now() - 60_000
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
          eq(walletAddresses.status, 'ACTIVE'),
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
    .select({ id: withdrawals.id })
    .from(withdrawals)
    .where(eq(withdrawals.status, 'APPROVED'))
  const minimumHotGasForTokenTransfer = process.env.MIN_HOT_GAS_BNB ?? '0.00002'
  const hotWalletBeforeTransfers = managedWalletRows.find(
    (wallet) => wallet.role === 'HOT_WITHDRAWAL',
  )
  const hotWalletHasGasBeforeTransfers = hasSufficientHotGas(
    hotWalletBeforeTransfers?.nativeBalance ?? '0',
    minimumHotGasForTokenTransfer,
  )
  for (const withdrawal of approvedWithdrawals) {
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

  const broadcastWithdrawals = await db
    .select({ id: withdrawals.id, txHash: withdrawals.txHash })
    .from(withdrawals)
    .where(eq(withdrawals.status, 'BROADCAST'))
  for (const withdrawal of broadcastWithdrawals) {
    if (!withdrawal.txHash) continue
    const receipt = await transactionReceipt(withdrawal.txHash)
    if (receipt)
      await settleBroadcastWithdrawal(withdrawal.id, receipt.status === 1)
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
  const broadcastTreasury = await db
    .select({ id: treasuryTransfers.id, txHash: treasuryTransfers.txHash })
    .from(treasuryTransfers)
    .where(eq(treasuryTransfers.status, 'BROADCAST'))
  for (const transfer of broadcastTreasury) {
    if (!transfer.txHash) continue
    const receipt = await transactionReceipt(transfer.txHash)
    if (receipt?.status === 1)
      await advanceTreasuryStatus(
        transfer.id,
        'BROADCAST',
        'CONFIRMED',
        undefined,
      )
    else if (receipt?.status === 0)
      await failBroadcastTreasuryTransfer(transfer.id)
  }

  const broadcastControlledTransfers = await db
    .select({
      id: controlledWalletTransfers.id,
      txHash: controlledWalletTransfers.txHash,
    })
    .from(controlledWalletTransfers)
    .where(eq(controlledWalletTransfers.status, 'BROADCAST'))
  for (const transfer of broadcastControlledTransfers) {
    if (!transfer.txHash) continue
    const receipt = await transactionReceipt(transfer.txHash)
    if (receipt)
      await settleControlledWalletTransfer(transfer.id, receipt.status === 1)
  }

  const rpcSnapshot = rpcPool.snapshot()
  const rpcFailoverCount =
    (state?.rpcFailoverCount ?? 0) + rpcSnapshot.failovers
  await db
    .insert(chainWatcherState)
    .values({
      id: 1,
      chainId: settings.chainId,
      lastScannedBlock: toBlock,
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
        lastScannedBlock: toBlock,
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
    activeRpc: rpcSnapshot.activeIndex + 1,
    rpcEndpoints: rpcSnapshot.endpointCount,
    rpcFailovers: rpcSnapshot.failovers,
  }
}
