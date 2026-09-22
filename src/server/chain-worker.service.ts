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
import {
  getSignerPlatformWallets,
  requestTreasuryBroadcast,
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

function chunks<T>(values: Array<T>, size: number) {
  const output: Array<Array<T>> = []
  for (let index = 0; index < values.length; index += size)
    output.push(values.slice(index, index + size))
  return output
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
  rpcUrl: string,
  fromBlock: number,
  toBlock: number,
) {
  const blocks: Array<RpcBlock> = []
  const blockNumbers = Array.from(
    { length: toBlock - fromBlock + 1 },
    (_, index) => fromBlock + index,
  )
  for (const batch of chunks(blockNumbers, 10)) {
    const response = await fetch(rpcUrl, {
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
    if (!response.ok)
      throw new Error(
        `Native transaction scan returned HTTP ${response.status}`,
      )
    const payload = (await response.json()) as Array<{
      result?: RpcBlock
      error?: { message?: string }
    }>
    if (!Array.isArray(payload))
      throw new Error('RPC provider does not support batched native scans')
    const failure = payload.find((item) => item.error)
    if (failure?.error)
      throw new Error(failure.error.message || 'Native transaction scan failed')
    blocks.push(
      ...payload.flatMap((item) => (item.result ? [item.result] : [])),
    )
  }
  return blocks
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
  const managedWalletRows = await db.select().from(platformWallets)
  await Promise.all(
    managedWalletRows.map(async (wallet) => {
      const [tokenBalance, nativeBalance] = await Promise.all([
        token.balanceOf(wallet.address) as Promise<bigint>,
        provider.getBalance(wallet.address),
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

  const [knownSweeps, knownWithdrawals, knownTreasury, recordedGasSweeps] =
    await Promise.all([
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
  let platformTransactions = 0

  if (fromBlock <= toBlock) {
    for (const wallet of managedWalletRows) {
      for (const direction of ['INCOMING', 'OUTGOING'] as const) {
        const walletTopic = zeroPadValue(getAddress(wallet.address), 32)
        const logs = await provider.getLogs({
          address: settings.tokenContractAddress,
          fromBlock,
          toBlock,
          topics:
            direction === 'INCOMING'
              ? [TRANSFER_TOPIC, null, walletTopic]
              : [TRANSFER_TOPIC, walletTopic],
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

    try {
      const nativeBlocks = await nativeTransfers(rpcUrl, fromBlock, toBlock)
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
            const classification = knownGasSweep
              ? 'SWEEP_GAS'
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
                relatedType: knownGasSweep ? 'wallet_sweep' : null,
                relatedId: knownGasSweep?.id ?? null,
              })
              .onConflictDoNothing()
              .returning({ id: platformWalletTransactions.id })
              .then((rows) => rows.at(0))
            if (inserted) platformTransactions += 1
          }
        }
      }
    } catch (cause) {
      console.error('Native BNB transaction scan skipped', cause)
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
      const transaction = await provider
        .getTransaction(sweep.gasTxHash!)
        .catch(() => null)
      if (!transaction || transaction.value <= 0n || !transaction.to) continue
      const receipt = await provider
        .getTransactionReceipt(sweep.gasTxHash!)
        .catch(() => null)
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
      const logs = await provider.getLogs({
        address: settings.tokenContractAddress,
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, null, recipientFilter],
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
            token.balanceOf(addressRow.address) as Promise<bigint>,
            provider.getBalance(addressRow.address),
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
  for (const withdrawal of approvedWithdrawals) {
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
    const receipt = await provider.getTransactionReceipt(withdrawal.txHash)
    if (receipt)
      await settleBroadcastWithdrawal(withdrawal.id, receipt.status === 1)
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
  for (const transfer of approvedTreasury) {
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
    const receipt = await provider.getTransactionReceipt(transfer.txHash)
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
    treasuryBroadcast,
    platformTransactions,
  }
}
