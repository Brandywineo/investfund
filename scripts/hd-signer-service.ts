import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import {
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Transaction,
  formatUnits,
  isAddress,
  keccak256,
  parseUnits,
} from 'ethers'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../src/db'
import {
  custodySettings,
  controlledWalletTransfers,
  walletAddresses,
  walletSweeps,
  treasuryTransfers,
  treasuryTransactionAttempts,
  withdrawals,
} from '../src/db/schema'
import type { EncryptedMnemonic } from '../src/server/hd-wallet-crypto'
import { decryptMnemonic } from '../src/server/hd-wallet-crypto'
import {
  broadcastTreasuryTransfer,
  broadcastWithdrawal,
} from '../src/server/custody.service'
import { markControlledWalletTransferBroadcast } from '../src/server/controlled-wallet-transfer.service'
import { validateWalletTransferRoute } from '../src/domain/wallet-transfer'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address,uint256) returns (bool)',
]

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const walletFile = required('HD_WALLET_FILE')
const password = required('HD_WALLET_PASSWORD')
const apiToken = required('SIGNER_API_TOKEN')
const rpcUrl = required('BSC_RPC_URL')
const encrypted = JSON.parse(
  await readFile(walletFile, 'utf8'),
) as EncryptedMnemonic
const mnemonic = decryptMnemonic(encrypted, password)
const root = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'")
const provider = new JsonRpcProvider(rpcUrl)
const hotWallet = root.derivePath('1/0').connect(provider)
const gasWallet = root.derivePath('1/1').connect(provider)

async function signTokenTransfer(
  tokenAddress: string,
  destination: string,
  rawAmount: string,
) {
  const token = new Contract(tokenAddress, ERC20_ABI, hotWallet)
  const decimals = Number(await token.decimals())
  const populated = await token.transfer.populateTransaction(
    destination,
    parseUnits(rawAmount, decimals),
  )
  const [network, fee, nonce] = await Promise.all([
    provider.getNetwork(),
    provider.getFeeData(),
    provider.getTransactionCount(hotWallet.address, 'pending'),
  ])
  const gasLimit = await provider.estimateGas({
    ...populated,
    from: hotWallet.address,
  })
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas
  if (!gasPrice) throw new Error('Could not determine network gas price')
  const signedTransaction = await hotWallet.signTransaction({
    ...populated,
    chainId: network.chainId,
    nonce,
    gasLimit: (gasLimit * 125n) / 100n,
    gasPrice,
  })
  return {
    nonce,
    signedTransaction,
    txHash: keccak256(signedTransaction),
  }
}

async function safelyBroadcast(signedTransaction: string, txHash: string) {
  try {
    await provider.broadcastTransaction(signedTransaction)
  } catch (cause) {
    const known = await provider.getTransaction(txHash).catch(() => null)
    if (!known) throw cause
  }
}

async function rebroadcast(
  kind: 'WITHDRAWAL' | 'TREASURY' | 'CONTROLLED',
  recordId: string,
) {
  const db = getDb()
  const record =
    kind === 'WITHDRAWAL'
      ? await db
          .select({
            status: withdrawals.status,
            signedTransaction: withdrawals.signedTransaction,
            txHash: withdrawals.txHash,
            amount: withdrawals.netAmount,
          })
          .from(withdrawals)
          .where(eq(withdrawals.id, recordId))
          .limit(1)
          .then((rows) => rows.at(0))
      : kind === 'TREASURY'
        ? await db
            .select({
              status: treasuryTransfers.status,
              signedTransaction: treasuryTransfers.signedTransaction,
              txHash: treasuryTransfers.txHash,
              amount: treasuryTransfers.amount,
            })
            .from(treasuryTransfers)
            .where(eq(treasuryTransfers.id, recordId))
            .limit(1)
            .then((rows) => rows.at(0))
        : await db
            .select({
              status: controlledWalletTransfers.status,
              signedTransaction: controlledWalletTransfers.signedTransaction,
              txHash: controlledWalletTransfers.txHash,
              amount: controlledWalletTransfers.amount,
            })
            .from(controlledWalletTransfers)
            .where(eq(controlledWalletTransfers.id, recordId))
            .limit(1)
            .then((rows) => rows.at(0))
  if (
    !record ||
    record.status !== 'BROADCAST' ||
    !record.signedTransaction ||
    !record.txHash
  )
    throw new Error('Broadcast signed transaction not found')
  await safelyBroadcast(record.signedTransaction, record.txHash)
  return { txHash: record.txHash, amount: record.amount }
}

