"""STT 引擎介面：mlx（Mac GPU）| ct2（CPU fallback）| groq（雲端），自動偵測。

介面：transcribe(audio_path, language?) -> (cues, src_lang)
ct2 串流回傳段落（邊轉邊推）；mlx/groq 為批次。
"""

import asyncio
import threading
from pathlib import Path

import httpx

from .. import config

_MODEL_CACHE: dict = {}


def available_engines() -> dict:
    out = {}
    try:
        import mlx_whisper  # noqa: F401

        out["mlx"] = "ok"
    except Exception:
        out["mlx"] = "not installed"
    try:
        import faster_whisper  # noqa: F401

        out["ct2"] = "ok"
    except Exception:
        out["ct2"] = "not installed"
    out["groq"] = "ok" if config.GROQ_API_KEY else "no api key"
    return out


def pick_engine() -> str:
    avail = available_engines()
    order = [config.STT_ENGINE] if config.STT_ENGINE != "auto" else ["mlx", "ct2", "groq"]
    for name in order:
        if avail.get(name) == "ok":
            return name
    raise RuntimeError(
        "沒有可用的 STT 引擎：安裝 faster-whisper（pip install faster-whisper）、"
        "mlx-whisper（Mac GPU），或設定 GROQ_API_KEY"
    )


def engine_model(name: str) -> str:
    return {
        "mlx": "mlx-community/whisper-large-v3-turbo",
        "ct2": "large-v3-turbo",
        "groq": "whisper-large-v3-turbo",
    }[name]


def resolve_model_name() -> str:
    """實際會用的模型名（含 SUBS_STT_MODEL 覆蓋）— 同時作為快取鍵。"""
    return config.STT_MODEL or engine_model(pick_engine())


async def transcribe(audio_path: str, language: str | None = None, on_partial=None):
    name = pick_engine()
    if name == "ct2":
        return await _ct2(audio_path, language, on_partial)
    if name == "mlx":
        return await _mlx(audio_path, language, on_partial)
    return await _groq(audio_path, language, on_partial)


def _get_ct2_model():
    name = config.STT_MODEL or engine_model("ct2")
    if name not in _MODEL_CACHE:
        from faster_whisper import WhisperModel

        _MODEL_CACHE[name] = WhisperModel(name, device="auto", compute_type="auto")
    return _MODEL_CACHE[name]


def _get_ct2_model():
    name = config.STT_MODEL or engine_model("ct2")
    if name not in _MODEL_CACHE:
        from faster_whisper import WhisperModel

        _MODEL_CACHE[name] = WhisperModel(name, device="auto", compute_type="auto")
    return _MODEL_CACHE[name]


def _refine_with_words(cue: dict, seg) -> dict:
    """用 word-level 時間戳夾緊邊界，避免句尾吃進下一句的音。"""
    words = getattr(seg, "words", None) or []
    if words:
        w0, wN = words[0], words[-1]
        if w0.start is not None:
            cue["start"] = w0.start
        if wN.end is not None:
            cue["end"] = wN.end
    cue["end"] = max(cue["end"], cue["start"] + 0.3)
    return cue


async def _ct2(audio_path: str, language: str | None, on_partial):
    model = _get_ct2_model()
    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def work():
        try:
            segments, info = model.transcribe(
                audio_path, language=language, vad_filter=True, word_timestamps=True
            )
            loop.call_soon_threadsafe(q.put_nowait, ("lang", info.language))
            for seg in segments:
                text = seg.text.strip()
                if text:
                    cue = _refine_with_words(
                        {"start": seg.start, "end": seg.end, "text": text}, seg
                    )
                    loop.call_soon_threadsafe(q.put_nowait, ("seg", cue))
            loop.call_soon_threadsafe(q.put_nowait, ("eof", None))
        except Exception as e:  # noqa: BLE001
            loop.call_soon_threadsafe(q.put_nowait, ("err", e))

    import threading

    threading.Thread(target=work, daemon=True).start()
    cues: list[dict] = []
    lang = None
    buf = 0
    while True:
        kind, payload = await q.get()
        if kind == "seg":
            cues.append(payload)
            buf += 1
            if on_partial and buf >= 10:
                on_partial(list(cues), lang)
                buf = 0
        elif kind == "lang":
            lang = payload
        elif kind == "eof":
            break
        elif kind == "err":
            raise payload
    if on_partial:
        on_partial(list(cues), lang)
    return cues, lang


async def _mlx(audio_path: str, language: str | None, on_partial):
    import mlx_whisper

    model = config.STT_MODEL or engine_model("mlx")

    def work():
        return mlx_whisper.transcribe(audio_path, path_or_hf_repo=model, language=language, word_timestamps=True)

    result = await asyncio.to_thread(work)
    cues = []
    for s in result.get("segments", []):
        text = s.get("text", "").strip()
        if not text:
            continue
        cue = {"start": s["start"], "end": s["end"], "text": text}
        words = s.get("words") or []
        if words:
            w0, wN = words[0], words[-1]
            if w0.get("start") is not None:
                cue["start"] = w0["start"]
            if wN.get("end") is not None:
                cue["end"] = wN["end"]
        cue["end"] = max(cue["end"], cue["start"] + 0.3)
        cues.append(cue)
    lang = result.get("language")
    if on_partial:
        on_partial(cues, lang)
    return cues, lang


async def _groq(audio_path: str, language: str | None, on_partial):
    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    data = {"model": (None, engine_model("groq")), "response_format": (None, "verbose_json")}
    if language:
        data["language"] = (None, language)
    with open(audio_path, "rb") as f:
        files = {"file": (Path(audio_path).name, f)}
        async with httpx.AsyncClient(timeout=600) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
                files=files,
                data=data,
            )
    if r.status_code != 200:
        raise RuntimeError(f"Groq HTTP {r.status_code}: {r.text[:200]}")
    body = r.json()
    cues = [
        {"start": s["start"], "end": s["end"], "text": s["text"].strip()}
        for s in body.get("segments", [])
        if s.get("text", "").strip()
    ]
    if on_partial:
        on_partial(cues, body.get("language"))
    return cues, body.get("language")