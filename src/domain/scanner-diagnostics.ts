export type RpcDiagnostic = {
  endpoint: number
  hostname: string
  method: string
  category: string
  count: number
  durationMs: number
}
export type ScannerDiagnostics = {
  usdtMs: number
  nativeMs: number
  rpcWaitMs: number
  requests: Array<RpcDiagnostic>
}
