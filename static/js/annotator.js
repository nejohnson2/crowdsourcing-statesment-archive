/**
 * Annotation canvas powered by Fabric.js.
 *
 * Users draw bounding-box rectangles on a newspaper page image,
 * classify each region, and submit the results.
 */

const REGION_TYPES = [
    { value: "article", label: "Article" },
    { value: "advertisement", label: "Advertisement" },
    { value: "photograph", label: "Photograph / Image" },
    { value: "editorial", label: "Editorial / Opinion" },
    { value: "masthead", label: "Masthead / Header" },
    { value: "cartoon", label: "Cartoon / Comic" },
    { value: "letter", label: "Letter to Editor" },
    { value: "other", label: "Other" },
];

const COLORS = [
    "#e53e3e", "#dd6b20", "#d69e2e", "#38a169",
    "#3182ce", "#805ad5", "#d53f8c", "#718096",
];

let canvas;
let currentPageId = null;
let regions = [];       // { rect, id, type, title, label }
let regionIdCounter = 0;
let isDrawing = false;
let drawMode = true;
let drawOrigin = null;
let activeRect = null;
let imgWidth = 1;
let imgHeight = 1;
let skippedPages = [];  // page IDs skipped this session

// Zoom / pan state
let currentZoom = 1;
let isPanning = false;
let panStart = null;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

// Base canvas dimensions (at zoom 1)
let baseCanvasW = 800;
let baseCanvasH = 600;

// ---------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    canvas = new fabric.Canvas("annotation-canvas", {
        selection: false,
    });

    document.getElementById("btn-draw").addEventListener("click", () => setDrawMode(true));
    document.getElementById("btn-select").addEventListener("click", () => setDrawMode(false));
    document.getElementById("btn-delete").addEventListener("click", deleteSelected);
    document.getElementById("btn-submit").addEventListener("click", submitAnnotations);
    document.getElementById("btn-skip").addEventListener("click", skipPage);
    document.getElementById("btn-zoom-in").addEventListener("click", () => zoomBy(1.25));
    document.getElementById("btn-zoom-out").addEventListener("click", () => zoomBy(0.8));
    document.getElementById("btn-zoom-reset").addEventListener("click", zoomReset);

    // Mouse-wheel zoom
    canvas.on("mouse:wheel", (opt) => {
        const delta = opt.e.deltaY;
        const factor = delta < 0 ? 1.08 : 0.92;
        const pointer = canvas.getPointer(opt.e, true);
        zoomToPoint(currentZoom * factor, pointer);
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    // Alt+drag panning
    canvas.on("mouse:down", (opt) => {
        if (opt.e.altKey) {
            isPanning = true;
            panStart = { x: opt.e.clientX, y: opt.e.clientY };
            canvas.selection = false;
            opt.e.preventDefault();
        }
    });
    canvas.on("mouse:move", (opt) => {
        if (isPanning && panStart) {
            const vpt = canvas.viewportTransform.slice();
            vpt[4] += opt.e.clientX - panStart.x;
            vpt[5] += opt.e.clientY - panStart.y;
            canvas.setViewportTransform(vpt);
            panStart = { x: opt.e.clientX, y: opt.e.clientY };
            opt.e.preventDefault();
        }
    });
    canvas.on("mouse:up", () => {
        isPanning = false;
        panStart = null;
    });

    // Keep labels in sync when rectangles are moved/resized
    canvas.on("object:moving", syncLabelPosition);
    canvas.on("object:scaling", syncLabelPosition);
    canvas.on("object:modified", onObjectModified);

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
        // Ignore if typing in an input
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
        switch (e.key) {
            case "d": case "D": setDrawMode(true); break;
            case "s": case "S": setDrawMode(false); break;
            case "Delete": case "Backspace": deleteSelected(); break;
            case "=": case "+": zoomBy(1.25); e.preventDefault(); break;
            case "-": zoomBy(0.8); e.preventDefault(); break;
            case "0": zoomReset(); e.preventDefault(); break;
        }
    });

    loadNextPage();
});

// ---------------------------------------------------------------
// Page loading
// ---------------------------------------------------------------

async function loadNextPage() {
    document.getElementById("loading").style.display = "";
    document.getElementById("annotate-ui").style.display = "none";
    document.getElementById("no-pages").style.display = "none";

    // Reset state
    regions = [];
    regionIdCounter = 0;
    currentPageId = null;
    document.getElementById("pub-date").value = "";
    document.getElementById("btn-submit").disabled = true;

    try {
        const skipParam = skippedPages.length ? `?skip=${skippedPages.join(",")}` : "";
        const resp = await fetch("/api/page/next" + skipParam);
        if (resp.status === 404) {
            document.getElementById("loading").style.display = "none";
            document.getElementById("no-pages").style.display = "";
            return;
        }
        const data = await resp.json();
        currentPageId = data.id;
        document.getElementById("page-filename").textContent = data.filename;
        await loadImage(data.image_url);
    } catch (err) {
        console.error("Failed to load page:", err);
        document.getElementById("loading-text").textContent = "Error loading page. Please try again.";
    }
}

