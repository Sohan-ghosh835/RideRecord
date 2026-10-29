"""Controlled catalog ingestion.

This module is deliberately a PIPELINE, not a scraper farm. It ships with:
  * PoliteFetcher  – robots.txt check, descriptive User-Agent, per-host throttling, retries with backoff, size cap.
                     It never logs in, solves CAPTCHAs, or bypasses paywalls; a disallowed or protected URL is skipped and logged.
  * Adapter base   – one adapter per source/market. Adapters only *extract*; validation, dedupe, conflict handling
                     and provenance are shared below, so adding a source never changes core logic.
  * JsonFeedAdapter / LocalFileAdapter – for licensed feeds, open datasets or files you are permitted to use.

NO manufacturer-specific scraper is included. Whether a given site may be fetched depends on its terms, and that must be
decided per source by the operator, then implemented as an Adapter subclass. Until then use licensed feeds or file imports.

Priority hierarchy when records conflict: official manufacturer/manual > authorised distributor > other credible source.
A lower-priority record can never overwrite a higher-priority one; it is queued for human review instead.
"""
from __future__ import annotations

import json
import time
import urllib.robotparser
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from .schema import OFFICIAL, CatalogRecord
from .store import Store

USER_AGENT = "RideRecordCatalogBot/1.0 (+contact: set INGEST_CONTACT)"
MAX_BYTES = 5 * 1024 * 1024
RANK = {"manufacturer": 0, "manual": 0, "distributor": 1, "third-party": 2, "seed": 3, "user": 4}


def record_rank(rec: CatalogRecord) -> int:
    """Lower is better. Unverified records rank below any verified one."""
    best = min((RANK.get(s.kind, 4) for s in rec.sources), default=4)
    return best if rec.verification == "verified" else best + 10


class PoliteFetcher:
    def __init__(self, min_interval: float = 2.0, retries: int = 2, client: httpx.Client | None = None, contact: str = ""):
        self.min_interval, self.retries = min_interval, retries
        self.client = client or httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": USER_AGENT.replace("set INGEST_CONTACT", contact or "unset")})
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def allowed(self, url: str) -> bool:
        host = urlparse(url)
        base = f"{host.scheme}://{host.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.client.get(f"{base}/robots.txt")
                if r.status_code in (401, 403):
                    self._robots[base] = None  # access restricted: treat everything as disallowed
                    return False
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
                self._robots[base] = rp
            except httpx.HTTPError:
                self._robots[base] = None
                return False
        rp = self._robots[base]
        return bool(rp and rp.can_fetch(USER_AGENT, url))

    def get(self, url: str) -> str:
        if not self.allowed(url):
            raise PermissionError(f"Fetching {url} is not permitted (robots.txt or access restriction).")
        host = urlparse(url).netloc
        wait = self.min_interval - (time.monotonic() - self._last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        last_err: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                self._last[host] = time.monotonic()
                r = self.client.get(url)
                if r.status_code in (401, 402, 403, 451):
                    raise PermissionError(f"{url} answered {r.status_code}; not retrying or working around it.")
                r.raise_for_status()
                if len(r.content) > MAX_BYTES:
                    raise ValueError("response too large")
                return r.text
            except PermissionError:
                raise
            except (httpx.HTTPError, ValueError) as e:
                last_err = e
                time.sleep(min(2 ** attempt, 8) if self.min_interval else 0)
        raise RuntimeError(f"Gave up on {url}: {last_err}")


class Adapter(ABC):
    name: str = "adapter"

    @abstractmethod
    def fetch(self) -> tuple[str | None, str]:
        """Return (source_url, raw_text). Raw text is stored separately from normalised records."""

    @abstractmethod
    def extract(self, raw: str) -> list[dict]:
        """Turn raw text into candidate record dicts. Must not trust the content."""


class JsonFeedAdapter(Adapter):
    def __init__(self, name: str, url: str, fetcher: PoliteFetcher):
        self.name, self.url, self.fetcher = name, url, fetcher

    def fetch(self):
        return self.url, self.fetcher.get(self.url)

    def extract(self, raw: str) -> list[dict]:
        data = json.loads(raw)
        return data if isinstance(data, list) else data.get("records", [])


class LocalFileAdapter(Adapter):
    def __init__(self, name: str, path: str):
        self.name, self.path = name, path

    def fetch(self):
        with open(self.path, encoding="utf-8") as f:
            return None, f.read(MAX_BYTES)

    def extract(self, raw: str) -> list[dict]:
        data = json.loads(raw)
        return data if isinstance(data, list) else data.get("records", [])


@dataclass
class Report:
    source: str
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    queued: int = 0
    rejected: int = 0
    errors: list[str] = field(default_factory=list)


def _same(a: CatalogRecord, b: CatalogRecord) -> bool:
    ex = {"updatedAt"}
    return a.model_dump(exclude=ex) == b.model_dump(exclude=ex)


def ingest(store: Store, adapter: Adapter) -> Report:
    rep = Report(adapter.name)
    try:
        url, raw = adapter.fetch()
        store.save_raw(adapter.name, url, raw)
        candidates = adapter.extract(raw)
    except Exception as e:  # source unavailable: log and stop; the app keeps serving existing data
        store.log(adapter.name, "error", f"fetch/extract failed: {e}")
        rep.errors.append(str(e))
        return rep

    for i, cand in enumerate(candidates[:20000]):
        try:
            rec = CatalogRecord.model_validate(cand)
        except (ValidationError, TypeError) as e:
            rep.rejected += 1
            store.log(adapter.name, "warn", f"record {i} rejected: {str(e)[:300]}")
            continue
        existing = store.get(rec.id)
        if existing is None:
            store.put(rec, adapter.name, "create"); rep.added += 1
            continue
        if _same(existing, rec):
            rep.unchanged += 1
            continue
        if record_rank(rec) > record_rank(existing):
            store.enqueue("lower-priority-conflict", rec.id, f"{adapter.name} offers a lower-trust version of {rec.id}; kept the existing one.", rec)
            rep.queued += 1
            continue
        conflicts = [k for k in set(existing.specs) & set(rec.specs) if existing.specs[k].value != rec.specs[k].value]
        if conflicts and existing.verification == "verified":
            store.enqueue("spec-conflict", rec.id, f"Specs differ from the verified record: {', '.join(sorted(conflicts))}", rec)
            rep.queued += 1
            continue
        store.put(rec, adapter.name, "update"); rep.updated += 1
    store.log(adapter.name, "info", f"done: +{rep.added} ~{rep.updated} ={rep.unchanged} queued {rep.queued} rejected {rep.rejected}")
    return rep
