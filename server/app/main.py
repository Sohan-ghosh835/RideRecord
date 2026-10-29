from __future__ import annotations

import hmac
import os
from functools import lru_cache

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .ingest import LocalFileAdapter, ingest
from .schema import CatalogRecord
from .store import Store


@lru_cache
def store() -> Store:
    return Store(os.environ.get("CATALOG_DB", "data/catalog.sqlite3"))


def admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Admin endpoints are disabled unless ADMIN_TOKEN is set. The token lives on the server only."""
    token = os.environ.get("ADMIN_TOKEN")
    if not token:
        raise HTTPException(503, "Admin API is disabled: set ADMIN_TOKEN on the server.")
    if not x_admin_token or not hmac.compare_digest(x_admin_token, token):
        raise HTTPException(401, "Invalid admin token.")


app = FastAPI(title="RideRecord catalog service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/catalog/search")
def search(q: str = "", limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), manufacturer: str | None = None,
           year: int | None = None, category: str | None = None):
    """Local catalog only. Public requests never trigger external fetching."""
    return {"results": [r.model_dump() for r in store().search(q, limit, manufacturer, year, category, offset)]}


@app.get("/catalog/{record_id}")
def get_record(record_id: str):
    r = store().get(record_id)
    if not r:
        raise HTTPException(404, "No such catalog record.")
    return r.model_dump()


@app.get("/admin/coverage", dependencies=[Depends(admin)])
def coverage():
    return store().coverage()


@app.get("/admin/queue", dependencies=[Depends(admin)])
def queue(status: str = "pending"):
    return {"items": store().queue(status)}


class Decision(BaseModel):
    accept: bool


@app.post("/admin/queue/{qid}", dependencies=[Depends(admin)])
def decide(qid: int, d: Decision):
    if not store().resolve(qid, d.accept):
        raise HTTPException(404, "No pending item with that id.")
    return {"ok": True}


class Merge(BaseModel):
    duplicate_id: str
    into_id: str


@app.post("/admin/merge", dependencies=[Depends(admin)])
def merge(m: Merge):
    if not store().merge(m.duplicate_id, m.into_id):
        raise HTTPException(400, "Both records must exist and be different.")
    return {"ok": True}


@app.get("/admin/logs", dependencies=[Depends(admin)])
def logs():
    return {"items": store().logs()}


@app.get("/admin/history/{record_id}", dependencies=[Depends(admin)])
def history(record_id: str):
    return {"items": store().history(record_id)}


class IngestFile(BaseModel):
    name: str
    path: str


@app.post("/admin/ingest/file", dependencies=[Depends(admin)])
def ingest_file(req: IngestFile):
    base = os.path.realpath(os.environ.get("INGEST_DIR", "data/incoming"))
    path = os.path.realpath(os.path.join(base, req.path))
    if not path.startswith(base + os.sep):
        raise HTTPException(400, "Path must be inside INGEST_DIR.")
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found in INGEST_DIR.")
    return ingest(store(), LocalFileAdapter(req.name, path)).__dict__
