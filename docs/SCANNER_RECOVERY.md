# Scanner recovery

USDT and BNB history previously shared a checkpoint. Downloading every full BNB block made a 100-block batch take roughly 90–108 seconds on the observed server, slower than the chain advanced. USDT catch-up now processes 1,000 finalized blocks per batch when over 1,000 blocks behind, using 100-block log queries that split automatically if the provider rejects the range. Existing recipient-batch configuration is retained for public RPC compatibility.

Migration 0027 copies the saved checkpoint into a separate BNB checkpoint. Neither cursor jumps to the head. BNB scanning runs once per worker invocation and retains its cursor on incomplete responses or failures. Operations displays its independent backlog. Existing pending automatic deposits with complete chain event metadata are retried. Row locking and the ledger idempotency key prevent repeated confirmation from posting twice. A PostgreSQL advisory lock prevents two scanners running together. RPC endpoint failures have a bounded retry budget.

## Deploy on the existing server

Stop the timer and let any active scan finish before migrating:

```bash
sudo systemctl stop investfund-chain.timer
while sudo systemctl is-active --quiet investfund-chain.service; do sleep 2; done
sudo -u deno -H bash -lc '
  set -e
  cd /home/deno/web/ndumb.hs.vc/public_html
  git pull --ff-only origin main
  bun install
  bun run db:migrate
  bun run build
'
```

Ensure existing conservative runtime settings do not stop catch-up after its first batch. This drop-in changes only worker timing, leaving RPC credentials intact:

```bash
sudo mkdir -p /etc/systemd/system/investfund-chain.service.d
sudo tee /etc/systemd/system/investfund-chain.service.d/catchup.conf >/dev/null <<'CONF'
[Service]
TimeoutStartSec=600
Environment=BSC_CATCHUP_MAX_RUNTIME_MS=240000
Environment=BSC_CATCHUP_MAX_BATCHES=10
CONF
sudo systemctl daemon-reload
sudo systemctl restart investfund.service
sudo systemctl start investfund-chain.timer
sudo systemctl start --no-block investfund-chain.service
sudo journalctl -u investfund-chain.service -n 60 --no-pager
```

Review `/admin/operations` after completed runs: USDT lag should decrease, while BNB lag is reported separately. RPC capacity and number of user addresses determine actual recovery time. No production deposits have been verified by the local tests. If deposits remain absent once USDT reaches their block, compare transaction hashes, destination addresses and token contract with the configured BSC USDT contract. Do not use the emergency checkpoint reset: it skips the unprocessed deposit range.

Validation includes the full test suite, PostgreSQL migration and deposit retry integration tests, provider range-splitting coverage, incomplete native-batch rejection, typecheck, changed-file lint and production build.
