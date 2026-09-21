import {
  Contract,
  Interface,
  JsonRpcProvider,
  formatUnits,
  getAddress,
  id,
  isAddress,
  zeroPadValue,
} from 'ethers'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import {
  chainWatcherState,
  custodySettings,
  deposits,
  walletAddresses,
  walletSweeps,
  withdrawals,
} from '#/db/schema'
import {
  broadcastWithdrawal,
  confirmDeposit,
  settleBroadcastWithdrawal,
} from './custody.service'
import { requestWalletSweep, requestWithdrawalBroadcast } from './signer-api'

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)')
const TOKEN_ABI = [
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'function decimals() view returns (uint8)',
]
const tokenInterface = new Interface(TOKEN_ABI)

function chunks<T>(values: Array<T>, size: number) {
  const output: Array<Array<T>> = []
  for (let index = 0; index < values.length; index += size)
    output.push(values.slice(index, index + size))
  return output
}

async function finalizedBlock(provider: JsonRpcProvider, head: number) {
  try {
    const block = (await provider.send('eth_getBlockByNumber', [
      'finalized',
      false,
    ])) as { number?: string } | null
    if (block?.number) return Number(BigInt(block.number))
  } catch {
    // Providers without the finalized tag fall back to two-block finality.
  }
  return Math.max(0, head - 2)
}

export async function runChainWorker() {
  const rpcUrl = process.env.BSC_RPC_URL
  if (!rpcUrl) throw new Error('BSC_RPC_URL is required')
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

  const provider = new JsonRpcProvider(rpcUrl, settings.chainId, {
    staticNetwork: true,
  })
  const network = await provider.getNetwork()
  if (Number(network.chainId) !== settings.chainId)
    throw new Error('RPC chain ID does not match custody settings')
  const head = await provider.getBlockNumber()
  const finalized = await finalizedBlock(provider, head)
  const state = await db
    .select()
    .from(chainWatcherState)
    .where(eq(chainWatcherState.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  const configuredStart = Number(process.env.BSC_START_BLOCK || 0)
  const configuredScanBlocks = Number(process.env.BSC_SCAN_BLOCKS || 50)
  const scanBlocks = Number.isSafeInteger(configuredScanBlocks)
    ? Math.min(500, Math.max(1, configuredScanBlocks))
    : 50
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
  const token = new Contract(settings.tokenContractAddress, TOKEN_ABI, provider)
  const decimals = Number(await token.decimals())
  let credited = 0

  if (fromBlock <= toBlock && addressRows.length > 0) {
    // Some public BSC nodes reject OR filters containing multiple recipient
    // topics. Query one address at a time by default; private RPCs can opt in
    // to larger batches.
    for (const addressChunk of chunks(addressRows, addressBatchSize)) {
      const recipientTopics = addressChunk.map((row) =>
        zeroPadValue(getAddress(row.address), 32),
      )
      const logs = await provider.getLogs({
        address: settings.tokenContractAddress,
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, null, recipientTopics],
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
    const receipt = await provider.getTransactionReceipt(sweep.sweepTxHash)
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
    .select({
      id: withdrawals.id,
      txHash: withdrawals.txHash,
      reviewedBy: withdrawals.reviewedBy,
    })
    .from(withdrawals)
    .where(eq(withdrawals.status, 'PROCESSING'))
  for (const withdrawal of interruptedWithdrawals) {
    if (withdrawal.txHash && withdrawal.reviewedBy) {
      await broadcastWithdrawal(
        withdrawal.id,
        withdrawal.txHash,
        withdrawal.reviewedBy,
      )
    }
  }
  const approvedWithdrawals = await db
    .select({ id: withdrawals.id })
    .from(withdrawals)
    .where(eq(withdrawals.status, 'APPROVED'))
  for (const withdrawal of approvedWithdrawals) {
    await requestWithdrawalBroadcast(withdrawal.id)
    withdrawalsBroadcast += 1
  }

  const broadcastWithdrawals = await db
    .select({ id: withdrawals.id, txHash: withdrawals.txHash })
    .from(withdrawals)
    .where(eq(withdrawals.status, 'BROADCAST'))
  for (const withdrawal of broadcastWithdrawals) {
    if (!withdrawal.txHash) continue
    const receipt = await provider.getTransactionReceipt(withdrawal.txHash)
    if (receipt)
      await settleBroadcastWithdrawal(withdrawal.id, receipt.status === 1)
  }

  await db
    .insert(chainWatcherState)
    .values({
      id: 1,
      chainId: settings.chainId,
      lastScannedBlock: toBlock,
      lastHeadBlock: head,
      lastRunAt: new Date(),
      lastError: null,
    })
    .onConflictDoUpdate({
      target: chainWatcherState.id,
      set: {
        lastScannedBlock: toBlock,
        lastHeadBlock: head,
        lastRunAt: new Date(),
        lastError: null,
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
  }
}