async function controlledTransfer(transferId: string) {
  const db = getDb()
  let transfer = await db
    .select()
    .from(controlledWalletTransfers)
    .where(eq(controlledWalletTransfers.id, transferId))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!transfer || !['APPROVED', 'PROCESSING'].includes(transfer.status))
    throw new Error('Approved or processing controlled transfer not found')
  if (transfer.asset !== 'BNB')
    throw new Error('Controlled signer transfer only supports BNB')
  if (!isAddress(transfer.destinationAddress))
    throw new Error('Controlled transfer destination is invalid')
  validateWalletTransferRoute({
    sourceRole: transfer.sourceRole,
    destinationType: transfer.destinationType as 'INTERNAL' | 'EXTERNAL',
    destinationRole: transfer.destinationRole,
    asset: 'BNB',
  })
  const source =
    transfer.sourceRole === 'HOT_WITHDRAWAL' ? hotWallet : gasWallet
  const expectedInternalDestination =
    transfer.sourceRole === 'HOT_WITHDRAWAL'
      ? gasWallet.address
      : hotWallet.address
  if (
    transfer.destinationType === 'INTERNAL' &&
    transfer.destinationAddress.toLowerCase() !==
      expectedInternalDestination.toLowerCase()
  )
    throw new Error('Internal destination does not match the controlled wallet')

  const originalStatus = transfer.status
  try {
    if (transfer.status === 'APPROVED') {
      const value = parseUnits(transfer.amount, 18)
      const [network, fee, nonce, balance] = await Promise.all([
        provider.getNetwork(),
        provider.getFeeData(),
        provider.getTransactionCount(source.address, 'pending'),
        provider.getBalance(source.address),
      ])
      const gasPrice = fee.gasPrice ?? fee.maxFeePerGas
      if (!gasPrice) throw new Error('Could not determine network gas price')
      const gasLimit = await provider.estimateGas({
        from: source.address,
        to: transfer.destinationAddress,
        value,
      })
      const bufferedGasLimit = (gasLimit * 125n) / 100n
      if (value + bufferedGasLimit * gasPrice > balance)
        throw new Error('BNB balance is insufficient after network gas')
      const signedTransaction = await source.signTransaction({
        to: transfer.destinationAddress,
        value,
        chainId: network.chainId,
        nonce,
        gasLimit: bufferedGasLimit,
        gasPrice,
      })
      const txHash = keccak256(signedTransaction)
      transfer = await db
        .update(controlledWalletTransfers)
        .set({
          status: 'PROCESSING',
          signedTransaction,
          chainNonce: nonce,
          txHash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(controlledWalletTransfers.id, transfer.id),
            eq(controlledWalletTransfers.status, 'APPROVED'),
          ),
        )
        .returning()
        .then((rows) => rows.at(0))
      if (!transfer) throw new Error('Transfer is already being processed')
    }
    if (!transfer.signedTransaction || !transfer.txHash)
      throw new Error('Processing transfer has no signed transaction')
    await safelyBroadcast(transfer.signedTransaction, transfer.txHash)
    await markControlledWalletTransferBroadcast(transfer.id, transfer.txHash)
    return { txHash: transfer.txHash, amount: transfer.amount }
  } catch (cause) {
    if (originalStatus === 'APPROVED')
      await db
        .update(controlledWalletTransfers)
        .set({
          status: 'FAILED',
          failureReason:
            cause instanceof Error ? cause.message : 'BNB transfer failed',
          updatedAt: new Date(),
        })
        .where(eq(controlledWalletTransfers.id, transferId))
    throw cause
  }
}