function loadImage(url) {
    return new Promise((resolve) => {
        // Show the UI first so the wrapper has a measurable width
        document.getElementById("loading").style.display = "none";
        document.getElementById("annotate-ui").style.display = "";

        const wrapper = document.getElementById("canvas-wrapper");
        const maxWidth = wrapper.clientWidth || 800;

        fabric.Image.fromURL(url, (img) => {
            const scale = maxWidth / img.width;
            const displayWidth = maxWidth;
            const displayHeight = img.height * scale;

            imgWidth = img.width;
            imgHeight = img.height;
            baseCanvasW = displayWidth;
            baseCanvasH = displayHeight;

            canvas.clear();
            canvas.setWidth(displayWidth);
            canvas.setHeight(displayHeight);
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            currentZoom = 1;
            updateZoomDisplay();

            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
                scaleX: scale,
                scaleY: scale,
            });

            setDrawMode(true);
            updateRegionList();
            resolve();
        }, { crossOrigin: "anonymous" });
    });
}

// ---------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------

function zoomBy(factor) {
    const center = { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 };
    zoomToPoint(currentZoom * factor, center);
}

function zoomToPoint(newZoom, point) {
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    canvas.zoomToPoint(new fabric.Point(point.x, point.y), newZoom);
    currentZoom = newZoom;
    updateZoomDisplay();
}

function zoomReset() {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    currentZoom = 1;
    updateZoomDisplay();
}

function updateZoomDisplay() {
    document.getElementById("zoom-level").textContent = Math.round(currentZoom * 100) + "%";
}

// ---------------------------------------------------------------
// Draw mode
// ---------------------------------------------------------------

function setDrawMode(on) {
    drawMode = on;
    document.getElementById("btn-draw").classList.toggle("btn-primary", on);
    document.getElementById("btn-select").classList.toggle("btn-primary", !on);

    canvas.forEachObject((obj) => {
        if (obj._isLabel) {
            // Labels never selectable
            obj.selectable = false;
            obj.evented = false;
        } else {
            obj.selectable = !on;
            obj.evented = !on;
        }
    });
    canvas.discardActiveObject();
    canvas.renderAll();

    // Remove draw listeners, then re-add if needed
    canvas.off("mouse:down", onDrawStart);
    canvas.off("mouse:move", onDrawMove);
    canvas.off("mouse:up", onDrawEnd);

    if (on) {
        canvas.on("mouse:down", onDrawStart);
        canvas.on("mouse:move", onDrawMove);
        canvas.on("mouse:up", onDrawEnd);
        canvas.defaultCursor = "crosshair";
        canvas.hoverCursor = "crosshair";
    } else {
        canvas.defaultCursor = "default";
        canvas.hoverCursor = "move";
    }
}

function onDrawStart(opt) {
    if (!drawMode || isPanning) return;
    if (opt.e.altKey) return; // alt is for panning
    if (opt.target) return;

    isDrawing = true;
    const pointer = canvas.getPointer(opt.e);
    drawOrigin = { x: pointer.x, y: pointer.y };

    const colorIdx = regions.length % COLORS.length;

    activeRect = new fabric.Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: COLORS[colorIdx] + "22",
        stroke: COLORS[colorIdx],
        strokeWidth: 2,
        selectable: false,
        evented: false,
        // Editable box config
        lockRotation: true,
        hasRotatingPoint: false,
        cornerStyle: "circle",
        cornerSize: 8,
        cornerColor: COLORS[colorIdx],
        transparentCorners: false,
        strokeUniform: true,
    });
    canvas.add(activeRect);
}

function onDrawMove(opt) {
    if (!isDrawing || !activeRect) return;
    const pointer = canvas.getPointer(opt.e);

    const left = Math.min(drawOrigin.x, pointer.x);
    const top = Math.min(drawOrigin.y, pointer.y);
    const width = Math.abs(pointer.x - drawOrigin.x);
    const height = Math.abs(pointer.y - drawOrigin.y);

    activeRect.set({ left, top, width, height });
    canvas.renderAll();
}

function onDrawEnd() {
    if (!isDrawing || !activeRect) return;
    isDrawing = false;

    // Ignore tiny accidental clicks
    if (activeRect.width < 5 && activeRect.height < 5) {
        canvas.remove(activeRect);
        activeRect = null;
        return;
    }

    const id = ++regionIdCounter;
    const colorIdx = regions.length % COLORS.length;

    // Add label number
    const label = new fabric.Text(String(regions.length + 1), {
        left: activeRect.left + 4,
        top: activeRect.top + 2,
        fontSize: 16,
        fontWeight: "bold",
        fill: COLORS[colorIdx],
        selectable: false,
        evented: false,
    });
    label._isLabel = true;
    canvas.add(label);

    regions.push({
        id,
        rect: activeRect,
        label,
        type: "article",
        title: "",
    });

    activeRect = null;
    updateRegionList();
}

// ---------------------------------------------------------------
// Editable box helpers
// ---------------------------------------------------------------

