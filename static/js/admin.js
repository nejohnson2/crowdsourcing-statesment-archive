/**
 * Admin dashboard — fetches stats and page list.
 */

let currentPage = 1;
let currentSort = "annotation_count";
let currentOrder = "desc";

document.addEventListener("DOMContentLoaded", () => {
    loadStats();
    loadPages();
});

async function loadStats() {
    try {
        const resp = await fetch("/api/admin/stats");
        const data = await resp.json();

        document.getElementById("stat-total").textContent = data.total_pages.toLocaleString();
        document.getElementById("stat-complete").textContent =
            `${data.complete.toLocaleString()} (${data.pct_complete}%)`;
        document.getElementById("stat-in-progress").textContent =
            `${data.in_progress.toLocaleString()} (${data.pct_in_progress}%)`;
        document.getElementById("stat-not-started").textContent =
            `${data.not_started.toLocaleString()} (${data.pct_not_started}%)`;
        document.getElementById("stat-annotations").textContent =
            data.total_annotations.toLocaleString();
        document.getElementById("stat-sessions").textContent =
            data.unique_sessions.toLocaleString();

        const bar = document.getElementById("progress-bar");
        bar.style.width = data.pct_complete + "%";
        bar.textContent = data.pct_complete + "%";

        document.getElementById("stats-loading").style.display = "none";
        document.getElementById("stats-ui").style.display = "";
    } catch (err) {
        document.getElementById("stats-loading").textContent = "Error loading stats.";
        console.error(err);
    }
}

async function loadPages() {
    const params = new URLSearchParams({
        page: currentPage,
        per_page: 50,
        sort: currentSort,
        order: currentOrder,
    });

    try {
        const resp = await fetch("/api/admin/pages?" + params);
        const data = await resp.json();

        const tbody = document.getElementById("pages-tbody");
        tbody.innerHTML = data.pages.map((p) => {
            const statusClass = `status-${p.status}`;
            const statusLabel = p.status === "in_progress" ? "In Progress"
                : p.status.charAt(0).toUpperCase() + p.status.slice(1);
            return `
            <tr>
                <td>${p.id}</td>
                <td>${escapeHtml(p.filename)}</td>
                <td>${p.annotation_count}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            </tr>`;
        }).join("");

        renderPagination(data.total, data.page, data.per_page);
    } catch (err) {
        console.error("Failed to load pages:", err);
    }
}

function sortBy(col) {
    if (currentSort === col) {
        currentOrder = currentOrder === "desc" ? "asc" : "desc";
    } else {
        currentSort = col;
        currentOrder = col === "filename" ? "asc" : "desc";
    }
    currentPage = 1;
    loadPages();
}

function renderPagination(total, page, perPage) {
    const totalPages = Math.ceil(total / perPage);
    const container = document.getElementById("pagination");

    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    let html = "";
    if (page > 1) {
        html += `<button class="btn btn-sm" onclick="goToPage(${page - 1})">Prev</button>`;
    }
    html += `<span style="padding:0.35rem 0.5rem;font-size:0.85rem;">
        Page ${page} of ${totalPages}
    </span>`;
    if (page < totalPages) {
        html += `<button class="btn btn-sm" onclick="goToPage(${page + 1})">Next</button>`;
    }
    container.innerHTML = html;
}

function goToPage(p) {
    currentPage = p;
    loadPages();
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