async function sweep(walletAddressId: string, force = false) {
  const db = getDb()
  const [addressRow, settings] = await Promise.all([
    db
      .select()
      .from(walletAddresses)
      .where(eq(walletAddresses.id, walletAddressId))
      .limit(1)
      .then((rows) => rows.at(0)),
    db
      .select()
      .from(custodySettings)
      .where(eq(custodySettings.id, 1))
      .limit(1)
      .then((rows) => rows.at(0)),
  ])
  if (!addressRow || addressRow.status !== 'ACTIVE')
    throw new Error('Active deposit address not found')
  if (
    !settings?.tokenContractAddress ||
    !isAddress(settings.tokenContractAddress)
  )
    throw new Error('USDT contract is not configured')
  const child = root
    .derivePath(`0/${addressRow.derivationIndex}`)
    .connect(provider)
  if (child.address.toLowerCase() !== addressRow.address.toLowerCase())
    throw new Error('Stored address does not match the HD wallet')
  const token = new Contract(settings.tokenContractAddress, ERC20_ABI, child)
  const decimals = Number(await token.decimals())
  const balance = (await token.balanceOf(child.address)) as bigint
  if (balance <= 0n) throw new Error('Address has no token balance')

  const minimum = parseUnits(settings.minimumSweepAmount, decimals)
  if (balance < minimum && !force)
    throw new Error('Balance is below the automatic sweep threshold')

  const amount = formatUnits(balance, decimals)
  const sweepRow = await db
    .insert(walletSweeps)
    .values({
      walletAddressId: addressRow.id,
      amount,
      status: 'READY',
    })
    .returning({ id: walletSweeps.id })
    .then((rows) => rows.at(0))
  if (!sweepRow) throw new Error('Could not reserve wallet sweep')

  try {
    const populated = await token.transfer.populateTransaction(
      hotWallet.address,
      balance,
    )
    const gasLimit = await provider.estimateGas({
      ...populated,
      from: child.address,
    })
    const fee = await provider.getFeeData()
    const gasPrice = fee.maxFeePerGas ?? fee.gasPrice
    if (!gasPrice) throw new Error('Could not determine network gas price')
    const requiredGas = (gasLimit * gasPrice * 125n) / 100n
    const nativeBalance = await provider.getBalance(child.address)
    let gasTxHash: string | undefined
    if (nativeBalance < requiredGas) {
      const gasTx = await gasWallet.sendTransaction({
        to: child.address,
        value: requiredGas - nativeBalance,
      })
      gasTxHash = gasTx.hash
      await db
        .update(walletSweeps)
        .set({ status: 'GAS_BROADCAST', gasTxHash, updatedAt: new Date() })
        .where(eq(walletSweeps.id, sweepRow.id))
      await gasTx.wait(1)
    }
    const sweepTx = await token.transfer(hotWallet.address, balance)
    await db
      .update(walletSweeps)
      .set({
        status: 'SWEEP_BROADCAST',
        gasTxHash,
        sweepTxHash: sweepTx.hash,
        broadcastAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(walletSweeps.id, sweepRow.id))
    return { txHash: sweepTx.hash, amount, sweepId: sweepRow.id }
  } catch (cause) {
    await db
      .update(walletSweeps)
      .set({
        status: 'FAILED',
        failureReason:
          cause instanceof Error ? cause.message : 'Wallet sweep failed',
        updatedAt: new Date(),
      })
      .where(eq(walletSweeps.id, sweepRow.id))
    throw cause
  }
}

async function withdraw(withdrawalId: string) {
  const db = getDb()
  let withdrawal = await db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.id, withdrawalId))
    .limit(1)
    .then((rows) => rows.at(0))
  const settings = await db
    .select()
    .from(custodySettings)
    .where(eq(custodySettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!withdrawal || !['APPROVED', 'PROCESSING'].includes(withdrawal.status))
    throw new Error('Approved or processing withdrawal not found')
  if (!isAddress(withdrawal.destinationAddress))
    throw new Error('Withdrawal address is invalid')
  if (
    !settings?.tokenContractAddress ||
    !isAddress(settings.tokenContractAddress)
  )
    throw new Error('USDT contract is not configured')
  const originalWithdrawal = withdrawal

  try {
    if (originalWithdrawal.status === 'APPROVED') {
      const prepared = await signTokenTransfer(
        settings.tokenContractAddress,
        withdrawal.destinationAddress,
        withdrawal.netAmount,
      )
      withdrawal = await db
        .update(withdrawals)
        .set({
          status: 'PROCESSING',
          signedTransaction: prepared.signedTransaction,
          chainNonce: prepared.nonce,
          txHash: prepared.txHash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(withdrawals.id, withdrawal.id),
            eq(withdrawals.status, 'APPROVED'),
          ),
        )
        .returning()
        .then((rows) => rows.at(0))
      if (!withdrawal) throw new Error('Withdrawal is already being processed')
    }
    if (!withdrawal.signedTransaction || !withdrawal.txHash)
      throw new Error('Processing withdrawal has no signed transaction')
    await safelyBroadcast(withdrawal.signedTransaction, withdrawal.txHash)
    await broadcastWithdrawal(
      withdrawal.id,
      withdrawal.txHash,
      withdrawal.reviewedBy!,
    )
    return { txHash: withdrawal.txHash, amount: withdrawal.netAmount }
  } catch (cause) {
    if (originalWithdrawal.status === 'APPROVED') {
      await db
        .update(withdrawals)
        .set({
          status: 'FAILED',
          rejectionReason:
            cause instanceof Error
              ? cause.message
              : 'Withdrawal signing failed',
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, originalWithdrawal.id))
    }
    throw cause
  }
}

