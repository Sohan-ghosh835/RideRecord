"""Catalog record validation. External content is untrusted: everything is validated and sanitised before storage."""
from __future__ import annotations

import re
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

Category = Literal["commuter", "scooter", "moped", "sport", "naked", "cruiser", "adventure", "touring", "dirt",
                   "dual-sport", "electric-scooter", "electric-motorcycle", "other"]
FuelType = Literal["petrol", "electric", "diesel", "cng", "hybrid", "other"]
Verification = Literal["verified", "seed-unverified", "estimated", "user-entered"]
SourceKind = Literal["manufacturer", "manual", "distributor", "third-party", "seed", "user"]
OFFICIAL = {"manufacturer", "manual", "distributor"}
SPEC_KEYS = {"displacement", "power", "torque", "tank", "battery", "range", "chargeTime", "kerbWeight", "seatHeight",
             "wheelbase", "groundClearance", "claimedEfficiency", "frontTyre", "rearTyre", "brakes", "abs",
             "suspension", "transmission", "topSpeed", "warranty"}

_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def clean(s: str | None, n: int = 200) -> str | None:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", _CTRL.sub(" ", s)).strip()[:n]
    return s or None


def slug(*parts: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", "-".join(p or "" for p in parts).lower()).strip("-")


class Source(BaseModel):
    kind: SourceKind = "third-party"
    label: str = Field(max_length=160)
    url: Optional[str] = None
    retrieved: Optional[str] = None

    @field_validator("label")
    @classmethod
    def _label(cls, v: str) -> str:
        v = clean(v, 160)
        if not v:
            raise ValueError("source label required")
        return v

    @field_validator("url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        if not v:
            return None
        return v if urlparse(v).scheme in {"http", "https"} else None  # drops javascript:, data:, file: …


class SpecValue(BaseModel):
    value: float | str
    unit: Optional[str] = None
    original: Optional[str] = None
    verification: Verification = "estimated"
    sourceIndex: Optional[int] = None

    @field_validator("value")
    @classmethod
    def _v(cls, v):
        return clean(v, 120) if isinstance(v, str) else v


class CatalogRecord(BaseModel):
    id: str = ""
    manufacturer: str
    model: str
    family: Optional[str] = None
    aliases: list[str] = []
    generation: Optional[str] = None
    variants: Optional[list[str]] = None
    yearFrom: int = Field(ge=1900, le=2100)
    yearTo: Optional[int] = Field(default=None, ge=1900, le=2100)
    market: str = "GLOBAL"
    category: Category
    fuelType: FuelType
    drive: Literal["chain", "belt", "shaft", "electric", "unknown"] = "unknown"
    cooling: Literal["air", "oil", "liquid", "unknown"] = "unknown"
    status: Literal["current", "discontinued", "historical"] = "current"
    specs: dict[str, SpecValue] = {}
    verification: Verification = "estimated"
    sources: list[Source] = []
    updatedAt: str = ""

    @field_validator("manufacturer", "model")
    @classmethod
    def _req(cls, v: str) -> str:
        v = clean(v, 80)
        if not v:
            raise ValueError("required")
        return v

    @field_validator("aliases")
    @classmethod
    def _al(cls, v: list[str]) -> list[str]:
        return [a for a in (clean(x, 60) for x in v[:20]) if a]

    @model_validator(mode="after")
    def _finish(self) -> "CatalogRecord":
        if self.yearTo is not None and self.yearTo < self.yearFrom:
            raise ValueError("yearTo must be >= yearFrom")
        self.specs = {k: v for k, v in self.specs.items() if k in SPEC_KEYS}
        for sv in self.specs.values():
            if sv.sourceIndex is not None and not (0 <= sv.sourceIndex < len(self.sources)):
                sv.sourceIndex = None
        # "verified" is only allowed with an official source attached
        if self.verification == "verified" and not any(s.kind in OFFICIAL for s in self.sources):
            self.verification = "estimated"
        if not self.id:
            self.id = slug(self.manufacturer, self.model, self.generation)
        else:
            self.id = slug(self.id)
        if self.yearTo is None:
            self.status = "current" if self.status == "historical" else self.status
        return self


def normalize_text(s: str) -> str:
    s = re.sub(r"[''`]", "", s.lower())
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9.+ ]+", " ", s)).strip()
