"""Video audit: a 10-20 second clip is checked against the policy by Gemini (video + audio).

Pipeline (see the architecture diagram):
  Video API (main.py)  -> file / duration validation, job creation
  Processing layer     -> Gemini reads the frames, on-screen text and the audio track itself
  Multimodal AI engine -> one structured request: text, colours, logo, visuals, speech, audio, tone
  Analysis aggregator  -> timestamp alignment, deduplication, JSON validation, policy-line citations
  Results              -> summary, timeline events (VERIFIED / UNVERIFIED / CONTRADICTED), risk

Built for Render's 512 MB tier:
- no FFmpeg, no local model, no new dependency (HTTP goes through the standard library);
- the upload is written to a temp file; clips above VIDEO_INLINE_MAX_BYTES are streamed from
  disk to Gemini's Files API, so a large clip is never held in memory;
- one video is analysed at a time (others wait in the queue).
"""
import base64
import hashlib
import json
import logging
import os
import re
import struct
import threading
import time
import urllib.error
import urllib.request
import uuid

import analytics
import brand_engine
import config
import policy_index

log = logging.getLogger("publivra.video")

UNIVERSAL = "Universal safety rule"

# aspect (what the model looked at) -> category shown in the dashboard and stored for the charts
ASPECTS = {
    "text": "Text in video",
    "speech": "Spoken words",
    "audio": "Audio",
    "colour": "Colour theme",
    "logo": "Logo",
    "visual": "Visuals",
    "tone": "Tone",
    "privacy": "Privacy",
    "claim": "Facts & claims",
}

STAGES = {
    "queued": (5, "Waiting for the AI engine"),
    "validating": (12, "Checking the file and its length"),
    "uploading": (30, "Sending the clip to the AI engine"),
    "processing": (45, "The AI engine is reading the frames and the audio"),
    "analysing": (65, "Checking text, colours, audio and tone against the policy"),
    "aggregating": (90, "Aligning timestamps and matching policy lines"),
    "done": (100, "Analysis complete"),
    "error": (100, "Analysis failed"),
}


class VideoError(Exception):
    """A problem the user can act on. `status` is the HTTP status the API should answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------- file validation
def sniff_mime(path: str) -> str:
    """Container type from the file's first bytes (the browser's content type is not trusted)."""
    with open(path, "rb") as fh:
        head = fh.read(16)
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand.startswith(b"qt"):
            return "video/mov"
        if brand.startswith(b"3g"):
            return "video/3gpp"
        return "video/mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    raise VideoError("Unsupported video format. Upload an MP4, MOV or WebM clip.", 415)


def probe_duration(path: str):
    """Length in seconds of an MP4 / MOV file, read from its 'mvhd' box. None if it can't be read.

    Pure Python and seek-based: only a few bytes are read, whatever the file size.
    """
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            return _find_mvhd(fh, 0, size, depth=0)
    except Exception:  # corrupt or unusual file: let the caller fall back
        return None


def _find_mvhd(fh, start: int, end: int, depth: int):
    pos = start
    while pos + 8 <= end:
        fh.seek(pos)
        header = fh.read(8)
        if len(header) < 8:
            return None
        box_size, kind = struct.unpack(">I4s", header)
        body = pos + 8
        if box_size == 1:  # 64-bit size follows
            box_size = struct.unpack(">Q", fh.read(8))[0]
            body = pos + 16
        elif box_size == 0:  # box runs to the end of the file
            box_size = end - pos
        if box_size < 8:
            return None
        if kind == b"moov" and depth == 0:
            return _find_mvhd(fh, body, min(end, pos + box_size), depth=1)
        if kind == b"mvhd" and depth == 1:
            fh.seek(body)
            data = fh.read(32)
            if data[0] == 1:
                timescale, duration = struct.unpack(">IQ", data[20:32])
            else:
                timescale, duration = struct.unpack(">II", data[12:20])
            return duration / timescale if timescale else None
        pos += box_size
    return None


def check_duration(path: str, client_duration=None) -> float:
    """Validated clip length in seconds. The file's own header wins over what the browser reported."""
    duration = probe_duration(path)
    if duration is None:
        try:
            duration = float(client_duration) if client_duration not in (None, "") else None
        except (TypeError, ValueError):
            duration = None
    if duration is None or duration <= 0:
        raise VideoError("Could not read the length of this video. Please export it as MP4 and try again.")
    if duration > config.VIDEO_MAX_SECONDS + 0.75:  # small tolerance for container rounding
        raise VideoError(f"The clip is {duration:.1f} s long. The limit is {config.VIDEO_MAX_SECONDS:g} seconds - trim it and upload again.")
    if duration < config.VIDEO_MIN_SECONDS:
        raise VideoError(f"The clip is too short ({duration:.1f} s). Upload at least {config.VIDEO_MIN_SECONDS:g} second(s).")
    return round(duration, 2)


