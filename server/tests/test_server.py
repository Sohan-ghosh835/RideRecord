import json
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ingest import JsonFeedAdapter, LocalFileAdapter, PoliteFetcher, ingest
from app.schema import CatalogRecord
from app.store import Store

OFFICIAL_SRC = {"kind": "manufacturer", "label": "Official brochure", "url": "https://example.com/b.pdf"}


def rec(**o):
    base = dict(manufacturer="Example Motors", model="Example 125", yearFrom=2024, yearTo=None, category="commuter", fuelType="petrol",
                verification="verified", sources=[OFFICIAL_SRC], specs={"displacement": {"value": 124, "unit": "cc", "verification": "verified", "sourceIndex": 0}})
    base.update(o)
    return base


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "t.sqlite3"))


def write(tmp_path, records, name="feed.json"):
    p = tmp_path / name
    p.write_text(json.dumps({"records": records}))
    return str(p)


def test_validation_sanitises_and_downgrades_unsourced_verified():
    r = CatalogRecord.model_validate(rec(model="  Ex\x00ample   125 ", sources=[{"kind": "third-party", "label": "blog", "url": "javascript:alert(1)"}]))
    assert r.model == "Ex ample 125"  # control character replaced, whitespace collapsed, trimmed
    assert r.sources[0].url is None
    assert r.verification == "estimated"
    assert r.id == "example-motors-ex-ample-125"


def test_ingest_adds_updates_and_is_idempotent(store, tmp_path):
    path = write(tmp_path, [rec()])
    r1 = ingest(store, LocalFileAdapter("feed", path))
    assert (r1.added, r1.updated) == (1, 0)
    r2 = ingest(store, LocalFileAdapter("feed", path))
    assert (r2.added, r2.unchanged) == (0, 1)  # re-running never duplicates
    assert len(store.search("example")) == 1


def test_rejects_invalid_records_without_stopping(store, tmp_path):
    path = write(tmp_path, [rec(), {"manufacturer": "X"}, rec(model="Second", yearFrom=1800)])
    rep = ingest(store, LocalFileAdapter("feed", path))
    assert rep.added == 1 and rep.rejected == 2
    assert any("rejected" in l["message"] for l in store.logs())


def test_lower_priority_source_cannot_overwrite_verified(store, tmp_path):
    ingest(store, LocalFileAdapter("official", write(tmp_path, [rec()])))
    blog = rec(verification="estimated", sources=[{"kind": "third-party", "label": "forum"}], specs={"displacement": {"value": 150, "unit": "cc"}})
    rep = ingest(store, LocalFileAdapter("blog", write(tmp_path, [blog], "b.json")))
    assert rep.queued == 1 and rep.updated == 0
    assert store.get("example-motors-example-125").specs["displacement"].value == 124
    item = store.queue()[0]
    assert item["kind"] == "lower-priority-conflict"
    store.resolve(item["id"], accept=False)
    assert store.get("example-motors-example-125").specs["displacement"].value == 124


def test_verified_conflict_queued_then_accepted_with_history(store, tmp_path):
    ingest(store, LocalFileAdapter("official", write(tmp_path, [rec()])))
    changed = rec(specs={"displacement": {"value": 125, "unit": "cc", "verification": "verified", "sourceIndex": 0}})
    rep = ingest(store, LocalFileAdapter("official2", write(tmp_path, [changed], "c.json")))
    assert rep.queued == 1
    assert store.get("example-motors-example-125").specs["displacement"].value == 124
    assert store.resolve(store.queue()[0]["id"], accept=True)
    assert store.get("example-motors-example-125").specs["displacement"].value == 125
    actions = [h["action"] for h in store.history("example-motors-example-125")]
    assert "review-accepted" in actions and "create" in actions


def test_raw_payload_is_stored_separately_and_deduplicated(store, tmp_path):
    path = write(tmp_path, [rec()])
    ingest(store, LocalFileAdapter("feed", path)); ingest(store, LocalFileAdapter("feed", path))
    assert store._q("SELECT COUNT(*) c FROM raw_sources")[0]["c"] == 1


