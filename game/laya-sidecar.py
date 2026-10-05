"""Laya decision sidecar for Agent Wardrobe games.

Reads one JSON request per line on stdin: {"id": n, "state": "...", "questions": {...}}
Writes protocol lines prefixed with "@laya " on stdout: a ready line, then one answer per request.
Everything runs on this Mac; no network once the weights are cached.
"""
import json
import os
import sys
import time

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
if os.path.isdir(os.path.expanduser("~/.cache/huggingface/hub/models--convaiinnovations--laya/snapshots")):
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

out = sys.stdout
sys.stdout = sys.stderr  # library chatter must never mix with protocol lines


def send(message):
    out.write("@laya " + json.dumps(message) + "\n")
    out.flush()


from laya import Router  # noqa: E402

started = time.perf_counter()
agent = Router().load(sys.argv[1] if len(sys.argv) > 1 else "english")
send({"ready": True, "device": str(agent.device), "load_s": round(time.perf_counter() - started, 1)})
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        t0 = time.perf_counter()
        result = agent.system_one(request["state"], request["questions"])
        send({"id": request["id"], "answers": result["answers"], "ms": round((time.perf_counter() - t0) * 1000, 1)})
    except Exception as error:  # one bad request must not stop the game
        send({"id": request.get("id"), "error": str(error)})