# --------------------------------------------------------------------------- Gemini REST
class GeminiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


def _http(method: str, url: str, headers=None, data=None, timeout=None):
    """One HTTP call. Returns (response headers, body bytes); raises GeminiError on a non-2xx reply."""
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("x-goog-api-key", config.GOOGLE_API_KEY)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout or config.VIDEO_TIMEOUT_SECONDS) as resp:
            return resp.headers, resp.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read()[:2000].decode("utf-8", "replace")
        try:
            message = json.loads(raw)["error"]["message"]
        except Exception:
            message = raw or exc.reason
        raise GeminiError(exc.code, " ".join(str(message).split())[:300])
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GeminiError(0, f"network error: {str(getattr(exc, 'reason', exc))[:200]}")


def upload_file(path: str, mime: str, size: int) -> dict:
    """Stream the clip from disk to Gemini's Files API (resumable protocol, one chunk)."""
    headers, _ = _http(
        "POST",
        f"{config.GEMINI_API_BASE}/upload/v1beta/files",
        headers={
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": mime,
            "Content-Type": "application/json",
        },
        data=json.dumps({"file": {"display_name": "publivra-video-audit"}}).encode(),
        timeout=30,
    )
    upload_url = headers.get("x-goog-upload-url")
    if not upload_url:
        raise GeminiError(0, "the Files API did not return an upload URL")
    with open(path, "rb") as fh:
        _, body = _http(
            "POST",
            upload_url,
            headers={"Content-Length": str(size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize"},
            data=fh,
        )
    info = json.loads(body or b"{}").get("file") or {}
    if not info.get("uri") or not info.get("name"):
        raise GeminiError(0, "the Files API did not return the uploaded file")
    return info


def wait_until_active(info: dict, timeout: float = 60.0) -> dict:
    """Uploaded videos are processed before they can be used; poll until the file is ACTIVE."""
    deadline = time.time() + timeout
    while info.get("state", "ACTIVE") != "ACTIVE":
        if info.get("state") == "FAILED":
            raise GeminiError(0, "the AI engine could not process this video file")
        if time.time() > deadline:
            raise GeminiError(0, "the AI engine took too long to process the video")
        time.sleep(2)
        _, body = _http("GET", f"{config.GEMINI_API_BASE}/v1beta/{info['name']}", timeout=20)
        info = {**info, **json.loads(body or b"{}")}
    return info


def delete_file(name: str) -> None:
    try:
        _http("DELETE", f"{config.GEMINI_API_BASE}/v1beta/{name}", timeout=15)
    except Exception as exc:  # files expire on their own after 48 h
        log.info("Could not delete %s from the Files API: %s", name, exc)


def _reply_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        reason = (payload.get("promptFeedback") or {}).get("blockReason")
        raise ValueError(f"the model returned no answer{f' (blocked: {reason})' if reason else ''}")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
    if not text.strip():
        raise ValueError(f"the model returned an empty answer ({candidates[0].get('finishReason', 'no finish reason')})")
    return text


def generate(model: str, video_part: dict, system: str, user: str) -> dict:
    """Ask one model for the structured audit. Returns the parsed JSON object."""
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [video_part, {"text": user}]}],
        # No temperature / top_p: recent Gemini models reject the old sampling parameters.
        "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": config.VIDEO_MAX_OUTPUT_TOKENS},
    }
    url = f"{config.GEMINI_API_BASE}/v1beta/models/{model}:generateContent"
    headers = {"Content-Type": "application/json"}
    try:
        _, raw = _http("POST", url, headers=headers, data=json.dumps(body).encode())
    except GeminiError as exc:
        if exc.status != 400:
            raise
        # A model that rejects the generation settings still answers the plain request;
        # the lenient JSON parser copes with a reply that is not in JSON mode.
        log.info("%s rejected the generation settings (%s); retrying without them.", model, exc.message)
        body.pop("generationConfig")
        _, raw = _http("POST", url, headers=headers, data=json.dumps(body).encode())
    return brand_engine.extract_json(_reply_text(json.loads(raw)))


