import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


ACTION = re.compile(r"action-[0-9a-f]{24}\.json\.gz\Z")
CACHE = Path(".spec-cache/formal")


def info(file):
    if file.is_symlink() or not file.is_file():
        raise ValueError(f"Expected a regular action receipt: {file}")
    with file.open("rb") as contents:
        return {"bytes": file.stat().st_size, "sha256": hashlib.file_digest(contents, "sha256").hexdigest()}


def identity():
    source = os.environ["GITHUB_SHA"]
    if subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() != source:
        raise ValueError("This checkout does not match the workflow source")
    assignment = subprocess.check_output(["node", "scripts/precompute-formal-shard.ts", "2", "2", "--list"], text=True)
    return {"source": source, "run": os.environ["GITHUB_RUN_ID"], "attempt": os.environ["GITHUB_RUN_ATTEMPT"], "assignment": json.loads(assignment)}


def stage(destination, before):
    baseline = set(before.read_text().splitlines()) if before else set()
    raw = destination / "raw"
    raw.mkdir(parents=True)
    actions = {}
    for file in sorted(CACHE.iterdir()):
        if ACTION.fullmatch(file.name) and file.name not in baseline:
            actions[file.name] = info(file)
            shutil.copyfile(file, raw / file.name)
    if (not actions and before is None) or any(meta["bytes"] <= 0 for meta in actions.values()):
        raise ValueError("Generation produced no usable formal receipts")
    if not actions:
        raw.rmdir()
    (destination / "manifest.json").write_text(json.dumps({**identity(), "actions": actions}, indent=2) + "\n")
    print(f"Published {len(actions)} formal receipts ({sum(meta['bytes'] for meta in actions.values())} bytes)")


def restore(source):
    manifest_path = source / "manifest.json"
    raw = source / "raw"
    if manifest_path.is_symlink() or not manifest_path.is_file() or raw.is_symlink():
        raise ValueError("Unexpected formal shard bundle")
    manifest = json.loads(manifest_path.read_text())
    if any(manifest.get(key) != value for key, value in identity().items()):
        raise ValueError("Formal shard source, run, attempt or model assignment differs")
    actions = manifest["actions"]
    expected_files = {"manifest.json", "raw"} if actions else {"manifest.json"}
    if not isinstance(actions, dict) or {item.name for item in source.iterdir()} != expected_files:
        raise ValueError("Formal shard action manifest differs from its bundle")
    if actions and {item.name for item in raw.iterdir()} != set(actions):
        raise ValueError("Formal shard action manifest differs from its bundle")
    missing = []
    for name, expected in actions.items():
        if not ACTION.fullmatch(name) or expected["bytes"] <= 0 or info(raw / name) != expected:
            raise ValueError(f"Formal receipt integrity mismatch: {name}")
        local = CACHE / name
        if local.exists() or local.is_symlink():
            if info(local) != expected:
                raise ValueError(f"Local formal receipt differs from the generation shard: {name}")
        else:
            missing.append(name)
    CACHE.mkdir(parents=True, exist_ok=True)
    for name in missing:
        pending = CACHE / f"{name}.incoming"
        shutil.copyfile(raw / name, pending)
        pending.replace(CACHE / name)
    print(f"Verified {len(actions)} current-attempt generation receipts and imported {len(missing)} new ones")


if sys.argv[1] == "stage":
    stage(Path(sys.argv[2]), Path(sys.argv[3]) if len(sys.argv) > 3 else None)
elif sys.argv[1] == "restore":
    restore(Path(sys.argv[2]))
else:
    raise ValueError("Expected stage or restore")
