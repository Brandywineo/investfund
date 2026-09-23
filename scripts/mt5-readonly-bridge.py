"""Loopback-only, read-only HTTP bridge for MetaTrader 5.

Run this script with the Windows Python interpreter inside the same Wine prefix
as the MT5 terminal. It deliberately exposes no order-send or account-balance
method.
"""

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import MetaTrader5 as mt5


TOKEN = os.environ["MT5_BRIDGE_TOKEN"]
HOST = os.getenv("MT5_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("MT5_BRIDGE_PORT", "9020"))
TERMINAL_PATH = os.environ["MT5_TERMINAL_PATH"]
LOGIN = int(os.environ["MT5_LOGIN"])
PASSWORD = os.environ["MT5_PASSWORD"]
SERVER = os.environ["MT5_SERVER"]
HISTORY_START = os.getenv("MT5_HISTORY_START", "2000-01-01T00:00:00+00:00")


def iso_from_seconds(value):
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def connected():
    if mt5.terminal_info() is not None:
        return True
    return bool(
        mt5.initialize(
            TERMINAL_PATH,
            login=LOGIN,
            password=PASSWORD,
            server=SERVER,
            timeout=60_000,
            portable=True,
        )
    )


def health():
    ok = connected()
    version = mt5.version() if ok else None
    return {
        "connected": ok,
        "server": SERVER if ok else None,
        "terminalVersion": ".".join(map(str, version)) if version else None,
    }


def positions():
    rows = mt5.positions_get() or []
    return [
        {
            "ticket": str(row.ticket),
            "identifier": str(row.identifier),
            "symbol": row.symbol,
            "side": "BUY" if row.type == mt5.POSITION_TYPE_BUY else "SELL",
            "volume": str(row.volume),
            "entryPrice": str(row.price_open),
            "currentPrice": str(row.price_current),
            "stopLoss": str(row.sl) if row.sl else None,
            "takeProfit": str(row.tp) if row.tp else None,
            "floatingProfit": str(row.profit),
            "swap": str(row.swap),
            "openedAt": iso_from_seconds(row.time),
        }
        for row in rows
    ]


ORDER_TYPES = {
    mt5.ORDER_TYPE_BUY_LIMIT: "BUY LIMIT",
    mt5.ORDER_TYPE_SELL_LIMIT: "SELL LIMIT",
    mt5.ORDER_TYPE_BUY_STOP: "BUY STOP",
    mt5.ORDER_TYPE_SELL_STOP: "SELL STOP",
    mt5.ORDER_TYPE_BUY_STOP_LIMIT: "BUY STOP LIMIT",
    mt5.ORDER_TYPE_SELL_STOP_LIMIT: "SELL STOP LIMIT",
}


def orders():
    rows = mt5.orders_get() or []
    return [
        {
            "ticket": str(row.ticket),
            "symbol": row.symbol,
            "orderType": ORDER_TYPES.get(row.type, f"ORDER {row.type}"),
            "volumeInitial": str(row.volume_initial),
            "volumeCurrent": str(row.volume_current),
            "requestedPrice": str(row.price_open) if row.price_open else None,
            "stopLoss": str(row.sl) if row.sl else None,
            "takeProfit": str(row.tp) if row.tp else None,
            "placedAt": iso_from_seconds(row.time_setup),
            "expiresAt": iso_from_seconds(row.time_expiration) if row.time_expiration else None,
        }
        for row in rows
    ]


def deals(history_from):
    start = datetime.fromisoformat(history_from or HISTORY_START)
    end = datetime.now(timezone.utc)
    rows = mt5.history_deals_get(start, end) or []
    trade_types = {mt5.DEAL_TYPE_BUY: "BUY", mt5.DEAL_TYPE_SELL: "SELL"}
    entry_types = {
        mt5.DEAL_ENTRY_IN: "IN",
        mt5.DEAL_ENTRY_OUT: "OUT",
        mt5.DEAL_ENTRY_INOUT: "INOUT",
        mt5.DEAL_ENTRY_OUT_BY: "OUT_BY",
    }
    return [
        {
            "ticket": str(row.ticket),
            "orderTicket": str(row.order),
            "positionTicket": str(row.position_id),
            "symbol": row.symbol,
            "side": trade_types[row.type],
            "entry": entry_types.get(row.entry, str(row.entry)),
            "volume": str(row.volume),
            "price": str(row.price),
            "profit": str(row.profit),
            "commission": str(row.commission),
            "swap": str(row.swap),
            "fee": str(row.fee),
            "executedAt": iso_from_seconds(row.time),
        }
        for row in rows
        if row.type in trade_types and row.symbol
    ]


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("authorization") != f"Bearer {TOKEN}":
            return self.send_json(401, {"error": "unauthorized"})
        try:
            route = urlparse(self.path)
            if route.path == "/health":
                return self.send_json(200, health())
            if route.path == "/snapshot":
                if not connected():
                    return self.send_json(503, {"error": str(mt5.last_error())})
                query = parse_qs(route.query)
                history_from = query.get("historyFrom", [None])[0]
                return self.send_json(
                    200,
                    {
                        "positions": positions(),
                        "orders": orders(),
                        "deals": deals(history_from),
                    },
                )
            return self.send_json(404, {"error": "not found"})
        except Exception as error:
            return self.send_json(500, {"error": str(error)})

    def log_message(self, message, *args):
        print(f"{self.address_string()} {message % args}")


if __name__ == "__main__":
    if not connected():
        raise SystemExit(f"MT5 initialization failed: {mt5.last_error()}")
    print(f"Read-only MT5 bridge listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

