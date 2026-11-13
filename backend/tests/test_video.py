"""Offline tests for the video audit: no network, no API key, no database, no FFmpeg.

Run from the backend folder:
    python -m tests.test_video

A small local HTTP server stands in for the Gemini API (Files API upload, polling, generateContent).
"""
import json
import os
import struct
import sys
import tempfile
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"

try:  # the database driver is not needed offline
    import psycopg2  # noqa: F401
except ImportError:
    stub = types.ModuleType("psycopg2")
    stub.extras = types.ModuleType("psycopg2.extras")
    sys.modules["psycopg2"], sys.modules["psycopg2.extras"] = stub, stub.extras

import config  # noqa: E402

config.DATABASE_URL = config.DB_HOST = config.DB_PASSWORD = ""
config.GOOGLE_API_KEY = "test-key"
config.GROQ_API_KEY = ""  # backup engine off unless a test turns it on
config.VIDEO_ENGINE = "auto"
config.GROQ_VISION_MODELS = ["vision-a", "vision-b"]
config.GROQ_MODELS = ["text-a"]
config.VIDEO_MODELS = ["model-a", "model-b"]
config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODELS = "model-b", []

import video_service as vs  # noqa: E402

POLICY = """[Page 1]
Brand name: NexusMobile. Motto: "Connect with confidence".
Brand colours: primary #1E3A8A (navy), accent #F59E0B (amber).
Never use the word "cheap"; use "affordable" instead.
Tone must be professional and calm. No loud or aggressive music.
[Page 2]
Battery capacity of the N5 handset is 5000 mAh.
"""