# --------------------------------------------------------------------------- prompt
VIDEO_SYSTEM = """You are PUBLIVRA AI, an enterprise brand-governance auditor. You review a short marketing
VIDEO before publication against the organisation's POLICY below and nothing else.

HOW TO WORK
Step 1 - Read the WHOLE policy. Every policy line starts with its label in brackets, e.g. [p.2 L14] or [L5].
         Note every rule: brand name and motto, banned or required words, claims and numbers, brand colours
         (hex codes), logo use, tone of voice, music / audio rules, privacy, timelines.
Step 2 - Watch the whole video AND listen to the whole audio track. Check each of these aspects:
         text    - every piece of on-screen text (titles, captions, subtitles, small print)
         speech  - the spoken words (voice-over, dialogue)
         audio   - music, sound effects, voice quality and mood, volume
         colour  - the dominant colour theme of the video compared with the policy's brand colours
         logo    - whether the brand logo appears, and whether it is altered, stretched or recoloured
         visual  - people, objects, scenes and activities shown
         tone    - the overall tone of voice and mood, against the required tone: __TONE__
         privacy - personal identifiers or credentials visible or spoken
         claim   - figures, comparisons, promises and factual statements (shown or spoken)
Step 3 - Report what you found as timeline events (at most 20), each with a verdict.

VERDICTS
- CONTRADICTED: something in the video breaks a policy line, or the policy states a different fact / value /
  colour / wording. You MUST give policy_reference (the bracket label) and policy_quote (that line's words).
- UNVERIFIED: a claim, figure, colour, sound or element the policy does not confirm or does not cover.
  This is the default for claims. Leave policy_reference empty if no line applies.
- VERIFIED: the policy explicitly confirms it (a brand colour that matches, the exact motto, an approved
  term, the required tone). Give policy_reference and policy_quote of the confirming line.
Universal rules that apply even if the policy is silent (use policy_reference "UNIVERSAL" for these):
never show or speak personal identifiers (PAN, Aadhaar, phone, personal email) or credentials; absolute
guarantees ("guarantee", "100%", "zero risk") are not allowed.

IMPORTANT
- Report only what is really in the video. `observed` must be the exact on-screen text or spoken words
  (copied, 2-25 words), or for non-verbal aspects a short factual description of what is seen or heard.
- Give at least one event for each of text, colour, audio and tone (when the video has them), so the
  creator can see that each was checked - VERIFIED when it follows the policy.
- start and end are seconds from the beginning of the video (numbers, one decimal). The video is
  __DURATION__ seconds long. Use the whole range 0 to __DURATION__ for things that apply to the entire video.
- Never invent a policy line. If you cannot point to one, the verdict is UNVERIFIED, not CONTRADICTED.

Respond with ONLY a JSON object, no markdown, in exactly this shape:
{
  "summary": "2-3 sentences: what the video shows and says, and which policy rules it breaks",
  "overall_tone": "Professional | Promotional | Exaggerated | Casual | Formal | Friendly",
  "tone_score": 7,
  "transcript": "all spoken words in order, empty string if there is no speech",
  "audio": {"has_speech": true, "has_music": true, "description": "one sentence about music, sounds and voice"},
  "on_screen_text": [{"start": 0.0, "end": 3.0, "text": "exact text shown"}],
  "colours": [{"hex": "#1E3A8A", "name": "navy blue", "share": 40}],
  "objects": ["up to 8 main objects, people or scenes"],
  "events": [
    {
      "start": 2.0,
      "end": 5.5,
      "aspect": "text | speech | audio | colour | logo | visual | tone | privacy | claim",
      "observed": "exact words shown or spoken, or what is seen / heard",
      "verdict": "VERIFIED | UNVERIFIED | CONTRADICTED",
      "severity": "high | medium | low | none",
      "explanation": "the problem (or why it is fine) according to the policy, max 35 words",
      "policy_reference": "p.2 L14",
      "policy_quote": "exact words of that policy line, max 30 words",
      "recommendation": "one practical fix for the creator, max 20 words (empty for VERIFIED)"
    }
  ]
}
tone_score is 0-10 against the required tone. colours: up to 5 dominant colours, share in percent.
Severity: high = legal / privacy / absolute guarantee, medium = factual, colour, logo or policy mismatch,
low = tone / wording / audio style, none = verified.

POLICY (every line numbered):
__CONTEXT__
"""

