"""HTTP response coding and fixed-length file transfers for the UI server."""
import gzip
import re


COMPRESSIBLE = {"application/javascript", "text/javascript", "text/css", "text/html",
                "application/json", "application/manifest+json"}


def accepts_gzip(header):
    weights = {}
    for item in header.lower().split(","):
        coding, separator, parameter = item.strip().partition(";")
        coding = coding.strip()
        if coding not in {"gzip", "*", "identity"}:
            continue
        quality = 1.0
        if separator:
            match = re.fullmatch(r"\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*", parameter)
            quality = float(match[1]) if match else 0.0
        weights[coding] = quality
    quality = weights.get("gzip", weights.get("*", 0))
    return quality > 0 and quality >= weights.get("identity", 0)


def encode_body(body, status, ctype, request, headers, linked_header):
    """Update the response headers for the selected representation."""
    media_type = (ctype or "").partition(";")[0].strip().lower()
    if (status not in (200, 304) or media_type not in COMPRESSIBLE
            or "Content-Encoding" in headers or "Content-Range" in headers):
        return body
    # Linked laptop proxies rewrite HTML and replay saved data as plain bytes.
    vary = [name.strip() for name in headers.get("Vary", "").split(",") if name.strip()]
    if "*" not in vary:
        known = {name.lower() for name in vary}
        vary.extend(name for name in ("Accept-Encoding", linked_header) if name.lower() not in known)
        headers["Vary"] = ", ".join(vary)
    if (len(body) < 512 or request.get(linked_header) or request.get("Range")
            or not accepts_gzip(request.get("Accept-Encoding", ""))):
        return body
    encoded = gzip.compress(body, compresslevel=1, mtime=0)
    if len(encoded) >= len(body):
        return body
    headers["Content-Encoding"] = "gzip"
    return encoded


def write_file_body(handler, stream, length, block_size=65536):
    """Close on a short read so the next response can't complete this one."""
    try:
        while length:
            chunk = stream.read(min(block_size, length))
            if not chunk:
                break
            handler.wfile.write(chunk)
            length -= len(chunk)
    except OSError:
        handler.close_connection = True
        return
    if length:
        handler.close_connection = True
