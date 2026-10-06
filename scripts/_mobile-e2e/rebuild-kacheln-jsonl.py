#!/usr/bin/env python3
"""Baut /tmp/kacheln-einzel-results.jsonl aus BELEGTEN Rohdaten neu auf.

Quellen:
  /tmp/db-all.json              -> Projekt-IDs, content_types, created_at, generated_content (letzter Voll-Read)
  /tmp/kacheln-pinterest-db.json, kacheln-etsy-db.json, now-db.json, db-now.json,
  kacheln-ideas-db.json         -> usage_monthly-SNAPSHOT je Stufe (Zählerkette 1..5)
"""
import json, sys

STAGES = [
    ("pinterest", "pinterest_pin", "a2de253e-d07e-4bc4-90ad-930d246494eb", "/tmp/kacheln-pinterest-db.json"),
    ("etsy", "etsy_listing", "6e2b58c1-1de0-440f-9745-6713f05b0f47", "/tmp/kacheln-etsy-db.json"),
    ("social", "social_post", "7e118eea-344a-499a-9dda-7ffea3332d0b", "/tmp/now-db.json"),
    ("marketing", "marketing_plan", "2326722d-6673-4db3-98d5-3a720e8cc7df", "/tmp/db-now.json"),
    ("ideas", "product_idea", "566b1e5a-859c-4ac0-9524-6a87f8976797", "/tmp/kacheln-ideas-db.json"),
]

full = json.load(open("/tmp/db-all.json"))
bym = {p["id"]: p for p in full["projects"]}
cm = {c["projectId"]: c["rows"] for c in full["contents"]}

lines = []
for i, (tile, exp, pid, snapfile) in enumerate(STAGES, start=1):
    p = bym[pid]
    assert p["contentTypes"] == [exp], f"{tile}: {p['contentTypes']} != [{exp}]"
    snap = json.load(open(snapfile))
    rows = snap["usageMonthly"]
    assert len(rows) == 1 and int(rows[0]["count"]) == i, f"{tile}: snapshot {rows} != {i}"
    lines.append({
        "tile": tile, "expected": exp, "generationDone": 1, "projectId": pid,
        "projectContentTypes": p["contentTypes"], "createdAt": p["createdAt"],
        "usageRows": rows, "usageTotal": int(rows[0]["count"]),
        "usageSnapshot": snapfile, "storedRows": cm[pid],
    })

with open("/tmp/kacheln-einzel-results.jsonl", "w") as f:
    for r in lines:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

for r in lines:
    print(r["tile"], r["projectId"][:8], r["projectContentTypes"], "count=" + str(r["usageTotal"]),
          r["storedRows"], r["createdAt"])
print("== JSONL lines:", len(lines))