VIDEO_USER = """VIDEO TITLE: __TITLE__

Audit the attached video (frames and audio) against the policy. Return the JSON object only."""


# --------------------------------------------------------------------------- aggregator
def _seconds(v, default=0.0) -> float:
    """Accept 12.5, "12.5", "00:12", "0:12.5" or "12s"."""
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").strip()
    m = re.fullmatch(r"(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)", s)
    if m:
        return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    m = re.search(r"\d+(?:\.\d+)?", s)
    return float(m.group()) if m else default


def clock(sec: float) -> str:
    sec = max(0.0, float(sec))
    return f"{int(sec // 60)}:{int(sec % 60):02d}"


def _aspect(v: str) -> str:
    v = (v or "").lower()
    for key, aspect in (
        ("priv", "privacy"), ("pii", "privacy"), ("personal", "privacy"),
        ("speech", "speech"), ("spoken", "speech"), ("voice", "speech"), ("dialog", "speech"), ("transcript", "speech"),
        ("audio", "audio"), ("music", "audio"), ("sound", "audio"),
        ("colo", "colour"), ("palette", "colour"), ("logo", "logo"),
        ("tone", "tone"), ("mood", "tone"), ("claim", "claim"), ("fact", "claim"), ("number", "claim"),
        ("text", "text"), ("caption", "text"), ("subtitle", "text"), ("ocr", "text"),
        ("visual", "visual"), ("object", "visual"), ("scene", "visual"), ("activity", "visual"),
    ):
        if key in v:
            return aspect
    return "visual"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _span(item: dict, duration: float):
    start = max(0.0, min(duration, _seconds(item.get("start", item.get("start_s", item.get("timestamp"))))))
    end = max(0.0, min(duration, _seconds(item.get("end", item.get("end_s")), start)))
    if end < start:
        start, end = end, start
    if end - start < 0.5:  # a moment: give it a visible width on the timeline
        end = min(duration, start + 1.0)
        start = max(0.0, min(start, end - 1.0))
    return round(start, 1), round(end, 1)


