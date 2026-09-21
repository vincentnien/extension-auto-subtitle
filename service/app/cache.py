import json
import re
from pathlib import Path

from . import config


def _ensure_dirs() -> None:
    for d in (config.AUDIO_DIR, config.CUES_DIR, config.DOCS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", s)


def audio_path(video_id: str, ext: str = "m4a") -> Path:
    _ensure_dirs()
    return config.AUDIO_DIR / f"{video_id}.{ext}"


def cues_path(video_id: str, stt_model: str) -> Path:
    _ensure_dirs()
    return config.CUES_DIR / f"{video_id}.{_safe(stt_model)}.json"


def doc_path(video_id: str, stt_model: str, tgt_lang: str, llm: str) -> Path:
    _ensure_dirs()
    return config.DOCS_DIR / f"{video_id}.{_safe(stt_model)}.{tgt_lang}.{_safe(llm)}.json"


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def find_doc(video_id: str, tgt_lang: str):
    _ensure_dirs()
    for p in sorted(config.DOCS_DIR.glob(f"{video_id}.*.{tgt_lang}.*.json")):
        d = load_json(p)
        if d:
            return d
    return None


def delete_docs(video_id: str) -> int:
    n = 0
    for p in config.DOCS_DIR.glob(f"{video_id}.*.json"):
        p.unlink(missing_ok=True)
        n += 1
    return n


def lru_cleanup(directory: Path, max_bytes: int) -> None:
    files = [p for p in directory.glob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    for p in sorted(files, key=lambda x: x.stat().st_mtime):
        if total <= max_bytes:
            break
        total -= p.stat().st_size
        p.unlink(missing_ok=True)