async function treasury(transferId: string) {
  const db = getDb()
  let transfer = await db
    .select()
    .from(treasuryTransfers)
    .where(eq(treasuryTransfers.id, transferId))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!transfer || !['APPROVED', 'PROCESSING'].includes(transfer.status))
    throw new Error('Approved or processing treasury transfer not found')
  if (transfer.direction !== 'OUTBOUND')
    throw new Error('Only outbound treasury transfers can be broadcast')
  if (!isAddress(transfer.destination))
    throw new Error('Treasury destination address is invalid')
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
    throw new Error('USDT contract is not configured')
  const originalTransfer = transfer
  try {
    if (transfer.status === 'APPROVED') {
      const prepared = await signTokenTransfer(
        settings.tokenContractAddress,
        transfer.destination,
        transfer.amount,
      )
      transfer = await db
        .update(treasuryTransfers)
        .set({
          status: 'PROCESSING',
          signedTransaction: prepared.signedTransaction,
          chainNonce: prepared.nonce,
          txHash: prepared.txHash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(treasuryTransfers.id, transfer.id),
            eq(treasuryTransfers.status, 'APPROVED'),
          ),
        )
        .returning()
        .then((rows) => rows.at(0))
      if (!transfer) throw new Error('Treasury transfer is already processing')
    }
    if (!transfer.signedTransaction || !transfer.txHash)
      throw new Error('Processing treasury transfer has no signed transaction')
    await safelyBroadcast(transfer.signedTransaction, transfer.txHash)
    await broadcastTreasuryTransfer(
      transfer.id,
      transfer.txHash,
      transfer.createdBy,
    )
    return { txHash: transfer.txHash, amount: transfer.amount }
  } catch (cause) {
    if (originalTransfer.status === 'APPROVED')
      await db
        .update(treasuryTransfers)
        .set({
          status: 'FAILED',
          failureReason:
            cause instanceof Error ? cause.message : 'Treasury signing failed',
          updatedAt: new Date(),
        })
        .where(eq(treasuryTransfers.id, originalTransfer.id))
    throw cause
  }
}

