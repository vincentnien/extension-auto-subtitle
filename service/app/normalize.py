"""Cue 正規化 — 與 extension 的 src/doc.js 同款合約：排序、重疊合併、gap-fill、id 連續。"""

GAP_FILL_MAX = 3.0
MIN_DURATION = 0.9


def normalize_cues(cues: list | None) -> list[dict]:
    cleaned = []
    for c in cues or []:
        try:
            start = float(c["start"])
            end = float(c["end"])
        except (KeyError, TypeError, ValueError):
            continue
        text = (c.get("text") or "").strip()
        if end <= start or not text:
            continue
        cleaned.append({"start": start, "end": end, "text": text, "trans": c.get("trans")})
    cleaned.sort(key=lambda c: (c["start"], c["end"]))

    out: list[dict] = []
    for c in cleaned:
        if out and c["start"] < out[-1]["end"] - 0.01:
            if (c["end"] - c["start"]) > (out[-1]["end"] - out[-1]["start"]):
                out[-1] = c
            continue
        out.append(c)

    for i, c in enumerate(out):
        base = max(c["end"], c["start"] + MIN_DURATION)
        if i + 1 < len(out):
            limit = out[i + 1]["start"]
            c["end"] = min(limit, max(base, min(limit, c["end"] + GAP_FILL_MAX)))
        else:
            c["end"] = base
        c["id"] = i
    return out