def test_merge_keeps_old_references_resolving(store, tmp_path):
    ingest(store, LocalFileAdapter("f", write(tmp_path, [rec(), rec(model="Example 125 Dup")])))
    assert store.merge("example-motors-example-125-dup", "example-motors-example-125")
    assert store.get("example-motors-example-125-dup").model == "Example 125"
    assert len(store.search("example")) == 1


def test_search_filters_and_pagination(store, tmp_path):
    recs = [rec(model=f"Model {i}", yearFrom=2000 + i, yearTo=2000 + i) for i in range(10)]
    ingest(store, LocalFileAdapter("f", write(tmp_path, recs)))
    assert len(store.search("", limit=4)) == 4
    assert len(store.search("", limit=4, offset=8)) == 2
    assert [r.model for r in store.search("", year=2003)] == ["Model 3"]
    assert store.coverage()["total"] == 10


def mock_fetcher(handler):
    return PoliteFetcher(min_interval=0, retries=1, client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_fetcher_respects_robots_and_does_not_bypass_blocks(store):
    hits = []

    def handler(req):
        hits.append(str(req.url))
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private/")
        return httpx.Response(200, text="[]")

    f = mock_fetcher(handler)
    assert f.get("https://site.test/public/feed.json") == "[]"
    with pytest.raises(PermissionError):
        f.get("https://site.test/private/feed.json")
    assert not any("/private/feed" in h for h in hits)  # never even requested

    def blocked(req):
        return httpx.Response(403) if req.url.path == "/robots.txt" else httpx.Response(200, text="[]")
    with pytest.raises(PermissionError):
        mock_fetcher(blocked).get("https://locked.test/x.json")

    def paywall(req):
        return httpx.Response(200, text="") if req.url.path == "/robots.txt" else httpx.Response(402)
    n = {"c": 0}
    def counting(req):
        n["c"] += 1 if req.url.path != "/robots.txt" else 0
        return paywall(req)
    with pytest.raises(PermissionError):
        mock_fetcher(counting).get("https://pay.test/x.json")
    assert n["c"] == 1  # not retried


def test_unreachable_source_is_logged_and_existing_data_kept(store, tmp_path):
    ingest(store, LocalFileAdapter("f", write(tmp_path, [rec()])))
    def down(req):
        return httpx.Response(200, text="") if req.url.path == "/robots.txt" else httpx.Response(500)
    rep = ingest(store, JsonFeedAdapter("remote", "https://down.test/feed.json", mock_fetcher(down)))
    assert rep.errors and rep.added == 0
    assert len(store.search("example")) == 1
    assert any(l["level"] == "error" for l in store.logs())


# ---- API
@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import main
    monkeypatch.setenv("CATALOG_DB", str(tmp_path / "api.sqlite3"))
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    monkeypatch.setenv("INGEST_DIR", str(tmp_path))
    main.store.cache_clear()
    yield TestClient(main.app)
    main.store.cache_clear()


def test_api_public_search_and_admin_protection(client, tmp_path):
    (tmp_path / "f.json").write_text(json.dumps({"records": [rec()]}))
    assert client.post("/admin/ingest/file", json={"name": "f", "path": "f.json"}).status_code == 401
    h = {"x-admin-token": "s3cret"}
    assert client.post("/admin/ingest/file", json={"name": "f", "path": "f.json"}, headers=h).json()["added"] == 1
    assert client.post("/admin/ingest/file", json={"name": "f", "path": "../../etc/passwd"}, headers=h).status_code in (400, 404)
    out = client.get("/catalog/search", params={"q": "example 125"}).json()["results"]
    assert out[0]["model"] == "Example 125" and out[0]["verification"] == "verified"
    assert client.get("/catalog/nope").status_code == 404
    assert client.get("/admin/coverage", headers=h).json()["total"] == 1


def test_admin_disabled_without_token(client, monkeypatch):
    monkeypatch.delenv("ADMIN_TOKEN")
    assert client.get("/admin/coverage").status_code == 503
