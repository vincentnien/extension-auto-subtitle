from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_save_and_get_doc(tmp_path):
    doc = {
        "v": 1,
        "videoId": "TEST123",
        "srcLang": "ja",
        "tgtLang": "zh-TW",
        "cues": [{"id": 0, "start": 1.0, "end": 2.0, "text": "t", "trans": "譯"}],
        "meta": {"sttModel": "native", "llm": "gemini-flash-latest"},
    }
    r = client.post("/v1/docs", json={"doc": doc})
    assert r.status_code == 201
    assert "TEST123" in r.json()["saved"]

    r2 = client.get("/v1/docs/TEST123?tgt=zh-TW")
    assert r2.status_code == 200
    assert r2.json()["cues"][0]["trans"] == "譯"

    r3 = client.get("/v1/docs/TEST123?tgt=en")
    assert r3.status_code == 404


def test_save_doc_requires_video_id():
    r = client.post("/v1/docs", json={"doc": {"cues": []}})
    assert r.status_code == 400
