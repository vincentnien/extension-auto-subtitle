"""Pipeline：resolve → audio(yt-dlp) → STT → normalize → translate → assemble。

每階段冪等、各有磁碟快取鍵：
  docs/{videoId}.{sttModel}.{tgtLang}.{llm}.json   # 最終文件
  cues/{videoId}.{sttModel}.json                   # 原生 cues（換目標語言不用重轉寫）
  audio/{videoId}.m4a                              # 音訊 LRU
"""

import asyncio
import re
from datetime import datetime, timezone

from . import cache, config
from .engines import llm, stt
from .normalize import normalize_cues

_STT_SEMAPHORE = asyncio.Semaphore(1)


def extract_video_id(url: str) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/|/shorts/|/live/|/embed/)([\w-]{6,})", url or "")
    return m.group(1) if m else None


async def ensure_audio(video_id: str, url: str, emit) -> str:
    path = cache.audio_path(video_id)
    if path.exists() and path.stat().st_size > 0:
        return str(path)
    tmp = path.with_suffix(".part.m4a")
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "-f",
        "bestaudio[ext=m4a]/bestaudio",
        "--no-playlist",
        # --newline：進度以獨立行輸出（否則用 \r 連接，整段下載只會在最後收到一次）
        "--newline",
        "--socket-timeout",
        "30",
        *config.YTDLP_EXTRA_ARGS,
        "-o",
        str(tmp),
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    rx = re.compile(r"\[download\]\s+([\d.]+)%")
    tail: list[str] = []
    async for line in proc.stdout:
        s = line.decode(errors="ignore").rstrip()
        tail.append(s)
        if len(tail) > 20:
            tail.pop(0)
        matches = rx.findall(s)
        if matches:
            emit("progress", {"stage": "downloading", "progress": float(matches[-1]) / 100})
    rc = await proc.wait()
    if rc != 0 or not tmp.exists():
        raise RuntimeError(
            f"yt-dlp 下載失敗（exit {rc}）最後輸出：\n" + "\n".join(tail[-5:]) +
            "\n— 可能是直播/私人/地區限制/bot 偵測；先試 pip install -U yt-dlp"
        )
    tmp.replace(path)
    cache.lru_cleanup(config.AUDIO_DIR, int(config.AUDIO_MAX_GB * 1024**3))
    return str(path)


async def run(video_id: str, url: str, tgt_lang: str, stt_model: str | None = None, emit=None) -> dict:
    emit = emit or (lambda event, data: None)
    llm_name = config.LLM_MODEL
    stt_name = stt_model or stt.resolve_model_name()

    doc = cache.load_json(cache.doc_path(video_id, stt_name, tgt_lang, llm_name))
    if doc:
        emit("progress", {"stage": "cache", "progress": 1.0})
        return doc

    saved = cache.load_json(cache.cues_path(video_id, stt_name))
    if saved and saved.get("cues"):
        cues = normalize_cues(saved["cues"])
        src_lang = saved.get("srcLang") or ""
    else:
        audio = await ensure_audio(video_id, url, emit)

        def on_partial(raw_cues, lang):
            emit("partial-doc", {"srcLang": lang or "", "cues": normalize_cues(raw_cues)})

        async with _STT_SEMAPHORE:
            emit("progress", {"stage": "transcribing", "progress": None})
            raw, src_lang = await stt.transcribe(
                audio,
                None,
                on_partial,
                on_progress=lambda p: emit("progress", {"stage": "transcribing", "progress": p}),
            )
        cues = normalize_cues(raw)
        cache.save_json(cache.cues_path(video_id, stt_name), {"srcLang": src_lang, "cues": cues})
        src_lang = src_lang or ""

    if not config.GEMINI_API_KEY:
        emit("progress", {"stage": "translating", "progress": None})
    else:
        emit("progress", {"stage": "translating", "progress": 0.0})
        await llm.translate_cues(
            cues, tgt_lang, on_progress=lambda p: emit("progress", {"stage": "translating", "progress": p})
        )
    doc = {
        "v": 1,
        "videoId": video_id,
        "srcLang": src_lang,
        "tgtLang": tgt_lang,
        "cues": cues,
        "meta": {
            "sttModel": stt_name,
            "llm": llm_name,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        },
    }
    cache.save_json(cache.doc_path(video_id, stt_name, tgt_lang, llm_name), doc)
    return doc


async def run_url(url: str, tgt_lang: str) -> dict:
    video_id = extract_video_id(url)
    if not video_id:
        raise RuntimeError(f"無法從 URL 解析 videoId：{url}")
    return await run(video_id, url, tgt_lang)