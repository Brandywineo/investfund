import { JsonRpcProvider } from 'ethers'
import type { RpcDiagnostic } from '#/domain/scanner-diagnostics'
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
  inFlight: boolean
  transientFailures: number
  availableTokens: number
  lastRefillAt: number
  rateMultiplier: number
}

export type RpcRequestOptions = {
  /** Approximate Alchemy throughput compute units consumed by the request. */
  method?: string
  cost?: number
  /** Internal retry budget for endpoint failures (token waits do not consume it). */
  failureRounds?: number
}

export type RpcPoolSnapshot = {
  activeIndex: number
  endpointCount: number
  healthyEndpoints: number
  failovers: number
  activeHostname: string
  lastFailoverAt: Date | null
}

// Retain temporary endpoint quarantine across batches within this worker process.
const endpointCooldowns = new Map<string, number>()

export class RpcPool {
  private diagnostics = new Map<string, RpcDiagnostic>()
  private waitMs = 0
  private endpoints: Array<RpcEndpoint>
  private activeIndex: number
  private failovers = 0
  private lastFailoverAt: Date | null = null
  private cooldownMs: number
  private requestTimeoutMs: number
  private targetCuPerSecond: number
  private burstCapacity: number

  constructor(input: {
    chainId: number
    startIndex?: number
    cooldownMs?: number
    requestTimeoutMs?: number
    urls?: Array<string>
  }) {
    const urls = input.urls ?? configuredRpcUrls()
    if (!urls.length) throw new Error('BSC_RPC_URLS or BSC_RPC_URL is required')
    this.targetCuPerSecond = Math.max(
      10,
      Number(process.env.BSC_RPC_TARGET_CU_PER_SECOND || 180),
    )
    const burstSeconds = Math.min(
      10,
      Math.max(1, Number(process.env.BSC_RPC_BURST_SECONDS || 2)),
    )
    this.burstCapacity = this.targetCuPerSecond * burstSeconds
    const now = Date.now()
    this.endpoints = urls.map((url) => ({
      url,
      provider: new JsonRpcProvider(url, input.chainId, {
        staticNetwork: true,
      }),
      cooldownUntil: endpointCooldowns.get(url) ?? 0,
      disabled: false,
      inFlight: false,
      transientFailures: 0,
      availableTokens: this.burstCapacity,
      lastRefillAt: now,
      rateMultiplier: 1,
    }))
    this.activeIndex = Math.abs(input.startIndex ?? 0) % this.endpoints.length
    this.cooldownMs = Math.max(
      1_000,
      input.cooldownMs ?? Number(process.env.BSC_RPC_COOLDOWN_MS || 15_000),
    )
    this.requestTimeoutMs = Math.max(
      1_000,
      input.requestTimeoutMs ??
        Number(process.env.BSC_RPC_TIMEOUT_MS || 10_000),
    )
  }

