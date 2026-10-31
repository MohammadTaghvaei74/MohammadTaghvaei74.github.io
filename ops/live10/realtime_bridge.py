#!/usr/bin/env python3
"""Conservative local realtime bridge for the Bourse public snapshot.

It never calls the market provider. It only validates the existing handoff file,
publishes the latest valid snapshot to local Redis, and exposes localhost-only
/latest, /health, and /stream endpoints.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import http.server
import json
import os
import queue
import socket
import threading
import time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

SOURCE = Path(os.getenv("BOURSE_LIVE_PATH", "/root/bourse-alert/live_market.json"))
REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
PORT = int(os.getenv("BRIDGE_PORT", "8765"))
POLL_SECONDS = float(os.getenv("BRIDGE_POLL_SECONDS", "2"))
MAX_SOURCE_AGE = float(os.getenv("LIVE_MAX_SOURCE_AGE", "90"))
MAX_CLIENTS = int(os.getenv("BRIDGE_MAX_CLIENTS", "20"))
TEHRAN = ZoneInfo("Asia/Tehran")


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_timestamp(value: Any) -> dt.datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing source timestamp")
    text = value.strip().replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def market_is_open() -> bool:
    local = now_utc().astimezone(TEHRAN)
    return (
        local.weekday() in (0, 1, 2, 5, 6)
        and local.replace(hour=8, minute=45, second=0, microsecond=0)
        <= local
        < local.replace(hour=12, minute=31, second=0, microsecond=0)
    )


def validate_payload(payload: Any) -> tuple[dict[str, Any], float, str]:
    if not isinstance(payload, dict):
        raise ValueError("snapshot root must be an object")
    timestamp = payload.get("collector_observed_at") or payload.get("generated_at")
    observed = parse_timestamp(timestamp)
    age = (now_utc() - observed).total_seconds()
    if age < -30:
        raise ValueError(f"source timestamp is in the future: {age:.1f}s")
    if age > MAX_SOURCE_AGE:
        raise ValueError(f"source is stale: {age:.1f}s > {MAX_SOURCE_AGE:.1f}s")
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()
    return payload, age, digest


def load_fresh_snapshot() -> tuple[dict[str, Any], float, str]:
    return validate_payload(json.loads(SOURCE.read_bytes()))


class RedisClient:
    def __init__(self, host: str, port: int, timeout: float = 2.0) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout

    def command(self, *parts: str) -> bytes:
        encoded = []
        for part in parts:
            value = str(part).encode()
            encoded.append(b"$" + str(len(value)).encode() + b"\r\n" + value + b"\r\n")
        request = b"*" + str(len(encoded)).encode() + b"\r\n" + b"".join(encoded)
        with socket.create_connection((self.host, self.port), self.timeout) as sock:
            sock.sendall(request)
            return self._read_response(sock)

    def subscribe(self, channel: str, callback) -> None:
        encoded = []
        for part in ("SUBSCRIBE", channel):
            value = str(part).encode()
            encoded.append(b"$" + str(len(value)).encode() + b"\r\n" + value + b"\r\n")
        request = b"*2\r\n" + b"".join(encoded)
        with socket.create_connection((self.host, self.port), self.timeout) as sock:
            sock.settimeout(None)
            sock.sendall(request)
            self._read_response(sock)
            while True:
                message = self._read_response(sock)
                if isinstance(message, list) and len(message) == 3 and message[0] == b"message":
                    callback(message[2].decode("utf-8"))

    @staticmethod
    def _read_response(sock: socket.socket) -> bytes:
        prefix = sock.recv(1)
        if not prefix:
            raise ConnectionError("empty Redis response")
        if prefix in (b"+", b":", b"-"):
            return prefix + RedisClient._read_line(sock)
        if prefix == b"*":
            count = int(RedisClient._read_line(sock))
            return [RedisClient._read_response(sock) for _ in range(count)]
        if prefix == b"$":
            size = int(RedisClient._read_line(sock))
            if size < 0:
                return b"$-1"
            data = b""
            while len(data) < size + 2:
                data += sock.recv(size + 2 - len(data))
            return data[:size]
        raise ConnectionError(f"unsupported Redis response: {prefix!r}")

    @staticmethod
    def _read_line(sock: socket.socket) -> bytes:
        data = b""
        while not data.endswith(b"\r\n"):
            chunk = sock.recv(1)
            if not chunk:
                raise ConnectionError("incomplete Redis response")
            data += chunk
        return data[:-2]

    def ping(self) -> bool:
        return self.command("PING") == b"+PONG"

    def publish(self, payload: str) -> None:
        self.command("SET", "bourse:market:latest", payload, "EX", "120")
        self.command("PUBLISH", "bourse:market:updates", payload)

    def get_latest(self) -> bytes:
        return self.command("GET", "bourse:market:latest")


class BridgeState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.latest: dict[str, Any] | None = None
        self.latest_age: float | None = None
        self.latest_digest: str | None = None
        self.last_success: str | None = None
        self.last_error: str | None = None
        self.redis_ok = False
        self.transport_source: str | None = None
        self.clients: set[queue.Queue[str]] = set()

    def health(self) -> dict[str, Any]:
        with self.lock:
            if self.latest is not None:
                self.latest_age = (now_utc() - parse_timestamp(self.latest.get("collector_observed_at") or self.latest.get("generated_at"))).total_seconds()
            data_fresh = self.latest_age is not None and self.latest_age <= MAX_SOURCE_AGE
            infrastructure_ok = self.redis_ok
            return {
                "ok": bool(infrastructure_ok and (data_fresh or not market_is_open())),
                "infrastructure_ok": infrastructure_ok,
                "data_fresh": data_fresh,
                "market_open": market_is_open(),
                "source": str(SOURCE),
                "source_age_seconds": self.latest_age,
                "last_success": self.last_success,
                "last_error": self.last_error,
                "redis_ok": self.redis_ok,
                "transport_source": self.transport_source,
                "clients": len(self.clients),
            }

    def accept(self, payload: dict[str, Any], age: float, digest: str, source: str) -> bool:
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self.lock:
            if self.latest is not None:
                incoming = parse_timestamp(payload.get("collector_observed_at") or payload.get("generated_at"))
                current = parse_timestamp(self.latest.get("collector_observed_at") or self.latest.get("generated_at"))
                if incoming < current:
                    return False
            if digest == self.latest_digest:
                self.latest_age = age
                if self.transport_source != "redis-pubsub" or source == "redis-pubsub":
                    self.transport_source = source
                return False
            self.latest = payload
            self.latest_age = age
            self.latest_digest = digest
            self.last_success = now_utc().isoformat()
            self.last_error = None
            self.transport_source = source
        self.publish_local(serialized)
        return True

    def add_client(self) -> queue.Queue[str] | None:
        with self.lock:
            if len(self.clients) >= MAX_CLIENTS:
                return None
            client: queue.Queue[str] = queue.Queue(maxsize=2)
            self.clients.add(client)
            return client

    def remove_client(self, client: queue.Queue[str]) -> None:
        with self.lock:
            self.clients.discard(client)

    def publish_local(self, payload: str) -> None:
        with self.lock:
            clients = tuple(self.clients)
        for client in clients:
            try:
                client.put_nowait(payload)
            except queue.Full:
                try:
                    client.get_nowait()
                except queue.Empty:
                    pass
                try:
                    client.put_nowait(payload)
                except queue.Full:
                    pass


STATE = BridgeState()
REDIS = RedisClient(REDIS_HOST, REDIS_PORT)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "BourseLiveBridge/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            health = STATE.health()
            self.send_json(200 if health["ok"] else 503, health)
            return
        if self.path == "/latest":
            with STATE.lock:
                payload = STATE.latest
            if payload is None:
                self.send_json(503, {"ok": False, "error": "no fresh snapshot"})
            else:
                self.send_json(200, payload)
            return
        if self.path == "/stream":
            self.stream()
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def stream(self) -> None:
        client = STATE.add_client()
        if client is None:
            self.send_json(503, {"ok": False, "error": "client limit reached"})
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.wfile.write(b"retry: 3000\n\n")
            self.wfile.flush()
            while True:
                try:
                    payload = client.get(timeout=15)
                    message = b"event: market\ndata: " + payload.encode() + b"\n\n"
                except queue.Empty:
                    message = b": keepalive\n\n"
                self.wfile.write(message)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass
        finally:
            STATE.remove_client(client)


def accept_redis_message(serialized: str) -> None:
    if not serialized.lstrip().startswith("{"):
        return
    try:
        payload, age, digest = validate_payload(json.loads(serialized))
        STATE.redis_ok = True
        STATE.accept(payload, age, digest, "redis-pubsub")
    except Exception as exc:
        message = f"Redis message rejected: {type(exc).__name__}: {exc}"[:300]
        if not (isinstance(exc, ValueError) and "source is stale" in str(exc) and not market_is_open()):
            with STATE.lock:
                STATE.last_error = message


def load_redis_latest() -> None:
    try:
        latest = REDIS.get_latest()
        if latest:
            accept_redis_message(latest.decode("utf-8"))
        else:
            STATE.redis_ok = REDIS.ping()
    except Exception as exc:
        with STATE.lock:
            STATE.redis_ok = False
            STATE.last_error = f"Redis latest: {type(exc).__name__}: {exc}"[:300]


def redis_subscriber() -> None:
    while True:
        try:
            REDIS.subscribe("bourse:market:updates", accept_redis_message)
        except Exception as exc:
            with STATE.lock:
                STATE.redis_ok = False
                STATE.last_error = f"Redis subscriber: {type(exc).__name__}: {exc}"[:300]
            time.sleep(2)


def poll_file_fallback(last_digest: str | None) -> str | None:
    try:
        payload, age, digest = load_fresh_snapshot()
        STATE.redis_ok = REDIS.ping()
        if digest != last_digest:
            STATE.accept(payload, age, digest, "file-fallback")
        else:
            with STATE.lock:
                STATE.latest_age = age
                STATE.last_error = None
        return digest
    except Exception as exc:
        with STATE.lock:
            try:
                STATE.redis_ok = REDIS.ping()
            except Exception:
                STATE.redis_ok = False
            if not (isinstance(exc, ValueError) and "source is stale" in str(exc) and not market_is_open()):
                STATE.last_error = f"{type(exc).__name__}: {exc}"[:300]
        return last_digest


def main() -> None:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name="http", daemon=True).start()
    load_redis_latest()
    threading.Thread(target=redis_subscriber, name="redis-subscriber", daemon=True).start()
    with STATE.lock:
        digest = STATE.latest_digest
    while True:
        digest = poll_file_fallback(digest)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
