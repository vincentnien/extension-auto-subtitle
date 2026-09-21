from app.normalize import normalize_cues


def test_sort_and_ids():
    cues = [
        {"start": 5, "end": 6, "text": "b"},
        {"start": 1, "end": 2, "text": "a"},
    ]
    out = normalize_cues(cues)
    assert [c["text"] for c in out] == ["a", "b"]
    assert [c["id"] for c in out] == [0, 1]


def test_gap_fill_small():
    cues = [
        {"start": 10, "end": 11, "text": "a"},
        {"start": 13, "end": 14, "text": "b"},
    ]
    out = normalize_cues(cues)
    assert out[0]["end"] == 13.0


def test_gap_fill_large():
    cues = [
        {"start": 13, "end": 14, "text": "b"},
        {"start": 20, "end": 21, "text": "c"},
    ]
    out = normalize_cues(cues)
    assert out[0]["end"] == 17.0  # end + 3


def test_min_duration():
    cues = [
        {"start": 20, "end": 20.2, "text": "short"},
        {"start": 30, "end": 31, "text": "next"},
    ]
    out = normalize_cues(cues)
    assert out[0]["end"] == 23.2  # end + 3（gap 大）
    assert out[1]["end"] == 31.0  # 最後一行不延長


def test_overlap_keeps_longer():
    cues = [
        {"start": 1, "end": 5, "text": "long"},
        {"start": 2, "end": 3, "text": "short"},
    ]
    out = normalize_cues(cues)
    assert len(out) == 1
    assert out[0]["text"] == "long"


def test_invalid_dropped():
    cues = [
        {"start": 1, "end": 0, "text": "bad"},
        {"start": 2, "end": 3, "text": "  "},
        {"start": 4, "end": 5, "text": "ok"},
    ]
    out = normalize_cues(cues)
    assert len(out) == 1
    assert out[0]["text"] == "ok"


def test_trans_preserved():
    cues = [{"start": 1, "end": 2, "text": "a", "trans": "譯"}]
    out = normalize_cues(cues)
    assert out[0]["trans"] == "譯"