def box(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I4s", len(body) + 8, kind) + body


def make_mp4(seconds: float, version: int = 0, brand: bytes = b"isom") -> str:
    """A minimal MP4: ftyp + mdat + moov/mvhd (moov at the end, like many phone recordings)."""
    timescale = 1000
    if version == 1:
        mvhd = struct.pack(">B3xQQIQ", 1, 0, 0, timescale, int(seconds * timescale))
    else:
        mvhd = struct.pack(">B3xIIII", 0, 0, 0, timescale, int(seconds * timescale))
    data = box(b"ftyp", brand + b"\x00\x00\x02\x00") + box(b"mdat", b"\x00" * 2048) + box(b"moov", box(b"mvhd", mvhd + b"\x00" * 80))
    fd, path = tempfile.mkstemp(suffix=".mp4")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return path


CANNED = {
    "summary": "A phone advert that calls the handset cheap and states the wrong battery size.",
    "overall_tone": "Promotional",
    "tone_score": 5,
    "transcript": "The cheap phone with a 6000 mAh battery. Connect with confidence.",
    "audio": {"has_speech": True, "has_music": True, "description": "Loud electronic music under a fast voice-over."},
    "on_screen_text": [{"start": "00:01", "end": "00:04", "text": "CHEAP PHONE"}, {"start": 9, "end": 12, "text": "Connect with confidence"}],
    "colours": [{"hex": "#1e3a8a", "name": "navy", "share": 55}, {"hex": "not-a-colour", "share": 10}, {"hex": "FF0000", "name": "red", "share": 20}],
    "objects": ["phone", "presenter"],
    "events": [
        {"start": "00:01", "end": "00:04", "aspect": "text", "observed": "CHEAP PHONE", "verdict": "CONTRADICTED", "severity": "medium",
         "explanation": "Uses a banned word.", "policy_reference": "p.1 L3", "policy_quote": 'Never use the word "cheap"; use "affordable" instead.',
         "recommendation": 'Say "affordable phone".'},
        {"start": 2, "end": 4.5, "aspect": "On-screen text", "observed": "cheap phone", "verdict": "Contradicted", "severity": "medium",
         "explanation": "Duplicate of the first event.", "policy_reference": "p.1 L3", "policy_quote": "Never use the word cheap"},
        {"start": 5, "end": 7, "aspect": "claim", "observed": "6000 mAh battery", "verdict": "CONTRADICTED", "severity": "medium",
         "explanation": "Policy states 5000 mAh.", "policy_reference": "p.2 L1", "policy_quote": "Battery capacity of the N5 handset is 5000 mAh."},
        {"start": 0, "end": 99, "aspect": "colour", "observed": "Navy blue background throughout", "verdict": "VERIFIED", "severity": "none",
         "explanation": "Matches the primary brand colour.", "policy_reference": "p.1 L2", "policy_quote": "primary #1E3A8A (navy)"},
        {"start": 0, "end": 15, "aspect": "audio", "observed": "Loud electronic music", "verdict": "CONTRADICTED", "severity": "low",
         "explanation": "Music is loud.", "policy_reference": "p.1 L4", "policy_quote": "No loud or aggressive music."},
        {"start": 8, "end": 8.2, "aspect": "visual", "observed": "A competitor's phone is shown broken", "verdict": "CONTRADICTED", "severity": "medium",
         "explanation": "Disparages a competitor.", "policy_reference": "", "policy_quote": "Do not disparage competitors"},
        {"start": 12, "end": 13, "aspect": "privacy", "observed": "Phone number 98765 43210 on screen", "verdict": "CONTRADICTED", "severity": "medium",
         "explanation": "Personal phone number visible.", "policy_reference": "UNIVERSAL", "policy_quote": ""},
        {"start": 10, "end": 12, "aspect": "tone", "observed": "Best phone ever made", "verdict": "UNVERIFIED", "severity": "low",
         "explanation": "Superlative with no source."},
        {"aspect": "text", "observed": "", "verdict": "CONTRADICTED"},
    ],
}


def test_duration_and_format():
    for version in (0, 1):
        p = make_mp4(14.5, version)
        assert vs.sniff_mime(p) == "video/mp4"
        assert abs(vs.probe_duration(p) - 14.5) < 0.01
        assert vs.check_duration(p, client_duration="3") == 14.5  # the file wins over the browser's number
        os.remove(p)
    mov = make_mp4(5, brand=b"qt  ")
    assert vs.sniff_mime(mov) == "video/mov"
    os.remove(mov)

    long = make_mp4(31)
    try:
        vs.check_duration(long)
        raise AssertionError("a 31 s clip must be rejected")
    except vs.VideoError as exc:
        assert "20 seconds" in str(exc)
    os.remove(long)

    fd, junk = tempfile.mkstemp()
    os.write(fd, b"this is not a video at all")
    os.close(fd)
    try:
        vs.sniff_mime(junk)
        raise AssertionError("a text file must be rejected")
    except vs.VideoError as exc:
        assert exc.status == 415
    os.remove(junk)

    # WebM: no mvhd box, so the browser-measured length is used
    fd, webm = tempfile.mkstemp()
    os.write(fd, b"\x1a\x45\xdf\xa3" + b"\x00" * 64)
    os.close(fd)
    assert vs.sniff_mime(webm) == "video/webm"
    assert vs.check_duration(webm, client_duration="12.4") == 12.4
    os.remove(webm)


def test_aggregator():
    name, context, index = vs.build_policy(POLICY, "Brand policy.pdf")
    assert "[p.1 L3]" in context and "[p.2 L1]" in context
    out = vs.aggregate(CANNED, 15.0, index, name)
    f = {x["claim_text"]: x for x in out["findings"]}

    assert len(out["findings"]) == 7, [x["claim_text"] for x in out["findings"]]  # duplicate merged, empty dropped
    cheap = f["CHEAP PHONE"]
    assert cheap["verdict"] == "CONTRADICTED" and (cheap["start"], cheap["end"]) == (1.0, 4.5)  # merged span
    assert cheap["policy_ref"]["page"] == 1 and cheap["policy_ref"]["line"] == 3 and cheap["policy_ref"]["verified"]
    assert cheap["timestamp"] == "0:01 - 0:04" and cheap["category"] == "Text in video"

    battery = f["6000 mAh battery"]
    assert battery["policy_ref"]["page"] == 2 and battery["policy_ref"]["line"] == 1

    colour = f["Navy blue background throughout"]
    assert colour["verdict"] == "VERIFIED" and colour["severity"] == "none" and colour["end"] == 15.0  # clamped to the clip
    assert colour["recommendation"] == ""

    # contradicted without a real policy line -> downgraded, never an invented citation
    comp = f["A competitor's phone is shown broken"]
    assert comp["verdict"] == "UNVERIFIED" and comp["policy_ref"] is None
    assert comp["end"] - comp["start"] >= 0.9  # a moment still gets a visible width

    # universal safety rule stays contradicted and is always high severity
    pii = f["Phone number 98765 43210 on screen"]
    assert pii["verdict"] == "CONTRADICTED" and pii["severity"] == "high" and pii["source_reference"] == vs.UNIVERSAL

    assert [x["start"] for x in out["findings"]] == sorted(x["start"] for x in out["findings"])
    assert out["colours"] == [{"hex": "#1E3A8A", "name": "navy", "share": 55}, {"hex": "#FF0000", "name": "red", "share": 20}]
    assert out["on_screen_text"][0] == {"start": 1.0, "end": 4.0, "text": "CHEAP PHONE"}
    assert out["audio"]["has_music"] and out["tone_score"] == 5

    # junk replies never crash the aggregator
    empty = vs.aggregate({"events": "nope", "colours": None}, 10, index, name)
    assert empty["findings"] == [] and empty["summary"]
    assert vs.aggregate(None, 10, [], "x")["findings"] == []


def test_analyse_with_fake_model():
    path = make_mp4(15)
    calls, stages = [], []

    def fake(model, part, system, user):
        calls.append(model)
        if model == "model-a":
            raise vs.GeminiError(503, "The model is overloaded")
        assert "[p.1 L3]" in system and "15 seconds long" in system and "My advert" in user
        return CANNED

    r = vs.analyse(path, title="My advert", policy_text=POLICY, policy_name="Brand policy.pdf", progress=stages.append,
                   generate_fn=fake, log_to_db=False)
    os.remove(path)
    assert calls == ["model-a", "model-b"] and r["model"].startswith("model-b")
    assert stages == ["validating", "uploading", "analysing", "aggregating"]
    assert r["counts"] == {"VERIFIED": 1, "UNVERIFIED": 2, "CONTRADICTED": 4}
    assert r["risk_level"] == "HIGH" and not r["is_compliant"] and r["duration"] == 15.0
    assert r["sections"]["logo"]["count"] == 1 or r["sections"]["other"]["count"] >= 1
    assert r["sections"]["privacy"]["level"] == "HIGH"
    assert r["aspects"]["text"] == 1 and r["aspects"]["privacy"] == 1
    json.dumps(r)  # the whole result must be JSON-serialisable

    # every model failing gives one clear error
    path = make_mp4(15)
    try:
        vs.analyse(path, generate_fn=lambda *a: (_ for _ in ()).throw(vs.GeminiError(429, "quota")), log_to_db=False, retry_wait=0)
        raise AssertionError("expected VideoError")
    except vs.VideoError as exc:
        assert exc.status == 503 and "model-a: quota" in str(exc)
    os.remove(path)


class FakeGemini(BaseHTTPRequestHandler):
    """Just enough of the Gemini REST API: resumable upload, file state polling, generateContent."""

    log = []
    polls = 0
    reject_generation_config = False
    gemini_down = False
    groq_reject_json = False
    no_speech = False

    def log_message(self, *args):
        pass

    def _json(self, code, obj, headers=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        cls = FakeGemini
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path.startswith("/openai/"):
            # each provider only ever sees its own key
            assert self.headers.get("Authorization") == "Bearer groq-key" and not self.headers.get("x-goog-api-key")
            if self.path.endswith("/audio/transcriptions"):
                assert b'name="model"' in raw and b"whisper-large-v3-turbo" in raw and b'filename="clip.mp4"' in raw
                cls.log.append(("transcribe", b"ftyp" in raw and b"mvhd" in raw))  # the real clip bytes arrived
                if cls.no_speech:
                    return self._json(400, {"error": {"message": "no audio track found"}})
                return self._json(200, {"text": "ignored", "segments": [
                    {"start": 1.04, "end": 4.2, "text": " The cheap phone with a 6000 mAh battery."},
                    {"start": 9.0, "end": 11.5, "text": " Connect with confidence."},
                    {"start": 12.0, "end": 13.0, "text": " ...", "no_speech_prob": 0.95}]})
            body = json.loads(raw)
            content = body["messages"][1]["content"]
            images = [c for c in content if c["type"] == "image_url"] if isinstance(content, list) else []
            text = content if isinstance(content, str) else content[0]["text"]
            cls.log.append(("chat", body["model"], len(images), "response_format" in body, text, body["messages"][0]["content"], [i["image_url"]["url"][:22] for i in images]))
            if body["model"] == "vision-a":
                return self._json(429, {"error": {"message": "Rate limit reached"}})
            if cls.groq_reject_json and "response_format" in body:
                return self._json(400, {"error": {"message": "json mode is not supported with images"}})
            assert "BACKUP MODE" in body["messages"][0]["content"] and "[p.1 L3]" in body["messages"][0]["content"]
            return self._json(200, {"choices": [{"message": {"content": "<think>hmm</think>" + json.dumps(CANNED)}}]})
        assert self.headers.get("x-goog-api-key") == "test-key" and not self.headers.get("Authorization")
        base = f"http://127.0.0.1:{self.server.server_port}"
        if self.path == "/upload/v1beta/files":
            assert self.headers["X-Goog-Upload-Command"] == "start"
            cls.log.append(("start", int(self.headers["X-Goog-Upload-Header-Content-Length"]), self.headers["X-Goog-Upload-Header-Content-Type"]))
            return self._json(200, {}, {"x-goog-upload-url": f"{base}/upload-session/1"})
        if self.path == "/upload-session/1":
            assert self.headers["X-Goog-Upload-Command"] == "upload, finalize"
            cls.log.append(("bytes", len(raw)))
            return self._json(200, {"file": {"name": "files/abc", "uri": f"{base}/v1beta/files/abc", "state": "PROCESSING"}})
        if self.path.endswith(":generateContent"):
            body = json.loads(raw)
            model = self.path.split("/models/")[1].split(":")[0]
            parts = body["contents"][0]["parts"]
            cls.log.append(("generate", model, "generationConfig" in body, list(parts[0]), [list(x)[0] for x in parts], body["system_instruction"]["parts"][0]["text"]))
            if model == "model-a" or cls.gemini_down:
                return self._json(503, {"error": {"message": "The model is overloaded. Please try again later."}})
            if cls.reject_generation_config and "generationConfig" in body:
                return self._json(400, {"error": {"message": "Unknown field in generation config"}})
            text = "```json\n" + json.dumps(CANNED) + "\n```"
            return self._json(200, {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True}, {"text": text}]}}]})
        self._json(404, {"error": {"message": "not found"}})

    def do_GET(self):
        cls = FakeGemini
        if self.path == "/openai/v1/models":
            return self._json(200, {"data": [{"id": "vision-a"}, {"id": "vision-b"}, {"id": "text-a"}, {"id": "whisper-large-v3-turbo"}]})
        cls.polls += 1
        self._json(200, {"name": "files/abc", "state": "ACTIVE" if cls.polls >= 1 else "PROCESSING"})

    def do_DELETE(self):
        FakeGemini.log.append(("delete", self.path))
        self._json(200, {})


