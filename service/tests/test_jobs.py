import asyncio

from app import jobs


def test_get_or_create_idempotent():
    j1, created1 = jobs.get_or_create("vid1", "url1", "zh-TW")
    j2, created2 = jobs.get_or_create("vid1", "url1", "zh-TW")
    assert created1 is False
    assert created2 is True
    assert j1 is j2
    j3, _ = jobs.get_or_create("vid1", "url1", "en")
    assert j3 is not j1  # 不同 tgt_lang = 不同 job


def test_emit_updates_fields_and_fanout():
    job, _ = jobs.get_or_create("vid2", "url2", "zh-TW")
    q = jobs.subscribe(job)
    jobs.emit(job, "progress", {"stage": "transcribing", "progress": 0.5})
    assert job.status == "running"
    assert job.stage == "transcribing"
    assert job.progress == 0.5
    event, data = q.get_nowait()
    assert (event, data) == ("progress", {"stage": "transcribing", "progress": 0.5})
    jobs.emit(job, "done", {"doc": {"cues": []}})
    assert job.status == "done"
    assert job.progress == 1.0
    jobs.unsubscribe(job, q)


def test_sse_frame_format():
    frame = jobs.sse_frame("progress", {"stage": "x", "progress": 0.1})
    assert frame.startswith("event: progress\ndata: ")
    assert frame.endswith("\n\n")


def test_run_error_path():
    from app import pipeline

    async def boom(*a, **k):
        raise RuntimeError("yt-dlp 掛了")

    orig = pipeline.run
    pipeline.run = boom
    try:
        job, _ = jobs.get_or_create("vid3", "url3", "zh-TW")
        asyncio.run(jobs._run(job))
        assert job.status == "error"
        assert "yt-dlp" in job.error
    finally:
        pipeline.run = orig


def test_run_success_sets_doc():
    from app import pipeline

    async def ok(*a, **k):
        return {"v": 1, "cues": []}

    orig = pipeline.run
    pipeline.run = ok
    try:
        job, _ = jobs.get_or_create("vid4", "url4", "zh-TW")
        asyncio.run(jobs._run(job))
        assert job.status == "done"
        assert job.doc == {"v": 1, "cues": []}
    finally:
        pipeline.run = orig