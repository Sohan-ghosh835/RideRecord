#!/usr/bin/env python3
"""Download one openly licensed photo per catalog bike from Wikimedia Commons.

Run on your own machine (the Claude sandbox cannot reach Wikimedia):
    pip install requests
    python tools/fetch_bike_photos.py            # all bikes
    python tools/fetch_bike_photos.py hunter     # only ids containing "hunter"

Writes web/src/bike-photos/<catalog-id>.jpg and web/src/bike-photos/credits.json
(author, licence, source page). Only CC / public-domain files are kept, so the
credit shown in the app is accurate. Uses the official Commons API (JSON), which is
the sanctioned way to read Commons, so no HTML parsing or robots.txt issues.
Review the pictures afterwards: a text search can return the wrong model.
"""
import json, re, sys, time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "bike-photos"
API = "https://commons.wikimedia.org/w/api.php"
HEAD = {"User-Agent": "RideRecordPhotoFetcher/1.0 (personal project; contact: your-email@example.com)"}
OK_LICENCE = re.compile(r"^(cc[- ]by|cc[- ]by[- ]sa|cc0|public domain|pd)", re.I)
BAD_WORDS = re.compile(r"(interior|engine|dashboard|speedometer|logo|diagram|crash|wreck|cluster|detail|rear view)", re.I)

def clean(t): return re.sub(r"<[^>]+>", "", t or "").strip()

def best(query):
    r = requests.get(API, headers=HEAD, timeout=30, params={
        "action": "query", "format": "json", "generator": "search", "gsrsearch": f"{query} filetype:bitmap",
        "gsrnamespace": 6, "gsrlimit": 15, "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime",
        "iiurlwidth": 900})
    r.raise_for_status()
    pages = (r.json().get("query") or {}).get("pages", {})
    cands = []
    for p in pages.values():
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata", {})
        lic = clean(meta.get("LicenseShortName", {}).get("value"))
        if not OK_LICENCE.match(lic) or ii.get("mime") not in ("image/jpeg", "image/png"): continue
        title = p["title"]
        if BAD_WORDS.search(title) or ii.get("width", 0) < 800: continue
        wide = ii["width"] / max(ii.get("height", 1), 1)
        score = (1 if 1.2 < wide < 2.2 else 0, ii["width"], -p.get("index", 99))
        cands.append((score, title, ii, lic, clean(meta.get("Artist", {}).get("value"))))
    return max(cands, key=lambda c: c[0]) if cands else None

def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    OUT.mkdir(parents=True, exist_ok=True)
    cf = OUT / "credits.json"
    credits = json.loads(cf.read_text()) if cf.exists() else {}
    for line in (ROOT / "tools" / "bikes.txt").read_text().splitlines():
        make, model, _year, _cat, cid = line.split("|")
        if only and only not in cid: continue
        if any((OUT / f"{cid}{e}").exists() for e in (".jpg", ".png", ".webp")):
            print("have ", cid); continue
        name = re.sub(r"\s*\(.*?\)|\bJ-series\b|\bUCE\b|\bGen \d\b", "", f"{make} {model}").strip()
        hit = best(name + " motorcycle") or best(name)
        if not hit: print("MISS ", cid, "->", name); continue
        _, title, ii, lic, artist = hit
        img = requests.get(ii["thumburl"], headers=HEAD, timeout=60); img.raise_for_status()
        (OUT / f"{cid}.jpg").write_bytes(img.content)
        credits[cid] = {"credit": f"Photo: {artist or 'unknown'} / Wikimedia Commons, {lic}", "url": ii["descriptionurl"]}
        print("saved", cid, "<-", title, f"({lic})")
        time.sleep(1.5)  # be polite
    cf.write_text(json.dumps(credits, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
