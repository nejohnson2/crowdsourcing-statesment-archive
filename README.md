# Crowdsourcing the Statesment Archive

FastAPI web app for crowdsourcing annotations on single-page newspaper PDFs.

## What this repo does

- Imports single-page PDF files into a SQLite database as “pages”.
- Serves an annotation UI that selects pages for users.
- Converts PDFs to cached JPEGs on-demand for fast viewing.
- Tracks per-page annotation counts and marks pages complete at 10 annotations.

## Requirements

- Python 3.10+
- A system PDF renderer for `pdf2image` (Poppler)
	- macOS: `brew install poppler`

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run the web app

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- App: `http://localhost:8000/`
- Annotate: `http://localhost:8000/annotate`
- Admin page: `http://localhost:8000/admin`

On startup, the app will create/update the SQLite schema automatically.

## Data + storage layout

- SQLite DB file: `data.db` in the repository root (created automatically).
- PDF sources: any directory you point the importer at.
- Image cache: `cache/` (JPEGs rendered from PDFs on first view).

Important: the database stores the *absolute filesystem path* to each PDF.
That means the PDF files must remain present at the same path for the app to
render images. If you move the PDFs (or move the database to another machine),
you’ll need to re-import or update stored paths.

## Import PDFs into the database

The importer recursively walks a directory, finds `.pdf` files, and inserts one
row per file into the `pages` table.

```bash
python -m scripts.import_pages /path/to/pdf/directory
```

Behavior notes (based on `scripts/import_pages.py`):

- Idempotent: it skips any PDF whose absolute path is already in the DB.
- Writes in batches (commits every 500 inserts).
- Stores `file_path` (absolute path) and `filename` (basename).

Tip: avoid quoting `~` if you rely on shell expansion. For example:

```bash
python -m scripts.import_pages ~/data/pdfs
```

## Large datasets (e.g., ~300GB)

300GB mostly impacts runtime through *number of files/directories*, not bytes read.
The importer does not parse PDF contents, but it does traverse the directory tree.

What to expect:

- Directory walk can take a long time for huge trees (minutes → hours), especially
	on network/external drives.
- Memory usage grows with the number of pages already in the DB because the script
	loads all existing `pages.file_path` values into a Python `set`.
- Memory usage also grows with the number of *new* PDFs found in a run because the
	script builds a full list of new PDFs before inserting.

Practical guidance:

- Import in chunks (e.g., one subfolder at a time) to reduce peak memory.
	The importer is safe to run repeatedly; it will skip previously imported files.
- Run imports on the same machine where the app will run, so stored absolute paths
	match reality.
- Ensure you have enough free disk for `cache/`. If many pages are viewed, cached
	JPEGs can become large over time.

## Troubleshooting

- If image rendering fails, install Poppler and confirm `pdftoppm` is on your PATH.
- If the app returns “Source PDF file not found on disk”, the `file_path` stored in
	`data.db` no longer exists on this machine.