def aggregate(raw: dict, duration: float, index: list, policy_name: str) -> dict:
    """Validate the model's reply and turn it into dashboard findings.

    - timestamps are clamped to the clip and ordered;
    - the same observation reported twice (overlapping in time) is merged;
    - every citation is matched against the real policy lines; a CONTRADICTED verdict that cannot be
      tied to a policy line (and is not a universal safety rule) is downgraded to UNVERIFIED.
    """
    raw = raw if isinstance(raw, dict) else {}
    events = raw.get("events") or raw.get("findings") or []
    merged = []
    for e in events if isinstance(events, list) else []:
        if not isinstance(e, dict):
            continue
        observed = str(e.get("observed") or e.get("claim_text") or e.get("text") or e.get("description") or "").strip()
        if not observed:
            continue
        aspect = _aspect(str(e.get("aspect") or e.get("category") or e.get("modality") or ""))
        verdict = brand_engine._verdict(str(e.get("verdict") or ""))
        start, end = _span(e, duration)
        key = _norm(observed)
        twin = next(
            (m for m in merged if m["aspect"] == aspect and m["verdict"] == verdict and (m["key"] in key or key in m["key"])
             and start <= m["end"] + 1.0 and end >= m["start"] - 1.0),
            None,
        )
        if twin:
            twin["start"], twin["end"] = min(twin["start"], start), max(twin["end"], end)
            continue
        merged.append({"aspect": aspect, "verdict": verdict, "start": start, "end": end, "key": key, "observed": observed[:300], "raw": e})

    findings = []
    for m in sorted(merged, key=lambda x: (x["start"], x["end"]))[:25]:
        e, verdict = m["raw"], m["verdict"]
        reference = str(e.get("policy_reference") or e.get("policy_line") or "").strip()
        quote = str(e.get("policy_quote") or e.get("quote") or "").strip()
        universal = "universal" in reference.lower()
        ref = None if universal else policy_index.find_ref(index, quote, reference)
        explanation = str(e.get("explanation") or e.get("problem") or "").strip() or "Flagged by the AI video audit."
        if verdict == "CONTRADICTED" and not ref and not universal:
            verdict = "UNVERIFIED"
            explanation += " (No policy line could be matched for this, so it is marked Unverified.)"
        if verdict == "VERIFIED" and not ref:
            verdict = "UNVERIFIED"  # "verified" needs a confirming policy line
            explanation += " (No confirming policy line was found.)"
        severity = brand_engine._severity(str(e.get("severity") or ""), verdict)
        if verdict != "VERIFIED" and m["aspect"] == "privacy":
            severity = "high"
        if ref:
            source = f"{ref['source']}, " + (f"p.{ref['page']} " if ref["page"] else "") + f"line {ref['line']}"
        else:
            source = UNIVERSAL if universal else "No policy line"
        findings.append(
            {
                "id": "vid:" + hashlib.sha1(f"{m['aspect']}|{m['key']}|{m['start']}|{verdict}".encode()).hexdigest()[:12],
                "start": m["start"],
                "end": m["end"],
                "timestamp": f"{clock(m['start'])} - {clock(m['end'])}",
                "aspect": m["aspect"],
                "category": ASPECTS[m["aspect"]],
                "claim_text": m["observed"],
                "verdict": verdict,
                "severity": severity,
                "explanation": explanation,
                "source_reference": source,
                "policy_ref": ref,
                "policy_quote": (ref["text"] if ref and ref["verified"] else "" if universal else quote)[:400],
                "recommendation": "" if verdict == "VERIFIED" else str(e.get("recommendation") or "").strip(),
            }
        )

    texts = []
    for t in raw.get("on_screen_text") or []:
        if isinstance(t, dict) and str(t.get("text") or "").strip():
            start, end = _span(t, duration)
            texts.append({"start": start, "end": end, "text": str(t["text"]).strip()[:300]})
        elif isinstance(t, str) and t.strip():
            texts.append({"start": 0.0, "end": round(duration, 1), "text": t.strip()[:300]})

    colours = []
    for c in raw.get("colours") or raw.get("colors") or []:
        hex_code = str((c.get("hex") if isinstance(c, dict) else c) or "").strip()
        if re.fullmatch(r"#?[0-9a-fA-F]{6}", hex_code):
            hex_code = "#" + hex_code.lstrip("#").upper()
            share = brand_engine._first_number(c.get("share"), 0) if isinstance(c, dict) else 0
            colours.append({"hex": hex_code, "name": str(c.get("name") or "")[:40] if isinstance(c, dict) else "", "share": int(max(0, min(100, share)))})

    audio = raw.get("audio") if isinstance(raw.get("audio"), dict) else {}
    transcript = str(raw.get("transcript") or "").strip()
    return {
        "summary": str(raw.get("summary") or "").strip() or "AI video audit completed.",
        "overall_tone": str(raw.get("overall_tone") or raw.get("tone") or "Unknown").strip()[:40],
        "tone_score": int(max(0, min(10, round(brand_engine._first_number(raw.get("tone_score"), 5))))),
        "transcript": transcript[:6000],
        "audio": {
            "has_speech": bool(audio.get("has_speech", bool(transcript))),
            "has_music": bool(audio.get("has_music", False)),
            "description": str(audio.get("description") or "").strip()[:400],
        },
        "on_screen_text": texts[:40],
        "colours": colours[:6],
        "objects": brand_engine._str_list(raw.get("objects"))[:10],
        "findings": findings,
        "policy_used": policy_name,
    }


