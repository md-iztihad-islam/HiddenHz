"""
Vercel Blob, for files past the 4.5 MB request/response limit of a Vercel function.

Only used when hosted: the browser uploads big inputs straight to Blob and sends us the
URL, and we hand big outputs back the same way. Standard library only, so the codec's
dependency list does not grow. Locally BLOB_READ_WRITE_TOKEN is unset and none of
this runs.
"""
import json
import os
import urllib.parse
import urllib.request

_API = "https://vercel.com/api/blob"
_VERSION = "12"
# a base64 body of this many raw bytes still fits under the 4.5 MB function limit
INLINE_LIMIT = 3_200_000


def enabled() -> bool:
    return bool(os.environ.get("BLOB_READ_WRITE_TOKEN"))


def _headers() -> dict:
    token = os.environ["BLOB_READ_WRITE_TOKEN"]
    store_id = token.split("_")[3]           # vercel_blob_rw_<storeId>_<secret>
    return {"authorization": "Bearer " + token, "x-api-version": _VERSION,
            "x-vercel-blob-store-id": store_id}


def _check_url(url: str) -> None:
    # fetch only from our own store, never an arbitrary URL a client sends
    host = urllib.parse.urlparse(url).hostname or ""
    if not host.endswith(".public.blob.vercel-storage.com"):
        raise ValueError("unexpected upload URL")


def fetch(url: str) -> bytes:
    _check_url(url)
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def put(name: str, data: bytes, content_type: str) -> str:
    """Store `data` publicly under a random suffix; returns its URL."""
    req = urllib.request.Request(
        _API + "/?" + urllib.parse.urlencode({"pathname": "out/" + name}),
        data=data, method="PUT",
        headers={**_headers(), "x-vercel-blob-access": "public",
                 "x-add-random-suffix": "1", "x-content-type": content_type,
                 "x-content-length": str(len(data))})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["url"]

