"""Companion service：路由 + 啟動。全部綁 127.0.0.1；可選 Bearer token。"""

import asyncio
import json

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import cache, config, jobs, pipeline
from .engines import stt

app = FastAPI(title="bilingual-subs companion", version=config.VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://www.youtube.com", "https://m.youtube.com"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


async def auth(authorization: str | None = Header(default=None)) -> None:
    if config.TOKEN and authorization != f"Bearer {config.TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


class JobIn(BaseModel):
    url: str | None = None
    video_id: str | None = None
    tgt_lang: str = "zh-TW"
    src_lang: str | None = None
    stt_model: str | None = None


@app.post("/v1/jobs", status_code=202)
async def create_job(body: JobIn, _=Depends(auth)):
    video_id = body.video_id or (pipeline.extract_video_id(body.url) if body.url else None)
    if not video_id:
        raise HTTPException(status_code=400, detail="需要 video_id 或可解析的 url")
    url = body.url or f"https://www.youtube.com/watch?v={video_id}"
    job, existed = jobs.get_or_create(video_id, url, body.tgt_lang, body.stt_model)
    if not existed and (job.task is None or job.task.done()):
        if job.status not in ("done", "error", "cancelled"):
            await jobs.start(job)
    cached = cache.find_doc(video_id, body.tgt_lang) is not None
    return {"job_id": job.id, "status": job.status, "cache": "hit" if cached else "miss"}


@app.get("/v1/jobs/{job_id}")
async def get_job(job_id: str, _=Depends(auth)):
    job = jobs.JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found（companion 可能重啟過，請重送）")
    return {
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "doc": job.doc,
        "error": job.error,
    }


@app.get("/v1/jobs/{job_id}/events")
async def job_events(job_id: str, _=Depends(auth)):
    job = jobs.JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    async def gen():
        q = jobs.subscribe(job)
        try:
            if job.status == "done" and job.doc:
                yield jobs.sse_frame("done", {"doc": job.doc})
                return
            if job.status == "error" and job.error:
                yield jobs.sse_frame("error", {"message": job.error})
                return
            while True:
                try:
                    event, data = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield jobs.sse_frame(event, data)
                if event in ("done", "error"):
                    return
        finally:
            jobs.unsubscribe(job, q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.delete("/v1/jobs/{job_id}")
async def delete_job(job_id: str, _=Depends(auth)):
    job = jobs.JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    await jobs.cancel(job)
    return {"status": "cancelled"}


@app.get("/v1/docs/{video_id}")
async def get_doc(video_id: str, tgt: str = "zh-TW", _=Depends(auth)):
    doc = cache.find_doc(video_id, tgt)
    if not doc:
        raise HTTPException(status_code=404, detail="doc not found")
    return doc


@app.delete("/v1/docs/{video_id}")
async def delete_doc(video_id: str, _=Depends(auth)):
    return {"deleted": cache.delete_docs(video_id)}


@app.get("/health")
async def health(_=Depends(auth)):
    return {"engines": stt.available_engines(), "version": config.VERSION}


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="info")


if __name__ == "__main__":
    main()