def compute_risk(findings, tone_score: int):
    """Same scoring as the text audit (audit_service.compute_risk)."""
    contradicted = [f for f in findings if f["verdict"] == "CONTRADICTED"]
    unverified = [f for f in findings if f["verdict"] == "UNVERIFIED"]
    weight = {"high": 30, "medium": 15, "low": 5}
    score = sum(weight.get(f["severity"], 5) for f in contradicted) + 8 * len(unverified) + max(0, 8 - tone_score) * 2
    level = "LOW"
    if any(f["severity"] == "high" for f in contradicted):
        level = "HIGH"
    elif contradicted or len(unverified) >= 2 or tone_score < 6:
        level = "MEDIUM"
    return level, min(100, score)


# --------------------------------------------------------------------------- orchestration
def build_policy(policy_text: str = "", policy_name: str = ""):
    """(policy name, numbered context for the model, index of numbered lines).

    The user's policy (already OCR-read in the dashboard) is the knowledge base; the default
    guidelines are used only when no policy is given. Numbering matches the policy viewer.
    """
    text = (policy_text or "").strip()
    if text:
        name = (policy_name or "").strip() or "Uploaded policy"
        text = text[: config.VIDEO_POLICY_CHARS]
    else:
        name, text = "Default Brand Guidelines", config.guidelines_text()
    index = policy_index.number_policy(text, name)
    return name, f"=== {name} ===\n{policy_index.numbered_text(index)}", index


def analyse(path: str, *, title="Untitled video", policy_text="", policy_name="", tone_profile="Professional",
            company="", client_duration=None, progress=None, generate_fn=None, log_to_db=True) -> dict:
    """Run one video audit end to end. `progress(stage)` is called as the work moves on."""
    step = progress or (lambda stage: None)
    models = config.video_models()
    if not models and generate_fn is None:
        raise VideoError("Video audit needs a Gemini key. Set GOOGLE_API_KEY on the server.", 503)

    step("validating")
    size = os.path.getsize(path)
    if size > config.VIDEO_MAX_BYTES:
        raise VideoError(f"The video is larger than the {config.VIDEO_MAX_BYTES // (1024 * 1024)} MB limit.", 413)
    mime = sniff_mime(path)
    duration = check_duration(path, client_duration)

    name, context, index = build_policy(policy_text, policy_name)
    tone_profile = tone_profile if tone_profile in ("Professional", "Formal", "Friendly") else "Professional"
    system = VIDEO_SYSTEM.replace("__TONE__", tone_profile).replace("__DURATION__", f"{duration:g}").replace("__CONTEXT__", context)
    user = VIDEO_USER.replace("__TITLE__", title or "Untitled video")

    uploaded, raw, model_used, errors = None, None, None, []
    try:
        step("uploading")
        if generate_fn is not None:
            part = {"inline_data": {"mime_type": mime, "data": ""}}
        elif size <= config.VIDEO_INLINE_MAX_BYTES:
            with open(path, "rb") as fh:
                part = {"inline_data": {"mime_type": mime, "data": base64.b64encode(fh.read()).decode("ascii")}}
        else:
            uploaded = upload_file(path, mime, size)
            step("processing")
            uploaded = wait_until_active(uploaded)
            part = {"file_data": {"mime_type": mime, "file_uri": uploaded["uri"]}}

        step("analysing")
        for model in models or ["test-model"]:
            try:
                raw = (generate_fn or generate)(model, part, system, user)
                model_used = model
                break
            except GeminiError as exc:
                errors.append(f"{model}: {exc.message}")
                log.warning("Video audit with %s failed - trying next. %s", model, exc)
                if exc.status in (401, 403):  # a bad or restricted key fails on every model
                    break
            except Exception as exc:  # unreadable reply
                errors.append(f"{model}: {str(exc)[:160]}")
                log.warning("Video audit with %s returned an unusable reply. %s", model, exc)
        del part
    finally:
        if uploaded and uploaded.get("name"):
            delete_file(uploaded["name"])
    if raw is None:
        raise VideoError("All AI models are busy or failed. Please retry in a minute. Details: " + " | ".join(errors), 503)

    step("aggregating")
    result = aggregate(raw, duration, index, name)
    findings, tone_score = result["findings"], result["tone_score"]
    level, score = compute_risk(findings, tone_score)
    is_compliant = not any(f["verdict"] == "CONTRADICTED" for f in findings)
    result.update(
        title=title,
        source="video",
        model=f"{model_used} · Gemini",
        duration=duration,
        size_bytes=size,
        mime=mime,
        tone_profile=tone_profile,
        is_compliant=is_compliant,
        status="COMPLIANT" if is_compliant else "NON_COMPLIANT",
        risk_level=level,
        risk_score=score,
        counts={v: sum(1 for f in findings if f["verdict"] == v) for v in ("VERIFIED", "UNVERIFIED", "CONTRADICTED")},
        aspects={a: sum(1 for f in findings if f["aspect"] == a) for a in ASPECTS},
    )
    sections = analytics.breakdown(findings, tone_score)
    result["sections"] = sections

    audit_id, created_at = None, None
    if log_to_db:
        import database  # imported here so the module loads without a database driver in tests

        heard_and_seen = "\n".join(
            [f"[Video, {duration:g} s]"]
            + [f"[{clock(t['start'])}] on screen: {t['text']}" for t in result["on_screen_text"]]
            + ([f"Spoken: {result['transcript']}"] if result["transcript"] else [])
        )
        violations = "\n".join(f"[{f['timestamp']}] {f['claim_text']}: {f['explanation']}" for f in findings if f["verdict"] == "CONTRADICTED") or "None"
        audit_id, created_at = database.save_audit(
            filename=title or "Untitled video",
            text=heard_and_seen,
            is_compliant=is_compliant,
            status_label=result["status"],
            violations=violations,
            source="video",
            risk_level=level,
            tone=result["overall_tone"],
            summary=result["summary"],
            model=result["model"],
            report=result,
            risk_score=score,
            company=company,
            tone_score=tone_score,
            sections=analytics.columns(sections),
        )
    result.update(audit_id=audit_id, created_at=created_at, db_logged=audit_id is not None)
    return result


