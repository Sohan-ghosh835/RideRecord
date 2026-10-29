"""SQLite store (schema is plain SQL and portable to PostgreSQL: swap the connection factory and `?` placeholders).

Tables
  catalog         normalised, validated records served to the app
  raw_sources     raw fetched/uploaded payloads kept SEPARATELY from normalised records, with hash + retrieval time
  review_queue    conflicts and uncertain records awaiting an administrator
  history         every change to a catalog record (provenance / audit trail)
  ingestion_log   one row per ingestion run/event
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timezone

from .schema import CatalogRecord, normalize_text

SCHEMA = """
CREATE TABLE IF NOT EXISTS catalog (
  id TEXT PRIMARY KEY, manufacturer TEXT NOT NULL, model TEXT NOT NULL, search_text TEXT NOT NULL,
  year_from INTEGER NOT NULL, year_to INTEGER, category TEXT NOT NULL, fuel_type TEXT NOT NULL,
  verification TEXT NOT NULL, payload TEXT NOT NULL, merged_into TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_catalog_mfr ON catalog(manufacturer);
CREATE INDEX IF NOT EXISTS ix_catalog_model ON catalog(model);
CREATE INDEX IF NOT EXISTS ix_catalog_year ON catalog(year_from, year_to);
CREATE INDEX IF NOT EXISTS ix_catalog_cat ON catalog(category);
CREATE TABLE IF NOT EXISTS raw_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, url TEXT, sha256 TEXT NOT NULL, retrieved_at TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, record_id TEXT, detail TEXT NOT NULL, incoming TEXT,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, action TEXT NOT NULL, before TEXT, after TEXT, source TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: str = "data/catalog.sqlite3"):
        self.path = path
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    # ---- helpers
    def _q(self, sql: str, args: tuple = ()):
        with self._lock:
            return self.conn.execute(sql, args).fetchall()

    def _x(self, sql: str, args: tuple = ()):
        with self._lock, self.conn:
            return self.conn.execute(sql, args)

    def log(self, source: str, level: str, message: str) -> None:
        self._x("INSERT INTO ingestion_log(source,level,message,at) VALUES (?,?,?,?)", (source, level, message[:1000], now()))

    def save_raw(self, source: str, url: str | None, body: str) -> str:
        digest = hashlib.sha256(body.encode()).hexdigest()
        if not self._q("SELECT 1 FROM raw_sources WHERE sha256=?", (digest,)):
            self._x("INSERT INTO raw_sources(source,url,sha256,retrieved_at,body) VALUES (?,?,?,?,?)", (source, url, digest, now(), body))
        return digest

    # ---- catalog
    def get(self, rid: str) -> CatalogRecord | None:
        rows = self._q("SELECT payload, merged_into FROM catalog WHERE id=?", (rid,))
        if not rows:
            return None
        if rows[0]["merged_into"]:  # merged duplicates keep resolving, so references never break
            return self.get(rows[0]["merged_into"])
        return CatalogRecord.model_validate_json(rows[0]["payload"])

    def put(self, rec: CatalogRecord, source: str, action: str = "upsert") -> None:
        rec.updatedAt = now()
        before = self._q("SELECT payload FROM catalog WHERE id=?", (rec.id,))
        text = normalize_text(" ".join([rec.manufacturer, rec.model, rec.generation or "", *rec.aliases, *(rec.variants or [])]))
        self._x(
            "INSERT INTO catalog(id,manufacturer,model,search_text,year_from,year_to,category,fuel_type,verification,payload,merged_into,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET manufacturer=excluded.manufacturer, model=excluded.model, "
            "search_text=excluded.search_text, year_from=excluded.year_from, year_to=excluded.year_to, category=excluded.category, "
            "fuel_type=excluded.fuel_type, verification=excluded.verification, payload=excluded.payload, updated_at=excluded.updated_at",
            (rec.id, rec.manufacturer, rec.model, text, rec.yearFrom, rec.yearTo, rec.category, rec.fuelType, rec.verification, rec.model_dump_json(), rec.updatedAt),
        )
        self._x("INSERT INTO history(record_id,action,before,after,source,at) VALUES (?,?,?,?,?,?)",
                (rec.id, action, before[0]["payload"] if before else None, rec.model_dump_json(), source, now()))

    def search(self, q: str, limit: int = 30, manufacturer: str | None = None, year: int | None = None,
               category: str | None = None, offset: int = 0) -> list[CatalogRecord]:
        sql, args = "SELECT payload FROM catalog WHERE merged_into IS NULL", []
        for tok in normalize_text(q).split():
            sql += " AND search_text LIKE ?"
            args.append(f"%{tok}%")
        if manufacturer:
            sql += " AND manufacturer=?"; args.append(manufacturer)
        if category:
            sql += " AND category=?"; args.append(category)
        if year:
            sql += " AND year_from<=? AND (year_to IS NULL OR year_to>=?)"; args += [year, year]
        sql += " ORDER BY manufacturer, model, year_from DESC LIMIT ? OFFSET ?"
        args += [min(limit, 100), offset]
        return [CatalogRecord.model_validate_json(r["payload"]) for r in self._q(sql, tuple(args))]

    def coverage(self) -> dict:
        rows = self._q("SELECT verification, COUNT(*) n FROM catalog WHERE merged_into IS NULL GROUP BY verification")
        by_m = self._q("SELECT manufacturer, COUNT(*) n, SUM(verification='verified') v FROM catalog WHERE merged_into IS NULL GROUP BY manufacturer ORDER BY n DESC")
        return {"total": sum(r["n"] for r in rows), "byVerification": {r["verification"]: r["n"] for r in rows},
                "byManufacturer": [{"manufacturer": r["manufacturer"], "total": r["n"], "verified": r["v"] or 0} for r in by_m]}

    # ---- review queue
    def enqueue(self, kind: str, record_id: str | None, detail: str, incoming: CatalogRecord | None = None) -> int:
        cur = self._x("INSERT INTO review_queue(kind,record_id,detail,incoming,created_at) VALUES (?,?,?,?,?)",
                      (kind, record_id, detail, incoming.model_dump_json() if incoming else None, now()))
        return cur.lastrowid  # type: ignore[return-value]

    def queue(self, status: str = "pending") -> list[dict]:
        return [dict(r) for r in self._q("SELECT * FROM review_queue WHERE status=? ORDER BY id DESC LIMIT 500", (status,))]

    def resolve(self, qid: int, accept: bool, by: str = "admin") -> bool:
        rows = self._q("SELECT * FROM review_queue WHERE id=? AND status='pending'", (qid,))
        if not rows:
            return False
        r = rows[0]
        if accept and r["incoming"]:
            self.put(CatalogRecord.model_validate_json(r["incoming"]), source=f"review:{by}", action="review-accepted")
        self._x("UPDATE review_queue SET status=?, resolved_at=? WHERE id=?", ("accepted" if accept else "dismissed", now(), qid))
        return True

    def merge(self, duplicate_id: str, into_id: str) -> bool:
        if duplicate_id == into_id or not self._q("SELECT 1 FROM catalog WHERE id=?", (duplicate_id,)) or not self._q("SELECT 1 FROM catalog WHERE id=?", (into_id,)):
            return False
        self._x("UPDATE catalog SET merged_into=? WHERE id=?", (into_id, duplicate_id))
        self._x("INSERT INTO history(record_id,action,before,after,source,at) VALUES (?,?,?,?,?,?)", (duplicate_id, "merged", None, into_id, "admin", now()))
        return True

    def logs(self, limit: int = 200) -> list[dict]:
        return [dict(r) for r in self._q("SELECT * FROM ingestion_log ORDER BY id DESC LIMIT ?", (limit,))]

    def history(self, rid: str) -> list[dict]:
        return [dict(r) for r in self._q("SELECT id,action,source,at FROM history WHERE record_id=? ORDER BY id DESC", (rid,))]
