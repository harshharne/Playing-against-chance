"""The files the game reads: every Python file compiles, every JSON parses, and what the code relies on is there.
python3 tests/unit/check_files.py   (exit code 1 on any problem)"""
import json, os, py_compile, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)
bad = []
def need(ok, what):
    if not ok: bad.append(what)
for f in sorted(os.listdir(ROOT)):
    if f.endswith(".py"):
        try: py_compile.compile(os.path.join(ROOT, f), doraise=True)
        except py_compile.PyCompileError as e: bad.append(f"{f} doesn't compile: {e.msg[:200]}")
docs = {}
for f in ("trajectory.json", "styles.json", "director.json", "bookkeeper.json", "web/sounds/manifest.json"):
    try: docs[f] = json.load(open(os.path.join(ROOT, f), encoding="utf-8"))
    except Exception as e: bad.append(f"{f} doesn't parse: {e}")
t = docs.get("trajectory.json") or {}
ids = [e.get("id") for e in t.get("events", [])]
need(len(ids) == len(set(ids)), "trajectory.json: two events share an id")
for e in t.get("events", []):
    for k in ("id", "title", "type", "age", "scene"):
        need(k in e, f"trajectory.json: event {e.get('id')} has no {k}")
    need(e.get("type") in ("chosen", "happens", "fluke"), f"trajectory.json: event {e.get('id')} has an unknown type {e.get('type')}")
    if e.get("type") == "chosen":
        need(len(e.get("cards") or []) >= 2, f"trajectory.json: {e.get('id')} has fewer than two cards")
    need(isinstance(e.get("objects", []), list) and isinstance(e.get("people", []), list), f"trajectory.json: {e.get('id')} objects/people aren't lists")
where = next((e for e in t.get("events", []) if e.get("id") == "where"), None)
if where:
    for c in where.get("cards", []):
        need(c.get("heritage"), f"trajectory.json: Where card {c.get('name')} has no heritage (the face needs it)")
        need(c.get("place"), f"trajectory.json: Where card {c.get('name')} has no place")
cx = t.get("context", {})
for k in ("light", "intrusions", "weather"):
    need(k in cx, f"trajectory.json: context has no {k}")
for k in ("shot_min", "shot_max"):
    need(k in t.get("pacing", {}), f"trajectory.json: pacing has no {k}")
st = docs.get("styles.json") or {}
need("painterly" in st and "mine" in st, "styles.json: needs painterly and mine")
try:
    import director
    def strict(s, path="tool"):
        if s.get("type") == "object":
            need(set(s.get("required", [])) == set(s.get("properties", {})), f"director schema {path}: every property must be required")
            need(s.get("additionalProperties") is False, f"director schema {path}: additionalProperties must be false")
            for k, v in s.get("properties", {}).items(): strict(v, path + "." + k)
        if s.get("type") == "array": strict(s.get("items", {}), path + "[]")
    strict(director.TOOL["input_schema"])
except Exception as e:
    bad.append(f"director.py: {type(e).__name__}: {e}")
if bad:
    print("FAIL files"); [print("   x " + b) for b in bad]; sys.exit(1)
print(f"PASS files ({len(ids)} events, {len(st) - 1} looks, Python and JSON all fine)")
