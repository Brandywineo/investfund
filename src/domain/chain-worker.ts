import { money } from './money'

export function scannerBlockRanges(
  fromBlock: number,
  toBlock: number,
  size: number,
) {
  if (!Number.isSafeInteger(size) || size < 1)
    throw new Error('Scanner chunk size must be a positive integer')
  const ranges: Array<{ fromBlock: number; toBlock: number }> = []
  for (let start = fromBlock; start <= toBlock; start += size)
    ranges.push({
      fromBlock: start,
      toBlock: Math.min(toBlock, start + size - 1),
    })
  return ranges
}

export function chainWorkerHealth(lastScanned: number, lastHead: number) {
  const blockLag = Math.max(0, lastHead - lastScanned)
  return {
    blockLag,
    status:
      blockLag > 1_000
        ? ('CRITICAL' as const)
        : blockLag > 100
          ? ('CATCHING_UP' as const)
          : ('HEALTHY' as const),
  }
}

export function hasSufficientHotGas(balance: string, minimum: string) {
  return money(balance).greaterThanOrEqualTo(minimum)
}
