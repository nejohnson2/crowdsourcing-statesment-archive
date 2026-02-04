from pydantic import BaseModel, Field


class RegionSubmission(BaseModel):
    region_type: str
    title: str | None = None
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class AnnotationSubmission(BaseModel):
    publication_date: str | None = None
    regions: list[RegionSubmission]


class PageResponse(BaseModel):
    id: int
    filename: str
    image_url: str


class StatsResponse(BaseModel):
    total_pages: int
    not_started: int
    in_progress: int
    complete: int
    pct_not_started: float
    pct_in_progress: float
    pct_complete: float
    total_annotations: int
    unique_sessions: int


class PageListItem(BaseModel):
    id: int
    filename: str
    annotation_count: int
    status: str


class PaginatedPages(BaseModel):
    pages: list[PageListItem]
    total: int
    page: int
    per_page: int
