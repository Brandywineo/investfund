# Custody operations

## Wallet paths

All platform addresses are derived from the encrypted mnemonic under
`m/44'/60'/0'`:

- User deposits: `0/<database derivation_index>`
- Hot wallet: `1/0`
- Gas wallet: `1/1`

The hot wallet is intentionally not the standard `0/0` address shown by most
consumer wallets.

Inspect an address without exposing its key:

```sh
bun run wallet:inspect /secure/path/hd-wallet.json hot
bun run wallet:inspect /secure/path/hd-wallet.json gas
bun run wallet:inspect /secure/path/hd-wallet.json deposit:1
```

Emergency private-key export is deliberately gated. Perform it only on an
offline recovery machine:

```sh
ALLOW_PRIVATE_KEY_EXPORT=I_UNDERSTAND_THE_RISK \
  bun run wallet:inspect /secure/path/hd-wallet.json hot --export-private-key
```

## User withdrawals

Submitting a request immediately moves the amount from the user's available
ledger balance into the withdrawal-reserved account. Rejection or cancellation
releases it. Approval queues it for the chain worker.

The signer saves the signed transaction, nonce, and transaction hash before it
broadcasts. A restart therefore rebroadcasts the same transaction rather than
creating a second payment. The chain worker confirms successful receipts and
reverses the ledger entry if a transaction reverts.

The hot wallet requires BNB for outgoing transaction gas.

## MT5 treasury

Outbound treasury transfers require a destination address, amount, reason, and
administrator approval. They are not limited by the withdrawal reserve policy,
but insufficient recorded hot-wallet balance still prevents an impossible
transfer.

When capital or profit returns from MT5, send it to the platform hot-wallet
address and record the confirmed transaction hash, amount, and reason in the
admin custody page. Principal reduces the recorded broker asset; any excess is
recorded as realized trading profit.

Never record a return before verifying its transaction on BSC. Transaction
hashes are unique in the database and cannot be recorded twice.
