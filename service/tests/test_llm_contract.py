import asyncio

from app.engines import llm


def test_parse_id_map_normal():
    m = llm.parse_id_map('{"1": "譯一", "2": "譯二"}', [1, 2])
    assert m == {1: "譯一", 2: "譯二"}


def test_parse_id_map_wrapped_in_prose():
    m = llm.parse_id_map('結果如下：{"1": "譯"} 以上。', [1])
    assert m == {1: "譯"}


def test_parse_id_map_bad_json():
    assert llm.parse_id_map("完全不是 JSON", [1]) == {}


def test_parse_id_map_missing_and_extra():
    m = llm.parse_id_map('{"1": "譯", "99": "多餘"}', [1, 2])
    assert m == {1: "譯"}


def test_parse_id_map_non_string_ignored():
    m = llm.parse_id_map('{"1": 123, "2": "ok"}', [1, 2])
    assert m == {2: "ok"}


def test_translate_missing_retry_then_fill():
    calls = []

    async def fake(items, ctx, tgt):
        calls.append(set(items))
        if len(calls) == 1:
            return {k: v + "譯" for k, v in items.items() if k != 2}
        return {k: v + "譯" for k, v in items.items()}

    cues = [{"id": i, "start": i, "end": i + 1, "text": f"t{i}", "trans": None} for i in range(3)]
    import asyncio

    asyncio.run(llm.translate_cues(cues, "zh-TW", translate_fn=fake))
    assert [c["trans"] for c in cues] == ["t0譯", "t1譯", "t2譯"]
    assert len(calls) == 2  # 第一次缺行 → 只對缺行重試


def test_translate_still_missing_gives_null():
    async def fake(items, ctx, tgt):
        return {k: v + "譯" for k, v in items.items() if k != 2}

    cues = [{"id": i, "start": i, "end": i + 1, "text": f"t{i}", "trans": None} for i in range(3)]
    asyncio.run(llm.translate_cues(cues, "zh-TW", translate_fn=fake))
    assert cues[0]["trans"] == "t0譯"
    assert cues[1]["trans"] == "t1譯"
    assert cues[2]["trans"] is None  # 單行降級，不位移


def test_translate_error_propagates():
    async def fake(items, ctx, tgt):
        raise RuntimeError("boom")

    cues = [{"id": 0, "start": 0, "end": 1, "text": "t", "trans": None}]
    try:
        asyncio.run(llm.translate_cues(cues, "zh-TW", translate_fn=fake))
        assert False, "should raise"
    except RuntimeError as e:
        assert "boom" in str(e)