def _serve():
    server = HTTPServer(("127.0.0.1", 0), FakeGemini)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    config.GEMINI_API_BASE = config.GROQ_API_BASE = f"http://127.0.0.1:{server.server_port}"
    return server


def test_gemini_rest_inline_and_files_api():
    server = _serve()
    try:
        # small clip -> inline; model-a is overloaded -> model-b answers; fenced JSON + thought part are handled
        FakeGemini.log.clear()
        path = make_mp4(12)
        r = vs.analyse(path, title="Inline", policy_text=POLICY, policy_name="Brand policy.pdf", log_to_db=False)
        os.remove(path)
        assert [x[0] for x in FakeGemini.log] == ["generate", "generate"]
        assert FakeGemini.log[1][1:4] == ("model-b", True, ["inline_data"]) and "BRAND KIT" not in FakeGemini.log[1][5]
        assert r["counts"]["CONTRADICTED"] == 4 and r["model"] == "model-b · Gemini"

        # larger than the inline limit -> streamed to the Files API, polled, used by URI, then deleted
        FakeGemini.log.clear()
        FakeGemini.polls = 0
        FakeGemini.reject_generation_config = True
        config.VIDEO_INLINE_MAX_BYTES = 100
        path = make_mp4(18)
        size = os.path.getsize(path)
        stages = []
        r = vs.analyse(path, title="Big", policy_text=POLICY, progress=stages.append, log_to_db=False)
        os.remove(path)
        kinds = [x[0] for x in FakeGemini.log]
        assert kinds == ["start", "bytes", "generate", "generate", "generate", "delete"], kinds
        assert FakeGemini.log[0] == ("start", size, "video/mp4") and FakeGemini.log[1] == ("bytes", size)
        # model-b first rejects the generation settings (400), then answers the plain request
        assert FakeGemini.log[3][1:3] == ("model-b", True) and FakeGemini.log[4][1:4] == ("model-b", False, ["file_data"])
        assert "processing" in stages and r["duration"] == 18.0
    finally:
        FakeGemini.reject_generation_config = False
        config.VIDEO_INLINE_MAX_BYTES = 8 * 1024 * 1024
        server.shutdown()


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 400  # stands in for a contact sheet


