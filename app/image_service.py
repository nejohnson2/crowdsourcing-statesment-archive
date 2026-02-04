"""
Converts single-page PDFs to JPEG images and caches them on disk.
"""

import os
import hashlib

from PIL import Image
from pdf2image import convert_from_path

# Allow very large scanned images (some newspaper pages exceed default limit)
Image.MAX_IMAGE_PIXELS = None

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
JPEG_QUALITY = 85
DPI = 150  # Good readability while keeping file size manageable
MAX_DIMENSION = 4000  # Downsample if either dimension exceeds this


def _cache_path(pdf_path: str) -> str:
    """Generate a deterministic cache filename from the PDF path."""
    path_hash = hashlib.md5(pdf_path.encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{path_hash}.jpg")


def get_page_image(pdf_path: str) -> str:
    """
    Return the filesystem path to a JPEG rendering of the given PDF page.
    Converts and caches on first access.
    """
    cached = _cache_path(pdf_path)

    if os.path.exists(cached):
        return cached

    os.makedirs(CACHE_DIR, exist_ok=True)

    images = convert_from_path(pdf_path, dpi=DPI, first_page=1, last_page=1)
    if not images:
        raise ValueError(f"Could not convert PDF: {pdf_path}")

    img = images[0]

    # Downsample if the rendered image is extremely large
    w, h = img.size
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        scale = min(MAX_DIMENSION / w, MAX_DIMENSION / h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    img.save(cached, "JPEG", quality=JPEG_QUALITY)
    return cached
