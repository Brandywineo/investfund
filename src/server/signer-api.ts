import { z } from 'zod'

const addressResponse = z.object({ address: z.string(), index: z.number() })
const transactionResponse = z.object({ txHash: z.string(), amount: z.string() })
const platformWalletsResponse = z.object({
  hot: z.object({ address: z.string(), derivationPath: z.string() }),
  gas: z.object({ address: z.string(), derivationPath: z.string() }),
})

async function signerRequest(path: string, body: Record<string, unknown>) {
  const baseUrl = process.env.SIGNER_URL
  const token = process.env.SIGNER_API_TOKEN
  if (!baseUrl || !token) throw new Error('HD wallet signer is not configured')
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = z.object({ error: z.string() }).safeParse(payload)
    throw new Error(
      message.success ? message.data.error : 'Signer request failed',
    )
  }
  return payload
}

export async function deriveDepositAddress(index: number) {
  return addressResponse.parse(await signerRequest('/derive', { index }))
}

export async function getSignerPlatformWallets() {
  return platformWalletsResponse.parse(await signerRequest('/wallets', {}))
}

export async function requestWalletSweep(
  walletAddressId: string,
  force = false,
) {
  return transactionResponse.parse(
    await signerRequest('/sweep', { walletAddressId, force }),
  )
}

export async function requestWithdrawalBroadcast(withdrawalId: string) {
  return transactionResponse.parse(
    await signerRequest('/withdraw', { withdrawalId }),
  )
}

export async function requestTreasuryBroadcast(transferId: string) {
  return transactionResponse.parse(
    await signerRequest('/treasury', { transferId }),
  )
}

export async function requestControlledWalletTransferBroadcast(
  transferId: string,
) {
  return transactionResponse.parse(
    await signerRequest('/controlled-transfer', { transferId }),
  )
}

export async function requestSignedTransactionRebroadcast(
  kind: 'WITHDRAWAL' | 'TREASURY' | 'CONTROLLED',
  recordId: string,
) {
  return transactionResponse.parse(
    await signerRequest('/rebroadcast', { kind, recordId }),
  )
}