function syncLabelPosition(opt) {
    const target = opt.target;
    const region = regions.find((r) => r.rect === target);
    if (!region) return;

    // Get the actual bounding rect (accounts for scaling)
    const bound = target.getBoundingRect(true);
    const vpt = canvas.viewportTransform;
    // Convert screen coords back to canvas coords
    const left = (bound.left - vpt[4]) / vpt[0];
    const top = (bound.top - vpt[5]) / vpt[3];

    region.label.set({ left: left + 4, top: top + 2 });
    canvas.renderAll();
}

function onObjectModified(opt) {
    const target = opt.target;
    const region = regions.find((r) => r.rect === target);
    if (!region) return;

    // After scaling, bake scale into width/height and reset scaleX/Y to 1
    const newWidth = target.width * target.scaleX;
    const newHeight = target.height * target.scaleY;
    target.set({
        width: newWidth,
        height: newHeight,
        scaleX: 1,
        scaleY: 1,
    });
    target.setCoords();

    // Update label position
    region.label.set({
        left: target.left + 4,
        top: target.top + 2,
    });
    canvas.renderAll();
}

// ---------------------------------------------------------------
// Region management
// ---------------------------------------------------------------

function updateRegionList() {
    const list = document.getElementById("region-list");
    const noRegions = document.getElementById("no-regions");
    document.getElementById("region-count").textContent = regions.length;
    document.getElementById("btn-submit").disabled = regions.length === 0;

    if (regions.length === 0) {
        list.innerHTML = "";
        noRegions.style.display = "";
        return;
    }
    noRegions.style.display = "none";

    list.innerHTML = regions.map((r, idx) => {
        const color = COLORS[idx % COLORS.length];
        const options = REGION_TYPES.map(
            (rt) => `<option value="${rt.value}" ${rt.value === r.type ? "selected" : ""}>${rt.label}</option>`
        ).join("");

        return `
        <div class="region-item" style="border-left: 3px solid ${color};">
            <div class="region-header">
                <strong style="color:${color};">Region ${idx + 1}</strong>
                <button class="btn btn-sm btn-danger" onclick="removeRegion(${r.id})">Remove</button>
            </div>
            <label>Type</label>
            <select onchange="updateRegionType(${r.id}, this.value)">${options}</select>
            <label>Title / Headline</label>
            <input type="text" value="${escapeHtml(r.title)}" placeholder="Optional"
                   onchange="updateRegionTitle(${r.id}, this.value)">
        </div>`;
    }).join("");
}

function removeRegion(id) {
    const idx = regions.findIndex((r) => r.id === id);
    if (idx === -1) return;

    const region = regions[idx];
    canvas.remove(region.rect);
    canvas.remove(region.label);
    regions.splice(idx, 1);

    // Renumber labels and recolor
    regions.forEach((r, i) => {
        const c = COLORS[i % COLORS.length];
        r.label.set({ text: String(i + 1), fill: c });
        r.rect.set({ stroke: c, fill: c + "22", cornerColor: c });
    });
    canvas.renderAll();
    updateRegionList();
}

function updateRegionType(id, value) {
    const region = regions.find((r) => r.id === id);
    if (region) region.type = value;
}

function updateRegionTitle(id, value) {
    const region = regions.find((r) => r.id === id);
    if (region) region.title = value;
}

function deleteSelected() {
    const active = canvas.getActiveObject();
    if (!active) return;

    const region = regions.find((r) => r.rect === active);
    if (region) removeRegion(region.id);
}

// ---------------------------------------------------------------
// Skip
// ---------------------------------------------------------------

function skipPage() {
    if (currentPageId) {
        skippedPages.push(currentPageId);
    }
    loadNextPage();
}

// ---------------------------------------------------------------
// Submission
// ---------------------------------------------------------------

async function submitAnnotations() {
    if (regions.length === 0 || !currentPageId) return;

    const btn = document.getElementById("btn-submit");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    const payload = {
        publication_date: document.getElementById("pub-date").value.trim() || null,
        regions: regions.map((r) => ({
            region_type: r.type,
            title: r.title || null,
            x: r.rect.left / baseCanvasW,
            y: r.rect.top / baseCanvasH,
            width: r.rect.width / baseCanvasW,
            height: r.rect.height / baseCanvasH,
        })),
    };

    try {
        const resp = await fetch(`/api/page/${currentPageId}/annotate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (resp.ok) {
            document.getElementById("annotate-ui").style.display = "none";
            document.getElementById("loading").style.display = "";
            document.getElementById("loading-text").textContent = "Saved! Loading next page…";
            setTimeout(() => {
                document.getElementById("loading-text").textContent = "Loading next page…";
                loadNextPage();
            }, 800);
        } else {
            const err = await resp.json();
            alert("Submission error: " + (err.detail || "Unknown error"));
            btn.disabled = false;
            btn.textContent = "Submit Annotations";
        }
    } catch (err) {
        alert("Network error. Please try again.");
        btn.disabled = false;
        btn.textContent = "Submit Annotations";
    }
}

// ---------------------------------------------------------------
// Utility
// ---------------------------------------------------------------

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