# --------------------------------------------------------------------------- jobs
_JOBS = {}
_JOBS_LOCK = threading.Lock()
_ENGINE = threading.Semaphore(1)  # one video in flight keeps memory flat on a 512 MB instance
_JOB_TTL_SECONDS = 30 * 60
_MAX_JOBS = 20


def _set(job_id: str, **changes):
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job:
            job.update(changes, updated_at=time.time())


def _stage(job_id: str, stage: str):
    percent, message = STAGES[stage]
    _set(job_id, stage=stage, progress=percent, message=message)


def _prune():
    now = time.time()
    with _JOBS_LOCK:
        finished = sorted((j for j in _JOBS.values() if j["status"] != "running"), key=lambda j: j["updated_at"])
        for j in finished:
            if now - j["updated_at"] > _JOB_TTL_SECONDS or len(_JOBS) > _MAX_JOBS:
                _JOBS.pop(j["id"], None)


def queue_size() -> int:
    with _JOBS_LOCK:
        return sum(1 for j in _JOBS.values() if j["status"] == "running")


def _run(job_id: str, path: str, kwargs: dict):
    try:
        with _ENGINE:
            result = analyse(path, progress=lambda stage: _stage(job_id, stage), **kwargs)
        _stage(job_id, "done")
        _set(job_id, status="done", result=result)
    except VideoError as exc:
        _stage(job_id, "error")
        _set(job_id, status="error", error=str(exc), error_status=exc.status)
    except Exception as exc:  # pragma: no cover - unexpected
        log.exception("Video audit crashed")
        _stage(job_id, "error")
        _set(job_id, status="error", error=f"Video audit failed: {str(exc)[:300]}", error_status=502)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def create_job(path: str, **kwargs) -> dict:
    """Start the audit of an uploaded clip in the background. The temp file is deleted when it ends."""
    _prune()
    job_id = uuid.uuid4().hex[:16]
    percent, message = STAGES["queued"]
    job = {"id": job_id, "status": "running", "stage": "queued", "progress": percent, "message": message,
           "result": None, "error": None, "created_at": time.time(), "updated_at": time.time()}
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    threading.Thread(target=_run, args=(job_id, path, kwargs), daemon=True, name=f"video-{job_id}").start()
    return public(job)


def get_job(job_id: str):
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        return public(job) if job else None


def public(job: dict) -> dict:
    return {"job_id": job["id"], "status": job["status"], "stage": job["stage"], "progress": job["progress"],
            "message": job["message"], "error": job["error"], "result": job["result"]}
