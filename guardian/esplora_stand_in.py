"""STAND-IN, NOT ESPLORA. A minimal Esplora-shaped HTTP API over bitcoind RPC, for regtest only.

The fedimint 0.11.4 client watches for deposits through an Esplora HTTP API
and nothing else. This answers the few endpoints it calls, from a local
bitcoind, on 127.0.0.1 only. It scans every block on each address query, so it
suits a regtest chain of a few hundred blocks and nothing larger.

usage: python3 -I esplora_stand_in.py <port> <rpc url> <rpc user> <rpc password file> <log file>
"""
import base64
import hashlib
import json
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, RPC_URL, RPC_USER, PASS_FILE, LOG = sys.argv[1:6]
with open(PASS_FILE) as f:
    AUTH = base64.b64encode(f"{RPC_USER}:{f.read().strip()}".encode()).decode()


def rpc(method, *params):
    body = json.dumps({"jsonrpc": "1.0", "id": "stand-in", "method": method, "params": list(params)})
    req = urllib.request.Request(RPC_URL, body.encode(), {"Authorization": f"Basic {AUTH}",
                                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.loads(r.read())
    if out.get("error"):
        raise RuntimeError(out["error"])
    return out["result"]


def sats(btc):
    return round(btc * 100_000_000)


def status(tx):
    if not tx.get("blockhash"):
        return {"confirmed": False}
    hdr = rpc("getblockheader", tx["blockhash"])
    return {"confirmed": True, "block_height": hdr["height"], "block_hash": tx["blockhash"],
            "block_time": hdr["time"]}


def esplora_tx(txid):
    tx = rpc("getrawtransaction", txid, 2)
    vin = []
    for i in tx["vin"]:
        coinbase = "coinbase" in i
        prev = None if coinbase else i.get("prevout")
        vin.append({"txid": i.get("txid", "0" * 64), "vout": i.get("vout", 0xFFFFFFFF),
                    "prevout": prev and {"scriptpubkey": prev["scriptPubKey"]["hex"], "value": sats(prev["value"])},
                    "scriptsig": i.get("scriptSig", {}).get("hex", i.get("coinbase", "")),
                    "witness": i.get("txinwitness", []), "sequence": i["sequence"], "is_coinbase": coinbase})
    vout = [{"scriptpubkey": o["scriptPubKey"]["hex"], "value": sats(o["value"])} for o in tx["vout"]]
    return {"txid": txid, "version": tx["version"], "locktime": tx["locktime"], "vin": vin, "vout": vout,
            "size": tx["size"], "weight": tx["weight"], "fee": sats(tx.get("fee", 0)), "status": status(tx)}


def scripthash_txs(scripthash):
    # Esplora's scripthash is Electrum's (byte-reversed); accept either order.
    hits = []
    for height in range(rpc("getblockcount"), -1, -1):
        for tx in rpc("getblock", rpc("getblockhash", height), 2)["tx"]:
            for out in tx["vout"]:
                digest = hashlib.sha256(bytes.fromhex(out["scriptPubKey"]["hex"])).digest()
                if scripthash in (digest[::-1].hex(), digest.hex()):
                    hits.append(tx["txid"])
                    break
    return [esplora_tx(t) for t in dict.fromkeys(hits)]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        with open(LOG, "a") as f:
            f.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def reply(self, code, body, ctype="text/plain"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path.rstrip("/").split("/")[1:]
        js = "application/json"
        try:
            if p == ["blocks", "tip", "height"]:
                return self.reply(200, str(rpc("getblockcount")))
            if p == ["blocks", "tip", "hash"]:
                return self.reply(200, rpc("getbestblockhash"))
            if len(p) == 2 and p[0] == "block-height":
                return self.reply(200, rpc("getblockhash", int(p[1])))
            if len(p) == 3 and p[0] == "block" and p[2] == "header":
                return self.reply(200, rpc("getblockheader", p[1], False))
            if len(p) == 3 and p[0] == "block" and p[2] == "raw":
                return self.reply(200, bytes.fromhex(rpc("getblock", p[1], 0)), "application/octet-stream")
            if len(p) == 3 and p[0] == "scripthash" and p[2] == "txs":
                return self.reply(200, json.dumps(scripthash_txs(p[1])), js)
            if len(p) == 5 and p[0] == "scripthash" and p[2:4] == ["txs", "chain"]:
                txs = scripthash_txs(p[1])
                ids = [t["txid"] for t in txs]
                return self.reply(200, json.dumps(txs[ids.index(p[4]) + 1:][:25] if p[4] in ids else []), js)
            if len(p) == 2 and p[0] == "tx":
                return self.reply(200, json.dumps(esplora_tx(p[1])), js)
            if len(p) == 3 and p[0] == "tx" and p[2] == "hex":
                return self.reply(200, rpc("getrawtransaction", p[1]))
            if len(p) == 3 and p[0] == "tx" and p[2] == "raw":
                return self.reply(200, bytes.fromhex(rpc("getrawtransaction", p[1])), "application/octet-stream")
            if len(p) == 3 and p[0] == "tx" and p[2] == "status":
                return self.reply(200, json.dumps(status(rpc("getrawtransaction", p[1], 1))), js)
            if len(p) == 3 and p[0] == "tx" and p[2] == "merkleblock-proof":
                tx = rpc("getrawtransaction", p[1], 1)
                return self.reply(200, rpc("gettxoutproof", [p[1]], tx["blockhash"]))
            if p == ["fee-estimates"]:
                return self.reply(200, json.dumps({"1": 2.0, "2": 2.0, "6": 1.0, "144": 1.0}), js)
            return self.reply(404, "not served by this stand-in")
        except Exception as e:
            return self.reply(500, str(e))

    def do_POST(self):
        if self.path.rstrip("/") != "/tx":
            return self.reply(404, "not served by this stand-in")
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode().strip()
        try:
            return self.reply(200, rpc("sendrawtransaction", raw))
        except Exception as e:
            return self.reply(400, str(e))


ThreadingHTTPServer(("127.0.0.1", int(PORT)), Handler).serve_forever()
