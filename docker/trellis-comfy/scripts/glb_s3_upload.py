#!/usr/bin/env python3
"""
Upload .glb files to S3-compatible storage (AWS S3 or Cloudflare R2).

Used by the 3D OUTFIT RunPod worker scaffold when the stock
`runpod/worker-comfyui` handler only returns `output.images` and ignores
SaveGLB / mesh history keys.

Env (set on the RunPod Endpoint — never commit secrets):
  BUCKET_ENDPOINT_URL       e.g. https://<accountid>.r2.cloudflarestorage.com
                            or https://<bucket>.s3.<region>.amazonaws.com
  BUCKET_ACCESS_KEY_ID
  BUCKET_SECRET_ACCESS_KEY
  BUCKET_PREFIX             optional key prefix (default: 3d-outfit/glb)
  AWS_DEFAULT_REGION        optional; R2 often uses "auto"

Returns a public or signed https URL string when possible.
Stock worker uses runpod.serverless.utils.rp_upload; this helper is a
standalone fallback for custom handler wiring (see handler_glb_notes.py).
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path


def _require_env(*names: str) -> dict[str, str]:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        raise SystemExit(f"Missing env: {', '.join(missing)}")
    return {n: os.environ[n] for n in names}


def upload_glb(local_path: str | Path, job_id: str | None = None) -> str:
    local_path = Path(local_path)
    if not local_path.is_file():
        raise FileNotFoundError(local_path)
    if local_path.suffix.lower() != ".glb":
        raise ValueError(f"Expected .glb, got {local_path.suffix}")

    cfg = _require_env(
        "BUCKET_ENDPOINT_URL",
        "BUCKET_ACCESS_KEY_ID",
        "BUCKET_SECRET_ACCESS_KEY",
    )
    prefix = os.environ.get("BUCKET_PREFIX", "3d-outfit/glb").strip("/")
    job_id = job_id or os.environ.get("RUNPOD_JOB_ID") or uuid.uuid4().hex
    key = f"{prefix}/{job_id}/{local_path.name}"

    try:
        import boto3
        from botocore.client import Config
    except ImportError as exc:
        raise SystemExit("boto3 required: pip install boto3") from exc

    # path-style helps some R2 / custom endpoints
    client = boto3.client(
        "s3",
        endpoint_url=cfg["BUCKET_ENDPOINT_URL"],
        aws_access_key_id=cfg["BUCKET_ACCESS_KEY_ID"],
        aws_secret_access_key=cfg["BUCKET_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_DEFAULT_REGION", "auto"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )

    bucket = os.environ.get("BUCKET_NAME")
    if not bucket:
        # Infer from virtual-hosted-style endpoint host if possible
        # Prefer explicit BUCKET_NAME on the Endpoint.
        raise SystemExit("Set BUCKET_NAME to the target bucket (S3 or R2).")

    extra = {"ContentType": "model/gltf-binary"}
    client.upload_file(
        str(local_path),
        bucket,
        key,
        ExtraArgs=extra,
    )

    public_base = os.environ.get("BUCKET_PUBLIC_BASE_URL", "").rstrip("/")
    if public_base:
        return f"{public_base}/{key}"

    # Presigned GET (app accepts https URLs)
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=int(os.environ.get("BUCKET_PRESIGN_EXPIRES", "604800")),
    )
    return url


def find_glbs(root: str | Path = "/comfyui/output") -> list[Path]:
    root = Path(root)
    if not root.exists():
        return []
    return sorted(root.rglob("*.glb"))


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] == "--scan":
        paths = find_glbs(argv[2] if len(argv) > 2 else "/comfyui/output")
        for p in paths:
            print(p)
        return 0

    if len(argv) < 2:
        print(
            "Usage:\n"
            "  glb_s3_upload.py <file.glb> [job_id]\n"
            "  glb_s3_upload.py --scan [/comfyui/output]\n",
            file=sys.stderr,
        )
        return 2

    url = upload_glb(argv[1], argv[2] if len(argv) > 2 else None)
    # App extractAssetStubsFromOutput looks for glb_url / files[].url / https *.glb
    print(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
