import { JsonRpcProvider } from 'ethers'
import {
  configuredRpcUrls,
  rpcFailureCategory,
  sanitizedRpcHostname,
} from '#/domain/rpc-pool'

type RpcEndpoint = {
  url: string
  provider: JsonRpcProvider
  cooldownUntil: number
  disabled: boolean
}

export type RpcPoolSnapshot = {
  activeIndex: number
  endpointCount: number
  healthyEndpoints: number
  failovers: number
  activeHostname: string
  lastFailoverAt: Date | null
}

export class RpcPool {
  private endpoints: Array<RpcEndpoint>
  private activeIndex: number
  private failovers = 0
  private lastFailoverAt: Date | null = null
  private cooldownMs: number

  constructor(input: {
    chainId: number
    startIndex?: number
    cooldownMs?: number
    urls?: Array<string>
  }) {
    const urls = input.urls ?? configuredRpcUrls()
    if (!urls.length)
      throw new Error('BSC_RPC_URLS or BSC_RPC_URL is required')
    this.endpoints = urls.map((url) => ({
      url,
      provider: new JsonRpcProvider(url, input.chainId, {
        staticNetwork: true,
      }),
      cooldownUntil: 0,
      disabled: false,
    }))
    this.activeIndex = Math.abs(input.startIndex ?? 0) % this.endpoints.length
    this.cooldownMs = Math.max(
      1_000,
      input.cooldownMs ?? Number(process.env.BSC_RPC_COOLDOWN_MS || 15_000),
    )
  }

  private candidateIndexes() {
    return Array.from(
      { length: this.endpoints.length },
      (_, offset) => (this.activeIndex + offset) % this.endpoints.length,
    )
  }

  private rotate(fromIndex: number) {
    const next = this.candidateIndexes().find(
      (index) => index !== fromIndex && !this.endpoints[index].disabled,
    )
    if (next === undefined) return
    this.activeIndex = next
    this.failovers += 1
    this.lastFailoverAt = new Date()
  }

  async run<T>(
    operation: (endpoint: {
      provider: JsonRpcProvider
      url: string
      index: number
    }) => Promise<T>,
  ) {
    let lastCause: unknown
    const attempted = new Set<number>()
    for (const index of this.candidateIndexes()) {
      const endpoint = this.endpoints[index]
      if (endpoint.disabled || endpoint.cooldownUntil > Date.now()) continue
      attempted.add(index)
      try {
        const result = await operation({
          provider: endpoint.provider,
          url: endpoint.url,
          index,
        })
        this.activeIndex = index
        endpoint.cooldownUntil = 0
        return result
      } catch (cause) {
        lastCause = cause
        const category = rpcFailureCategory(cause)
        if (category === 'PERMANENT') throw cause
        if (category === 'AUTHENTICATION') endpoint.disabled = true
        else endpoint.cooldownUntil = Date.now() + this.cooldownMs
        this.rotate(index)
      }
    }

    const cooling = this.endpoints
      .map((endpoint, index) => ({ endpoint, index }))
      .filter(
        ({ endpoint, index }) =>
          !attempted.has(index) &&
          !endpoint.disabled &&
          endpoint.cooldownUntil > Date.now(),
      )
      .sort((left, right) =>
        left.endpoint.cooldownUntil - right.endpoint.cooldownUntil,
      )
      .at(0)
    if (cooling) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, cooling.endpoint.cooldownUntil - Date.now()),
        ),
      )
      try {
        const result = await operation({
          provider: cooling.endpoint.provider,
          url: cooling.endpoint.url,
          index: cooling.index,
        })
        this.activeIndex = cooling.index
        cooling.endpoint.cooldownUntil = 0
        return result
      } catch (cause) {
        lastCause = cause
      }
    }
    throw lastCause ?? new Error('No healthy BSC RPC endpoint is available')
  }

  snapshot(): RpcPoolSnapshot {
    const active = this.endpoints[this.activeIndex]
    return {
      activeIndex: this.activeIndex,
      endpointCount: this.endpoints.length,
      healthyEndpoints: this.endpoints.filter(
        (endpoint) =>
          !endpoint.disabled && endpoint.cooldownUntil <= Date.now(),
      ).length,
      failovers: this.failovers,
      activeHostname: sanitizedRpcHostname(active.url),
      lastFailoverAt: this.lastFailoverAt,
    }
  }
}