def test_backup_engine_when_gemini_is_busy():
    """The exact failure from production: every Gemini model answers 'high demand'."""
    server = _serve()
    config.GROQ_API_KEY = "groq-key"
    FakeGemini.gemini_down = True
    try:
        FakeGemini.log.clear()
        path = make_mp4(15)
        stages = []
        r = vs.analyse(path, title="Busy day", policy_text=POLICY, policy_name="Brand policy.pdf", progress=stages.append, log_to_db=False,
                       frames=[JPEG, JPEG, JPEG], frame_times=[[0.6, 4.4, 8.1, 11.9], [1.9, 5.6, 9.4, 13.1], [3.1, 6.9, 10.6, 14.4]])
        kinds = [x[0] for x in FakeGemini.log]
        assert kinds == ["generate", "generate", "transcribe", "chat", "chat"], kinds  # 2 Gemini models busy -> backup
        assert FakeGemini.log[2] == ("transcribe", True)
        assert FakeGemini.log[3][1:3] == ("vision-a", 3) and FakeGemini.log[4][1:4] == ("vision-b", 3, True)  # rate-limited -> next model
        prompt = FakeGemini.log[4][4]
        assert "Sheet 2 tiles, left to right then top to bottom: 1.9s, 5.6s, 9.4s, 13.1s" in prompt
        assert "[1s - 4.2s] The cheap phone with a 6000 mAh battery." in prompt and "..." not in prompt.split("SPEECH TRANSCRIPT")[1].split("Audit")[0]
        assert "backup" in stages and r["engine"] == "groq" and "Gemini was busy" in r["engine_notes"][0]
        assert r["model"] == "vision-b · Groq backup (12 frames + transcript)"
        # non-speech audio cannot be judged from frames: the audio event is dropped, the rest is kept and cited
        assert r["aspects"]["audio"] == 0 and r["counts"]["CONTRADICTED"] == 3 and r["risk_level"] == "HIGH"
        assert r["transcript"] == "The cheap phone with a 6000 mAh battery. Connect with confidence."
        assert r["audio"]["has_speech"] and not r["audio"]["has_music"]
        assert next(f for f in r["findings"] if f["claim_text"] == "CHEAP PHONE")["policy_ref"]["line"] == 3
        os.remove(path)

        # a model that refuses JSON mode with images still answers the plain request; a silent clip is fine
        FakeGemini.log.clear()
        FakeGemini.groq_reject_json = FakeGemini.no_speech = True
        config.VIDEO_ENGINE = "groq"  # skip Gemini entirely
        path = make_mp4(12)
        r = vs.analyse(path, policy_text=POLICY, frames=[JPEG], frame_times=[[1.5, 4.5, 7.5, 10.5]], log_to_db=False)
        kinds = [(x[0], x[1]) for x in FakeGemini.log]
        assert kinds == [("transcribe", True), ("chat", "vision-a"), ("chat", "vision-b"), ("chat", "vision-b")], kinds
        assert FakeGemini.log[3][3] is False and r["engine"] == "groq" and r["transcript"] == ""
        assert any("could not be transcribed" in n for n in r["engine_notes"]) and "4 frames" in r["model"]

        # no frames from the browser: the spoken words are still checked, by a text model
        FakeGemini.log.clear()
        FakeGemini.groq_reject_json = FakeGemini.no_speech = False
        r = vs.analyse(path, policy_text=POLICY, log_to_db=False)
        assert [(x[0], x[1]) for x in FakeGemini.log] == [("transcribe", True), ("chat", "text-a")]
        assert FakeGemini.log[1][2] == 0 and "transcript only" in r["model"] and any("No still frames" in n for n in r["engine_notes"])

        # nothing to work with at all -> one clear error, no crash
        FakeGemini.no_speech = True
        try:
            vs.analyse(path, policy_text=POLICY, log_to_db=False)
            raise AssertionError("expected VideoError")
        except vs.VideoError as exc:
            assert "no frames and no speech" in str(exc)
        os.remove(path)
    finally:
        FakeGemini.gemini_down = FakeGemini.groq_reject_json = FakeGemini.no_speech = False
        config.GROQ_API_KEY, config.VIDEO_ENGINE = "", "auto"
        server.shutdown()


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200  # stands in for the reference logo
KIT = {"brandName": "NexusMobile", "motto": "Connect with confidence", "colors": [{"hex": "#1e3a8a"}, {"hex": "oops"}]}


