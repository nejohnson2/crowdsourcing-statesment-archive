"""
FastAPI application — routes, session middleware, and startup.
"""

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, Request, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.database import get_db, init_db
from app.models import Page, Session, Annotation, Region
from app.schemas import (
    AnnotationSubmission, PageResponse, StatsResponse,
    PageListItem, PaginatedPages,
)
from app.selection import get_next_page, record_annotation
from app.image_service import get_page_image

import os

BASE_DIR = os.path.dirname(os.path.dirname(__file__))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Newspaper Annotation Platform", lifespan=lifespan)

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

SESSION_COOKIE = "annotator_session"


# ---------------------------------------------------------------------------
# Session helper
# ---------------------------------------------------------------------------

def get_or_create_session(request: Request, db: DBSession) -> Session:
    """Get existing session from cookie or create a new one."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        session = db.query(Session).filter(Session.session_token == token).first()
        if session:
            return session

    # Create new session (cookie will be set in the response)
    token = str(uuid.uuid4())
    session = Session(session_token=token)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def set_session_cookie(response, session: Session):
    """Set the session cookie on a response."""
    response.set_cookie(
        SESSION_COOKIE,
        session.session_token,
        max_age=365 * 24 * 3600,  # 1 year
        httponly=True,
        samesite="lax",
    )


# ---------------------------------------------------------------------------
# HTML pages
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index(request: Request, db: DBSession = Depends(get_db)):
    session = get_or_create_session(request, db)
    response = templates.TemplateResponse(request, "index.html")
    set_session_cookie(response, session)
    return response


@app.get("/annotate", response_class=HTMLResponse)
async def annotate_page(request: Request, db: DBSession = Depends(get_db)):
    session = get_or_create_session(request, db)
    response = templates.TemplateResponse(request, "annotate.html")
    set_session_cookie(response, session)
    return response


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    return templates.TemplateResponse(request, "admin.html")


@app.get("/thanks", response_class=HTMLResponse)
async def thanks_page(request: Request):
    return templates.TemplateResponse(request, "thanks.html")


# ---------------------------------------------------------------------------
# API — Page selection and image serving
# ---------------------------------------------------------------------------

@app.get("/api/page/next")
async def api_next_page(request: Request, skip: str = Query(""), db: DBSession = Depends(get_db)):
    session = get_or_create_session(request, db)
    skip_ids = [int(x) for x in skip.split(",") if x.strip().isdigit()]
    page = get_next_page(db, session.id, skip_ids=skip_ids or None)

    if page is None:
        return JSONResponse(
            {"message": "No more pages available. Thank you for your contributions!"},
            status_code=404,
        )

    data = PageResponse(
        id=page.id,
        filename=page.filename,
        image_url=f"/api/page/{page.id}/image",
    )
    response = JSONResponse(data.model_dump())
    set_session_cookie(response, session)
    return response


@app.get("/api/page/{page_id}/image")
async def api_page_image(page_id: int, db: DBSession = Depends(get_db)):
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(404, "Page not found")

    if not os.path.exists(page.file_path):
        raise HTTPException(404, "Source PDF file not found on disk")

    try:
        image_path = get_page_image(page.file_path)
    except Exception as e:
        raise HTTPException(500, f"Failed to convert PDF: {e}")

    return FileResponse(image_path, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# API — Annotation submission
# ---------------------------------------------------------------------------

@app.post("/api/page/{page_id}/annotate")
async def api_submit_annotation(
    page_id: int,
    body: AnnotationSubmission,
    request: Request,
    db: DBSession = Depends(get_db),
):
    session = get_or_create_session(request, db)

    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(404, "Page not found")

    # Check for duplicate submission
    existing = (
        db.query(Annotation)
        .filter(Annotation.page_id == page_id, Annotation.session_id == session.id)
        .first()
    )
    if existing:
        raise HTTPException(409, "You have already annotated this page")

    annotation = Annotation(
        page_id=page_id,
        session_id=session.id,
        publication_date=body.publication_date,
    )
    db.add(annotation)
    db.flush()

    for r in body.regions:
        db.add(Region(
            annotation_id=annotation.id,
            region_type=r.region_type,
            title=r.title,
            x=r.x,
            y=r.y,
            width=r.width,
            height=r.height,
        ))

    record_annotation(db, page)
    db.commit()

    response = JSONResponse({"status": "ok", "annotation_id": annotation.id})
    set_session_cookie(response, session)
    return response


# ---------------------------------------------------------------------------
# API — Admin
# ---------------------------------------------------------------------------

@app.get("/api/admin/stats")
async def api_admin_stats(db: DBSession = Depends(get_db)):
    total = db.query(func.count(Page.id)).scalar() or 0
    not_started = db.query(func.count(Page.id)).filter(Page.status == "pending").scalar() or 0
    in_progress = db.query(func.count(Page.id)).filter(Page.status == "in_progress").scalar() or 0
    complete = db.query(func.count(Page.id)).filter(Page.status == "complete").scalar() or 0
    total_annotations = db.query(func.count(Annotation.id)).scalar() or 0
    unique_sessions = db.query(func.count(Session.id)).scalar() or 0

    def pct(n):
        return round(n / total * 100, 1) if total > 0 else 0.0

    return StatsResponse(
        total_pages=total,
        not_started=not_started,
        in_progress=in_progress,
        complete=complete,
        pct_not_started=pct(not_started),
        pct_in_progress=pct(in_progress),
        pct_complete=pct(complete),
        total_annotations=total_annotations,
        unique_sessions=unique_sessions,
    )


@app.get("/api/admin/pages")
async def api_admin_pages(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    sort: str = Query("annotation_count"),
    order: str = Query("desc"),
    db: DBSession = Depends(get_db),
):
    query = db.query(Page)
    total = query.count()

    sort_col = getattr(Page, sort, Page.annotation_count)
    if order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    pages = query.offset((page - 1) * per_page).limit(per_page).all()

    return PaginatedPages(
        pages=[
            PageListItem(
                id=p.id,
                filename=p.filename,
                annotation_count=p.annotation_count,
                status=p.status,
            )
            for p in pages
        ],
        total=total,
        page=page,
        per_page=per_page,
    )


@app.get("/api/admin/export")
async def api_admin_export(db: DBSession = Depends(get_db)):
    """Export all annotations as JSON."""
    annotations = (
        db.query(Annotation)
        .join(Page)
        .join(Session)
        .all()
    )

    data = []
    for ann in annotations:
        data.append({
            "annotation_id": ann.id,
            "page_id": ann.page_id,
            "filename": ann.page.filename,
            "session_token": ann.session.session_token,
            "publication_date": ann.publication_date,
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
            "regions": [
                {
                    "region_type": r.region_type,
                    "title": r.title,
                    "x": r.x,
                    "y": r.y,
                    "width": r.width,
                    "height": r.height,
                }
                for r in ann.regions
            ],
        })

    return JSONResponse(data)
