# MT5 reporting integration

InvestFund imports only open positions, pending orders and executed trade deals.
It does not request or store MT5 balance, equity, margin or account valuation,
and the bridge contains no endpoint for opening, changing or closing a trade.

The manager may trade from any MT5 client. The headless terminal on the server
logs into the same broker account, and InvestFund copies its reporting data into
PostgreSQL every ten seconds.

## Runtime boundary

Run `scripts/mt5-readonly-bridge.py` with the Windows Python interpreter inside
the same Wine prefix as MT5. Install the official `MetaTrader5` Python package
in that Wine Python environment. Bind only to `127.0.0.1:9020`.

Store terminal credentials outside the repository in a protected environment
file. Prefer the broker's investor/read-only password.

The bridge environment requires:

```text
MT5_TERMINAL_PATH=C:\\investfund-mt5\\terminal64.exe
MT5_LOGIN=12345678
MT5_PASSWORD=investor-password
MT5_SERVER=Broker-Server
MT5_BRIDGE_TOKEN=long-independent-secret
MT5_BRIDGE_HOST=127.0.0.1
MT5_BRIDGE_PORT=9020
MT5_HISTORY_START=2000-01-01T00:00:00+00:00
```

The InvestFund `.env` requires:

```text
MT5_BRIDGE_URL=http://127.0.0.1:9020
MT5_BRIDGE_TOKEN=the-same-independent-secret
MT5_BRIDGE_TIMEOUT_MS=10000
```

Apply the database migration, build the app, install the units from `deploy/`,
then enable `investfund-mt5-sync.timer`. The first successful synchronization
imports the complete trade history from `MT5_HISTORY_START`; later runs use an
overlapping cursor and unique ticket constraints to avoid gaps and duplicates.
