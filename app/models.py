from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, Text, Float, DateTime, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import relationship
from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Page(Base):
    __tablename__ = "pages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_path = Column(Text, nullable=False, unique=True)
    filename = Column(Text, nullable=False)
    annotation_count = Column(Integer, default=0, nullable=False)
    status = Column(Text, default="pending", nullable=False)  # pending/in_progress/complete
    created_at = Column(DateTime, default=utcnow)

    annotations = relationship("Annotation", back_populates="page", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_pages_status", "status"),
        Index("idx_pages_annotation_count", "annotation_count"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_token = Column(Text, unique=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    last_active = Column(DateTime, default=utcnow, onupdate=utcnow)

    annotations = relationship("Annotation", back_populates="session")


class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    page_id = Column(Integer, ForeignKey("pages.id"), nullable=False)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    publication_date = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    page = relationship("Page", back_populates="annotations")
    session = relationship("Session", back_populates="annotations")
    regions = relationship("Region", back_populates="annotation", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("page_id", "session_id", name="uq_page_session"),
    )


class Region(Base):
    __tablename__ = "regions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    annotation_id = Column(Integer, ForeignKey("annotations.id", ondelete="CASCADE"), nullable=False)
    region_type = Column(Text, nullable=False)
    title = Column(Text, nullable=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)

    annotation = relationship("Annotation", back_populates="regions")
