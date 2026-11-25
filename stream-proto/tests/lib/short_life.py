"""A short life for tests: the same trajectory.json, with only a few events (one of each kind the code has to
handle), so a whole life takes a couple of minutes on the stand-in.  python short_life.py in.json out.json"""
import json, os, sys
KEEP = ["body", "school", "exams", "umbrella", "death"]   # a drawn baby (the avatar takes over), choices, a fluke, the end
if os.environ.get("SHORT_KEEP"): KEEP = os.environ["SHORT_KEEP"].split(",")   # (a test can ask for other events)
d = json.load(open(sys.argv[1], encoding="utf-8"))
by = {e["id"]: e for e in d["events"]}
d["events"] = [by[k] for k in KEEP if k in by]
json.dump(d, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