  private async withTimeout<T>(operation: Promise<T>, index: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `BSC RPC request timed out after ${this.requestTimeoutMs}ms on endpoint ${index + 1}`,
                ),
              ),
            this.requestTimeoutMs,
          )
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
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

  private refill(endpoint: RpcEndpoint) {
    const now = Date.now()
    const elapsedMs = Math.max(0, now - endpoint.lastRefillAt)
    endpoint.availableTokens = Math.min(
      this.burstCapacity,
      endpoint.availableTokens +
        (elapsedMs * this.targetCuPerSecond * endpoint.rateMultiplier) / 1_000,
    )
    endpoint.lastRefillAt = now
  }

  private reserve(endpoint: RpcEndpoint, cost: number) {
    this.refill(endpoint)
    if (endpoint.availableTokens < cost) return false
    endpoint.availableTokens -= cost
    return true
  }

  private nextAvailableDelay(cost: number) {
    const now = Date.now()
    const delays = this.endpoints.flatMap((endpoint) => {
      if (endpoint.disabled) return []
      this.refill(endpoint)
      const cooldownDelay = Math.max(0, endpoint.cooldownUntil - now)
      const tokenDelay = Math.max(
        0,
        ((cost - endpoint.availableTokens) /
          (this.targetCuPerSecond * endpoint.rateMultiplier)) *
          1_000,
      )
      return [Math.max(cooldownDelay, tokenDelay, endpoint.inFlight ? 50 : 0)]
    })
    return delays.length ? Math.max(10, Math.min(...delays)) : 0
  }

  async run<T>(
    operation: (endpoint: {
      provider: JsonRpcProvider
      url: string
      index: number
    }) => Promise<T>,
    options: RpcRequestOptions = {},
  ): Promise<T> {
    const cost = Math.min(
      this.burstCapacity,
      Math.max(1, Number(options.cost ?? 10)),
    )
    let lastCause: unknown
    for (const index of this.candidateIndexes()) {
      const endpoint = this.endpoints[index]
      if (
        endpoint.disabled ||
        endpoint.inFlight ||
        endpoint.cooldownUntil > Date.now()
      )
        continue
      if (!this.reserve(endpoint, cost)) continue
      endpoint.inFlight = true
      const startedAt = Date.now()
      const method = /^eth_[a-zA-Z]+$/.test(options.method ?? '')
        ? options.method!
        : 'unspecified'
      const record = (category: string) => {
        const durationMs = Date.now() - startedAt
        const key = `${index}:${method}:${category}`
        const previous = this.diagnostics.get(key)
        this.diagnostics.set(key, {
          endpoint: index + 1,
          hostname: sanitizedRpcHostname(endpoint.url),
          method,
          category,
          count: (previous?.count ?? 0) + 1,
          durationMs: (previous?.durationMs ?? 0) + durationMs,
        })
        if (category !== 'SUCCESS')
          console.warn(
            JSON.stringify({
              event: 'scanner_rpc_failure',
              endpoint: index + 1,
              hostname: sanitizedRpcHostname(endpoint.url),
              method,
              category,
              durationMs,
            }),
          )
      }
      try {
        const result = await this.withTimeout(
          operation({
            provider: endpoint.provider,
            url: endpoint.url,
            index,
          }),
          index,
        )
        record('SUCCESS')
        endpoint.transientFailures = 0
        // Successful requests rotate fairly so all configured accounts share
        // the work before any single account approaches its rolling limit.
        this.activeIndex = (index + 1) % this.endpoints.length
        endpoint.cooldownUntil = 0
        endpointCooldowns.delete(endpoint.url)
        endpoint.rateMultiplier = Math.min(1, endpoint.rateMultiplier + 0.02)
        return result
      } catch (cause) {
        lastCause = cause
        const category = rpcFailureCategory(cause)
        const message = String(cause)
        record(
          message.includes('LOG_RANGE_LIMIT')
            ? 'QUERY_LIMIT'
            : /timed out|timeout/i.test(message)
              ? 'TIMEOUT'
              : category,
        )
        if (category === 'PERMANENT') throw cause
        if (category === 'AUTHENTICATION') endpoint.disabled = true
        else {
          if (category === 'RATE_LIMIT')
            endpoint.rateMultiplier = Math.max(
              0.25,
              endpoint.rateMultiplier * 0.7,
            )
          if (category === 'TRANSIENT') endpoint.transientFailures += 1
          endpoint.cooldownUntil =
            Date.now() +
            (category === 'TRANSIENT'
              ? Math.max(
                  this.cooldownMs,
                  Math.min(
                    15 * 60_000,
                    5 * 60_000 * endpoint.transientFailures,
                  ),
                )
              : this.cooldownMs)
        }
        endpointCooldowns.set(endpoint.url, endpoint.cooldownUntil)
        this.rotate(index)
      } finally {
        endpoint.inFlight = false
      }
    }

    const delay = this.nextAvailableDelay(cost)
    if (delay > 30_000)
      throw (
        lastCause ??
        new Error('All BSC RPC endpoints are temporarily quarantined')
      )
    if (delay > 0) {
      const failureRounds = (options.failureRounds ?? 0) + (lastCause ? 1 : 0)
      if (failureRounds >= 3)
        throw lastCause ?? new Error('BSC RPC retry budget exhausted')
      const waitStartedAt = Date.now()
      await new Promise((resolve) => setTimeout(resolve, delay))
      this.waitMs += Date.now() - waitStartedAt
      return this.run(operation, { ...options, failureRounds })
    }
    throw lastCause ?? new Error('No healthy BSC RPC endpoint is available')
  }

  diagnosticSnapshot() {
    return {
      rpcWaitMs: this.waitMs,
      requests: [...this.diagnostics.values()].map((row) => ({ ...row })),
    }
  }

  destroy() {
    for (const endpoint of this.endpoints) endpoint.provider.destroy()
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
