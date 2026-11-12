import json
import re
import sys

from requests import Response, Session
from youtube_transcript_api import YouTubeTranscriptApi


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


class BrokerSession(Session):
    # Network is denied by seccomp. The parent validates every fixed-purpose request.
    def request(self, method, url, **kwargs):
        emit({"request": {"method": method.upper(), "url": url,
                          "payload": kwargs.get("json"),
                          "consent": self.cookies.get_dict().get("CONSENT", "")}})
        line = sys.stdin.readline(12_000_001)
        if len(line) > 12_000_000:
            raise RuntimeError("ResponseTooLarge")
        value = json.loads(line)
        if "error" in value:
            raise RuntimeError(value["error"])
        response = Response()
        response.status_code = value["status"]
        response._content = value["text"].encode("utf-8")
        response.encoding = "utf-8"
        response.url = url
        return response


try:
    data = json.loads(sys.stdin.readline(1024))
    video_id = data["videoId"]
    if not isinstance(video_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError("InvalidVideoId")
    tracks = YouTubeTranscriptApi(http_client=BrokerSession()).list(video_id)
    available = list(tracks)
    track = next((item for lang in ("ru", "en") for item in available if item.language_code == lang), None)
    if track is None:
        track = next(iter(available))
    fetched = track.fetch()
    segments = []
    remaining = 32_000
    for item in fetched:
        if not remaining or len(segments) >= 1000:
            break
        text = item.text[:min(2000, remaining)]
        segments.append({"text": text, "start": item.start, "duration": item.duration})
        remaining -= len(text)
    emit({"result": {"language": fetched.language_code, "generated": fetched.is_generated,
                     "segments": segments, "truncated": len(segments) < len(fetched) or sum(len(item.text) for item in fetched) > sum(len(item["text"]) for item in segments)}})
except Exception as error:
    # Never return upstream HTML, URLs with tokens, traceback or filesystem paths.
    code = "YouTubeNetworkError" if isinstance(error, RuntimeError) and str(error) == "YouTubeNetworkError" else type(error).__name__
    emit({"error": code})
    sys.exit(1)
