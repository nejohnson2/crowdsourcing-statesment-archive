#!/usr/bin/env python3
"""
Import single-page PDF files from a data directory into the database.

Usage:
    python -m scripts.import_pages /path/to/pdf/directory

Walks the directory recursively, finds all .pdf files, and inserts them
into the pages table. Idempotent — skips files already in the database.
"""

import os
import sys

# Add project root to path so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal, init_db
from app.models import Page


def import_pages(data_dir: str) -> None:
    if not os.path.isdir(data_dir):
        print(f"Error: '{data_dir}' is not a valid directory.")
        sys.exit(1)

    init_db()
    db = SessionLocal()

    # Get existing file paths to avoid duplicates
    existing = set(row[0] for row in db.query(Page.file_path).all())

    pdf_files = []
    for root, _dirs, files in os.walk(data_dir):
        for f in sorted(files):
            if f.lower().endswith(".pdf"):
                full_path = os.path.abspath(os.path.join(root, f))
                if full_path not in existing:
                    pdf_files.append((full_path, f))

    if not pdf_files:
        print(f"No new PDF files found in '{data_dir}'.")
        print(f"  Already imported: {len(existing)} pages")
        db.close()
        return

    print(f"Found {len(pdf_files)} new PDF files to import...")

    batch_size = 500
    for i in range(0, len(pdf_files), batch_size):
        batch = pdf_files[i : i + batch_size]
        for full_path, filename in batch:
            db.add(Page(file_path=full_path, filename=filename))
        db.commit()
        print(f"  Imported {min(i + batch_size, len(pdf_files))}/{len(pdf_files)}")

    total = db.query(Page).count()
    print(f"Import complete. Total pages in database: {total}")
    db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m scripts.import_pages /path/to/pdf/directory")
        sys.exit(1)
    import_pages(sys.argv[1])