def test_reference_logo_and_brand_kit():
    name, context, index = vs.build_policy(POLICY, "Brand policy.pdf")
    logo_event = {"events": [
        {"start": 3, "end": 6, "aspect": "logo", "observed": "Logo in the corner is red instead of navy", "verdict": "CONTRADICTED", "severity": "medium",
         "explanation": "Recoloured logo.", "policy_reference": "BRAND KIT", "policy_quote": "Reference logo", "recommendation": "Use the approved logo file."},
        {"start": 0, "end": 2, "aspect": "text", "observed": "NexusMobile", "verdict": "VERIFIED", "policy_reference": "Brand kit", "policy_quote": "NexusMobile"},
    ]}
    with_kit = vs.aggregate(logo_event, 10, index, name, has_kit=True)["findings"]
    logo = next(f for f in with_kit if f["aspect"] == "logo")
    assert logo["verdict"] == "CONTRADICTED" and logo["source_reference"] == "Brand kit · Reference logo" and logo["from_brand_kit"]
    assert next(f for f in with_kit if f["aspect"] == "text")["verdict"] == "VERIFIED"
    # with no brand kit supplied, a "brand kit" citation proves nothing: the logo claim is downgraded
    # (the brand name stays verified only because the policy itself has that line)
    no_kit = vs.aggregate(logo_event, 10, index, name)["findings"]
    assert next(f for f in no_kit if f["aspect"] == "logo")["verdict"] == "UNVERIFIED"
    assert next(f for f in no_kit if f["aspect"] == "text")["policy_ref"]["line"] == 1

    block = vs.brand_kit_block(KIT, True)
    assert '"NexusMobile"' in block and "#1E3A8A" in block and "OOPS" not in block and "Reference logo" in block
    assert vs.brand_kit_block({}, False) == "" and vs.image_mime(PNG) == "image/png" and vs.image_mime(b"GIF89a") is None

    server = _serve()
    try:
        # Gemini: video, then the logo image, then the instructions
        FakeGemini.log.clear()
        path = make_mp4(12)
        r = vs.analyse(path, policy_text=POLICY, reference_logo=PNG, brand_kit=KIT, log_to_db=False)
        last = FakeGemini.log[-1]
        assert last[4] == ["inline_data", "inline_data", "text"] and "BRAND KIT" in last[5] and "attached after the video" in last[5]
        assert r["logo_checked"] is True
        # a file that is not an image is ignored rather than sent
        FakeGemini.log.clear()
        r = vs.analyse(path, policy_text=POLICY, reference_logo=b"not an image", log_to_db=False)
        assert FakeGemini.log[-1][4] == ["inline_data", "text"] and r["logo_checked"] is False

        # Groq backup: 2 contact sheets + the logo (3 images is the model's limit)
        config.GROQ_API_KEY, config.VIDEO_ENGINE = "groq-key", "groq"
        FakeGemini.log.clear()
        r = vs.analyse(path, policy_text=POLICY, reference_logo=PNG, brand_kit=KIT, log_to_db=False,
                       frames=[JPEG, JPEG, JPEG], frame_times=[[1, 4, 7, 10], [2, 5, 8, 11], [3, 6, 9, 11.5]])
        chat = FakeGemini.log[-1]
        assert chat[2] == 3 and chat[6][:2] == ["data:image/jpeg;base64"] * 2 and chat[6][2] == "data:image/png;base64,"
        assert "sent LAST" in chat[5] and "BACKUP MODE" in chat[5] and "Sheet 3" not in chat[4] and "8 frames" in r["model"]
        assert r["logo_checked"] is True
        os.remove(path)
    finally:
        config.GROQ_API_KEY, config.VIDEO_ENGINE = "", "auto"
        server.shutdown()


def test_job_lifecycle():
    server = _serve()
    try:
        path = make_mp4(10)
        job = vs.create_job(path, title="Job clip", policy_text=POLICY, policy_name="Brand policy.pdf")
        assert job["status"] == "running" and job["job_id"]
        for _ in range(100):
            job = vs.get_job(job["job_id"])
            if job["status"] != "running":
                break
            time.sleep(0.05)
        assert job["status"] == "done" and job["progress"] == 100, job
        assert job["result"]["risk_level"] == "HIGH" and job["result"]["db_logged"] is False
        assert not os.path.exists(path)  # the temp file is always removed

        # a clip that is too long ends as a clear error, and its temp file is removed too
        path = make_mp4(45)
        job = vs.create_job(path, title="Too long")
        for _ in range(100):
            job = vs.get_job(job["job_id"])
            if job["status"] != "running":
                break
            time.sleep(0.05)
        assert job["status"] == "error" and "20 seconds" in job["error"] and not os.path.exists(path)
        assert vs.get_job("does-not-exist") is None
    finally:
        server.shutdown()


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} video tests passed")
