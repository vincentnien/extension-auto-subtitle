"""Job 狀態機：冪等（同 (videoId, tgtLang) 回同一 job）、事件 fanout、SSE 格式。

狀態在記憶體；companion 重啟後 job 消失，客端重送即可（磁碟快取使重跑便宜）。
"""

import asyncio
import json
import uuid
from dataclasses import dataclass, field

from . import pipeline

JOBS: dict[str, "Job"] = {}
JOB_KEYS: dict[tuple[str, str], str] = {}


@dataclass
class Job:
    id: str
    video_id: str
    url: str
    tgt_lang: str
    stt_model: str | None = None
    status: str = "queued"  # queued | running | done | error | cancelled
    stage: str = ""
    progress: float | None = None
    doc: dict | None = None
    error: str | None = None
    subscribers: list = field(default_factory=list)
    task: asyncio.Task | None = None


def get_or_create(video_id: str, url: str, tgt_lang: str, stt_model: str | None = None) -> tuple[Job, bool]:
    key = (video_id, tgt_lang)
    if key in JOB_KEYS:
        return JOBS[JOB_KEYS[key]], True
    job = Job(
        id=uuid.uuid4().hex[:12],
        video_id=video_id,
        url=url,
        tgt_lang=tgt_lang,
        stt_model=stt_model,
    )
    JOBS[job.id] = job
    JOB_KEYS[key] = job.id
    return job, False


def emit(job: Job, event: str, data: dict) -> None:
    if event == "progress":
        job.status = "running"
        job.stage = data.get("stage", "")
        job.progress = data.get("progress")
    elif event == "done":
        job.status = "done"
        job.progress = 1.0
    elif event == "error":
        job.status = "error"
        job.error = data.get("message")
    for q in list(job.subscribers):
        q.put_nowait((event, data))


def subscribe(job: Job) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    job.subscribers.append(q)
    return q


def unsubscribe(job: Job, q: asyncio.Queue) -> None:
    try:
        job.subscribers.remove(q)
    except ValueError:
        pass


def sse_frame(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def start(job: Job) -> None:
    job.status = "queued"
    job.stage = ""
    job.progress = None
    job.error = None
    job.doc = None
    job.task = asyncio.create_task(_run(job))


async def _run(job: Job) -> None:
    try:
        doc = await pipeline.run(job.video_id, job.url, job.tgt_lang, job.stt_model, lambda e, d: emit(job, e, d))
        job.doc = doc
        emit(job, "done", {"doc": doc})
    except asyncio.CancelledError:
        job.status = "cancelled"
        raise
    except Exception as e:  # noqa: BLE001
        emit(job, "error", {"message": str(e)})


async def cancel(job: Job) -> None:
    if job.task and not job.task.done():
        job.task.cancel()
        try:
            await job.task
        except (asyncio.CancelledError, Exception):
            pass
    job.status = "cancelled"