async function replaceTreasuryTransaction(transferId: string) {
  const db = getDb()
  const transfer = await db
    .select()
    .from(treasuryTransfers)
    .where(eq(treasuryTransfers.id, transferId))
    .limit(1)
    .then((rows) => rows.at(0))
  if (
    !transfer ||
    transfer.status !== 'BROADCAST' ||
    !transfer.signedTransaction ||
    !transfer.txHash ||
    transfer.chainNonce === null
  )
    throw new Error('Broadcast treasury transfer is not replaceable')
  const previousTxHash = transfer.txHash
  const previousSignedTransaction = transfer.signedTransaction
  const chainNonce = transfer.chainNonce

  const mined = await provider.getTransactionReceipt(previousTxHash)
  if (mined)
    throw new Error('Transaction is already mined; wait for reconciliation')

  const settings = await db
    .select()
    .from(custodySettings)
    .where(eq(custodySettings.id, 1))
    .limit(1)
    .then((rows) => rows.at(0))
  if (!settings?.tokenContractAddress)
    throw new Error('USDT contract is not configured')

  const previous = Transaction.from(previousSignedTransaction)
  const networkFee = await provider.getFeeData()
  const previousGasPrice = previous.gasPrice ?? previous.maxFeePerGas
  const currentGasPrice = networkFee.gasPrice ?? networkFee.maxFeePerGas
  if (!previousGasPrice || !currentGasPrice)
    throw new Error('Could not determine replacement gas price')
  const gasPrice =
    previousGasPrice > currentGasPrice
      ? (previousGasPrice * 125n) / 100n
      : (currentGasPrice * 125n) / 100n

  const token = new Contract(
    settings.tokenContractAddress,
    ERC20_ABI,
    hotWallet,
  )
  const decimals = Number(await token.decimals())
  const populated = await token.transfer.populateTransaction(
    transfer.destination,
    parseUnits(transfer.amount, decimals),
  )
  const network = await provider.getNetwork()
  const gasLimit =
    previous.gasLimit ||
    (await provider.estimateGas({
      ...populated,
      from: hotWallet.address,
    }))
  const signedTransaction = await hotWallet.signTransaction({
    ...populated,
    chainId: network.chainId,
    nonce: chainNonce,
    gasLimit,
    gasPrice,
  })
  const txHash = keccak256(signedTransaction)
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .insert(treasuryTransactionAttempts)
      .values({
        treasuryTransferId: transfer.id,
        txHash: previousTxHash,
        signedTransaction: previousSignedTransaction,
        chainNonce,
        gasPriceWei: previousGasPrice.toString(),
        status: 'REPLACED',
        broadcastAt: transfer.broadcastAt ?? transfer.updatedAt,
        replacedAt: now,
      })
      .onConflictDoUpdate({
        target: treasuryTransactionAttempts.txHash,
        set: { status: 'REPLACED', replacedAt: now, updatedAt: now },
      })
    await tx.insert(treasuryTransactionAttempts).values({
      treasuryTransferId: transfer.id,
      txHash,
      signedTransaction,
      chainNonce,
      gasPriceWei: gasPrice.toString(),
      status: 'BROADCAST',
      broadcastAt: now,
    })
    const updated = await tx
      .update(treasuryTransfers)
      .set({
        txHash,
        signedTransaction,
        broadcastAt: now,
        failureReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(treasuryTransfers.id, transfer.id),
          eq(treasuryTransfers.txHash, previousTxHash),
          eq(treasuryTransfers.status, 'BROADCAST'),
        ),
      )
      .returning({ id: treasuryTransfers.id })
    if (!updated.length)
      throw new Error('Treasury transfer changed; reload and retry')
  })
  await safelyBroadcast(signedTransaction, txHash)
  return { txHash, amount: transfer.amount }
}

const server = createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== `Bearer ${apiToken}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    const chunks: Array<Buffer> = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
          string,
          unknown
        >)
      : {}
    let result: Record<string, unknown>
    if (request.method === 'POST' && request.url === '/wallets') {
      result = {
        hot: {
          address: hotWallet.address,
          derivationPath: "m/44'/60'/0'/1/0",
        },
        gas: {
          address: gasWallet.address,
          derivationPath: "m/44'/60'/0'/1/1",
        },
      }
    } else if (request.method === 'POST' && request.url === '/derive') {
      const index = Number(body.index)
      if (!Number.isSafeInteger(index) || index < 1)
        throw new Error('Invalid derivation index')
      result = { index, address: root.derivePath(`0/${index}`).address }
    } else if (request.method === 'POST' && request.url === '/sweep') {
      result = await sweep(String(body.walletAddressId), body.force === true)
    } else if (request.method === 'POST' && request.url === '/withdraw') {
      result = await withdraw(String(body.withdrawalId))
    } else if (request.method === 'POST' && request.url === '/treasury') {
      result = await treasury(String(body.transferId))
    } else if (
      request.method === 'POST' &&
      request.url === '/treasury-replace'
    ) {
      result = await replaceTreasuryTransaction(String(body.transferId))
    } else if (
      request.method === 'POST' &&
      request.url === '/controlled-transfer'
    ) {
      result = await controlledTransfer(String(body.transferId))
    } else if (request.method === 'POST' && request.url === '/rebroadcast') {
      const kind = String(body.kind)
      if (!['WITHDRAWAL', 'TREASURY', 'CONTROLLED'].includes(kind))
        throw new Error('Invalid rebroadcast type')
      result = await rebroadcast(
        kind as 'WITHDRAWAL' | 'TREASURY' | 'CONTROLLED',
        String(body.recordId),
      )
    } else {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Not found' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(result))
  } catch (cause) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        error: cause instanceof Error ? cause.message : 'Signer request failed',
      }),
    )
  }
})

const signerHost = process.env.SIGNER_HOST || '127.0.0.1'
const signerPort = Number(process.env.SIGNER_PORT || 9012)
server.listen(signerPort, signerHost, () => {
  console.log(`HD signer listening on http://${signerHost}:${signerPort}`)
  console.log(`Hot wallet: ${hotWallet.address}`)
  console.log(`Gas wallet: ${gasWallet.address}`)
})
