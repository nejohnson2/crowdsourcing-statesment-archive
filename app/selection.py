"""
Page selection algorithm.

Priority order:
1. Pages with 1-9 annotations (in_progress) not yet seen by this session
2. Pages with 0 annotations (pending) not yet seen by this session
3. None — all pages are either complete or already seen by this session
"""

from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession
from app.models import Page, Annotation

MIN_ANNOTATIONS = 10


def get_next_page(db: DBSession, session_id: int, skip_ids: list[int] | None = None) -> Page | None:
    # Subquery: page IDs already annotated by this session
    seen_subq = (
        db.query(Annotation.page_id)
        .filter(Annotation.session_id == session_id)
        .subquery()
    )

    # Combine annotated + skipped page IDs to exclude
    exclude_ids = db.query(seen_subq.c.page_id)
    extra_exclude = skip_ids or []

    # Priority 1: in-progress pages (1 to MIN_ANNOTATIONS-1 annotations)
    q = db.query(Page).filter(
        Page.status == "in_progress",
        Page.id.notin_(exclude_ids),
    )
    if extra_exclude:
        q = q.filter(Page.id.notin_(extra_exclude))
    page = q.order_by(func.random()).first()
    if page:
        return page

    # Priority 2: un-annotated pages
    q = db.query(Page).filter(
        Page.status == "pending",
        Page.id.notin_(exclude_ids),
    )
    if extra_exclude:
        q = q.filter(Page.id.notin_(extra_exclude))
    page = q.order_by(func.random()).first()
    if page:
        page.status = "in_progress"
        db.commit()
        return page

    # All pages complete or already seen by this session
    return None


def record_annotation(db: DBSession, page: Page) -> None:
    """Update page annotation count and status after a new annotation."""
    page.annotation_count = page.annotation_count + 1
    if page.annotation_count >= MIN_ANNOTATIONS:
        page.status = "complete"
    db.commit()
