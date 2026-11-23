#!/usr/bin/env python3
"""Check external links in optout-guide.md and report dead/redirected URLs."""

from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

GUIDE_PATH = Path(__file__).resolve().parents[2] / "optout-guide.md"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
BOT_BLOCK_CODES = {403, 406, 429, 503}
DEAD_CODES = {404, 410}


class PermanentRedirectTracker(urllib.request.HTTPRedirectHandler):
    """Record permanent redirects while following redirects."""

    def __init__(self) -> None:
        self.permanent_target: str | None = None

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if code in (301, 308) and self.permanent_target is None:
            self.permanent_target = newurl
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def check_url(url: str) -> dict:
    """Check a single URL with retries and classify its status."""
    ctx = ssl.create_default_context()
    if hasattr(ssl, "OP_IGNORE_UNEXPECTED_EOF"):
        ctx.options |= ssl.OP_IGNORE_UNEXPECTED_EOF
    last_error = ""

    for attempt in range(2):
        tracker = PermanentRedirectTracker()
        opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx), tracker
        )
        req = urllib.request.Request(url, headers=HEADERS, method="GET")
        try:
            with opener.open(req, timeout=12) as resp:
                code = resp.getcode()
                if tracker.permanent_target and tracker.permanent_target.rstrip("/") != url.rstrip("/"):
                    return {
                        "url": url,
                        "status": "REDIRECT",
                        "detail": f"HTTP {code} (permanent redirect -> {tracker.permanent_target})",
                    }
                return {"url": url, "status": "OK", "detail": f"HTTP {code}"}
        except urllib.error.HTTPError as exc:
            if exc.code in BOT_BLOCK_CODES:
                return {
                    "url": url,
                    "status": "BOT_BLOCKED",
                    "detail": f"HTTP {exc.code} (likely WAF/bot protection)",
                }
            if exc.code in DEAD_CODES:
                return {"url": url, "status": "BROKEN", "detail": f"HTTP {exc.code}"}
            last_error = f"HTTP {exc.code}"
        except Exception as exc:
            msg = str(exc)
            if "UNEXPECTED_EOF_WHILE_READING" in msg or "Connection reset by peer" in msg:
                return {
                    "url": url,
                    "status": "BOT_BLOCKED",
                    "detail": f"TLS/connection reset ({msg})",
                }
            last_error = msg

        if attempt == 0:
            time.sleep(1.5)

    return {"url": url, "status": "BROKEN", "detail": last_error}


def extract_urls(markdown_text: str) -> list[str]:
    """Extract unique external http(s) URLs from markdown links."""
    raw = re.findall(r"\[[^\]]+\]\((https?://[^)\s]+)\)", markdown_text)
    seen: set[str] = set()
    urls: list[str] = []
    for url in raw:
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def write_step_summary(results: list[dict]) -> None:
    """Write a markdown summary when running inside GitHub Actions."""
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return

    broken = [r for r in results if r["status"] == "BROKEN"]
    redirects = [r for r in results if r["status"] == "REDIRECT"]
    blocked = [r for r in results if r["status"] == "BOT_BLOCKED"]
    ok = [r for r in results if r["status"] == "OK"]

    lines = [
        "## Opt-Out Guide Link Check",
        f"- **Checked:** {len(results)}",
        f"- **OK:** {len(ok)}",
        f"- **Permanent Redirects:** {len(redirects)}",
        f"- **Bot-Blocked (403/429/503):** {len(blocked)}",
        f"- **Broken:** {len(broken)}",
        "",
    ]
    if broken:
        lines.append("### Broken Links")
        for item in broken:
            lines.append(f"- `{item['url']}` — {item['detail']}")
        lines.append("")
    if redirects:
        lines.append("### Permanent Redirects")
        for item in redirects:
            lines.append(f"- `{item['url']}` — {item['detail']}")
        lines.append("")

    Path(summary_path).write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    text = GUIDE_PATH.read_text(encoding="utf-8")
    urls = extract_urls(text)
    print(f"Checking {len(urls)} unique external URLs in {GUIDE_PATH.name}...")

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        future_map = {pool.submit(check_url, u): u for u in urls}
        for future in as_completed(future_map):
            results.append(future.result())

    results.sort(key=lambda r: (r["status"], r["url"]))
    for r in results:
        print(f"[{r['status']}] {r['url']} -> {r['detail']}")

    write_step_summary(results)

    broken = [r for r in results if r["status"] == "BROKEN"]
    if broken:
        print(f"\nFound {len(broken)} broken link(s).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
