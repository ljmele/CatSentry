// ui.js - UI utilities, sync settings, CSV import/export, advanced mode

window.App = window.App || {};
App.ui = App.ui || {};

App.ui.ensureToastContainer = function ensureToastContainer() {
    let container = document.getElementById("toastContainer");
    if (container) return container;

    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
    return container;
};

App.ui.showToast = function showToast(message, type = "info", timeout = 3500) {
    const container = App.ui.ensureToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add("toast-hide");
        window.setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 220);
    }, timeout);
};

App.ui.updateLog = function updateLog(text) {
    const logDiv = document.getElementById("log");
    logDiv.innerHTML = `<div>> ${text}</div>` + logDiv.innerHTML;
};

App.ui.updateRecentEvents = function updateRecentEvents() {
    const listEl = document.getElementById("recentEventsList");
    if (!listEl) return;

    if (App.state.eventHistory.length === 0) {
        listEl.innerHTML = '<li class="no-events">No events recorded yet</li>';
        return;
    }

    const processedEvents = (App.dataModel && App.dataModel.processedEvents) || [];
    const processedMap = new Map();
    processedEvents.forEach(pe => {
        const key = `${pe.timestamp}-${pe.type}`;
        processedMap.set(key, pe);
    });

    const recent = [...App.state.eventHistory]
        .filter(e => e.timestamp >= MIN_VALID_TIMESTAMP)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50);

    listEl.innerHTML = recent.map(event => {
        const date = new Date(event.timestamp);
        const typeLabel = event.type === 1 ? "ENTRY" : "EXIT";
        const baseTypeClass = event.type === 1 ? "entry" : "exit";
        const icon = event.type === 1 ? "🏠" : "🌳";

        const key = `${event.timestamp}-${event.type}`;
        const processed = processedMap.get(key);
        const isEffective = processed ? processed.effective : true;
        const reason = processed ? processed.reason : "";

        const typeClass = isEffective ? baseTypeClass : "ignored";
        const rowClass = isEffective ? "" : "ignored";

        const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const dateStr = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();

        let displayDate = dateStr;
        if (isToday) displayDate = "Today";
        else if (isYesterday) displayDate = "Yesterday";

        return `
                <li class="${rowClass}">
                    <span>
                        <span class="event-type ${typeClass}">${icon} ${typeLabel}</span>
                        ${reason ? `<span class="event-reason">${reason}</span>` : ""}
                    </span>
                    <span>
                        <span class="event-date">${displayDate}</span>
                        <span class="event-time"> at ${timeStr}</span>
                    </span>
                </li>
            `;
    }).join("");
};

App.ui.downloadCSV = function downloadCSV() {
    const processedEvents = (App.dataModel && App.dataModel.processedEvents) || [];
    const processedMap = new Map();
    processedEvents.forEach(pe => {
        const key = `${pe.timestamp}-${pe.type}`;
        processedMap.set(key, pe);
    });

    let csv = "Timestamp,Date,Type,Effective,Reason\n";
    const sorted = [...App.state.eventHistory].sort((a, b) => a.timestamp - b.timestamp);
    sorted.forEach(e => {
        const dateStr = new Date(e.timestamp).toLocaleString();
        const typeStr = e.type === 1 ? "ENTRY" : "EXIT";

        const key = `${e.timestamp}-${e.type}`;
        const processed = processedMap.get(key);
        const effective = processed ? (processed.effective ? "Yes" : "No") : "Unknown";
        const reason = processed ? processed.reason.replace(/,/g, ";") : "";

        csv += `${e.timestamp},"${dateStr}",${typeStr},${effective},"${reason}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cat_sentry_data.csv";
    a.click();
};

App.ui.openSettings = function openSettings() {
    let owner = prompt("GitHub Username:", ghStorage.config.owner);
    if (owner === null) return;

    let repo = prompt("Repository Name (e.g., CatSentry):", ghStorage.config.repo);
    if (repo === null) return;

    let token = prompt("Personal Access Token (starts with ghp_...):", ghStorage.config.token);
    if (token === null) return;

    owner = owner.trim();
    repo = repo.trim();
    token = token.trim();

    const ownerValid = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner);
    const repoValid = /^[A-Za-z0-9._-]{1,100}$/.test(repo);
    const tokenValid = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(token);

    if (!ownerValid) {
        App.ui.showToast("Invalid GitHub username format.", "error");
        return;
    }

    if (!repoValid) {
        App.ui.showToast("Invalid repository name format.", "error");
        return;
    }

    if (!tokenValid) {
        App.ui.showToast("Invalid GitHub token format.", "error");
        return;
    }

    if (owner && repo && token) {
        ghStorage.saveConfig(owner, repo, token);
        App.ui.updateLog(`Credentials saved for: ${owner}/${repo}`);
        App.ui.showToast("GitHub credentials saved.", "success");
        App.ui.syncWithCloud();
    } else {
        App.ui.updateLog("Error: Setup cancelled or fields empty.");
        App.ui.showToast("Setup cancelled or fields empty.", "warning");
    }
};

App.ui.syncWithCloud = async function syncWithCloud() {
    const remoteData = await ghStorage.pullData();

    if (remoteData) {
        const validRemote = remoteData.filter(e => e.timestamp >= MIN_VALID_TIMESTAMP);

        const merged = [...App.state.eventHistory, ...validRemote];
        const uniqueStringEvents = new Set(merged.map(e => JSON.stringify(e)));
        App.state.eventHistory = Array.from(uniqueStringEvents).map(s => JSON.parse(s));

        App.saveData();
        App.updateUI();
    }

    await ghStorage.pushData(App.state.eventHistory);
};

App.ui.openAdvancedMode = function openAdvancedMode() {
    if (!App.state.advancedModeUnlocked) {
        const bleConnected = App.state.device && App.state.device.gatt && App.state.device.gatt.connected;
        const githubConfigured = ghStorage && ghStorage.isConfigured;

        if (bleConnected && githubConfigured) {
            App.state.advancedModeUnlocked = true;
            App.ui.updateLog("Advanced Mode unlocked (BLE + GitHub verified).");
        } else {
            const missing = [];
            if (!bleConnected) missing.push("Bluetooth connection");
            if (!githubConfigured) missing.push("GitHub sync configured");

            App.ui.showToast(`Advanced Mode locked. Missing: ${missing.join(", ")}.`, "warning", 5000);
            return;
        }
    }

    document.getElementById("advancedModal").classList.add("active");
    App.ui.renderHistoryTable();
};

App.ui.closeAdvancedMode = function closeAdvancedMode() {
    document.getElementById("advancedModal").classList.remove("active");
};

App.ui.parseCSV = function parseCSV(csvText) {
    const parseLine = line => {
        const fields = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const next = line[i + 1];

            if (char === '"') {
                if (inQuotes && next === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === "," && !inQuotes) {
                fields.push(current.trim());
                current = "";
                continue;
            }

            current += char;
        }

        fields.push(current.trim());
        return fields;
    };

    const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];

    const events = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const fields = parseLine(line);
        if (fields.length < 3) continue;

        const timestamp = Number(fields[0]);
        const rawType = (fields[2] || "").replace(/[^A-Za-z0-9_-]/g, "").toUpperCase();
        const type = rawType === "ENTRY" || rawType === "1"
            ? 1
            : rawType === "EXIT" || rawType === "2"
                ? 2
                : 0;

        if (App.isValidEvent(timestamp, type)) {
            events.push({ timestamp, type });
        }
    }

    return events;
};

App.ui.handleCSVRestore = function handleCSVRestore(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function onLoad(e) {
        const csvText = e.target.result;
        const importedEvents = App.ui.parseCSV(csvText);

        if (importedEvents.length === 0) {
            App.ui.showToast("No valid events found in the CSV file.", "warning");
            return;
        }

        const existingSet = new Set(App.state.eventHistory.map(item => `${item.timestamp}-${item.type}`));
        let newCount = 0;

        for (const item of importedEvents) {
            const key = `${item.timestamp}-${item.type}`;
            if (!existingSet.has(key)) {
                App.state.eventHistory.push(item);
                existingSet.add(key);
                newCount++;
            }
        }

        if (newCount > 0) {
            App.saveData();
            App.updateUI();
            App.ui.renderHistoryTable();

            App.ui.updateLog(`CSV import: Added ${newCount} new events (${importedEvents.length - newCount} duplicates skipped).`);

            if (ghStorage && ghStorage.isConfigured) {
                ghStorage.pushData(App.state.eventHistory);
            }

            App.ui.showToast(
                `Imported ${newCount} new events (${importedEvents.length - newCount} duplicates skipped).`,
                "success",
                4500
            );
        } else {
            App.ui.showToast("All CSV events already exist. Nothing imported.", "info");
        }
    };

    reader.readAsText(file);
    event.target.value = "";
};

App.ui.replaceFromCSV = function replaceFromCSV() {
    if (!confirm("⚠️ WARNING: This will DELETE ALL current data and replace it with the CSV file.\n\nAre you sure?")) {
        return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";

    input.onchange = function onChange(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function onLoad(e) {
            const csvText = e.target.result;
            const importedEvents = App.ui.parseCSV(csvText);

            if (importedEvents.length === 0) {
                App.ui.showToast("No valid events in CSV. Data was not replaced.", "warning");
                return;
            }

            if (!confirm(`Found ${importedEvents.length} events in the CSV.\n\nThis will REPLACE your current ${App.state.eventHistory.length} events.\n\nContinue?`)) {
                return;
            }

            App.state.eventHistory = importedEvents;
            App.saveData();
            App.updateUI();
            App.ui.renderHistoryTable();

            App.ui.updateLog(`CSV replace: Loaded ${importedEvents.length} events from backup.`);

            if (ghStorage && ghStorage.isConfigured) {
                ghStorage.pushData(App.state.eventHistory);
            }

            App.ui.showToast(`Data replaced with ${importedEvents.length} CSV events.`, "success", 4500);
        };

        reader.readAsText(file);
    };

    input.click();
};

App.ui.clearFilters = function clearFilters() {
    document.getElementById("filterType").value = "all";
    document.getElementById("filterDateFrom").value = "";
    document.getElementById("filterDateTo").value = "";
    App.ui.renderHistoryTable();
};

App.ui.getFilteredEvents = function getFilteredEvents() {
    const typeFilter = document.getElementById("filterType").value;
    const dateFrom = document.getElementById("filterDateFrom").value;
    const dateTo = document.getElementById("filterDateTo").value;

    const processedEvents = (App.dataModel && App.dataModel.processedEvents) || [];
    const processedMap = new Map();
    processedEvents.forEach(pe => {
        const key = `${pe.timestamp}-${pe.type}`;
        processedMap.set(key, pe);
    });

    let filtered = [...App.state.eventHistory]
        .filter(e => e.timestamp >= MIN_VALID_TIMESTAMP)
        .map(e => {
            const key = `${e.timestamp}-${e.type}`;
            const processed = processedMap.get(key);
            return {
                ...e,
                effective: processed ? processed.effective : true,
                reason: processed ? processed.reason : ""
            };
        });

    if (typeFilter === "1") {
        filtered = filtered.filter(e => e.type === 1);
    } else if (typeFilter === "2") {
        filtered = filtered.filter(e => e.type === 2);
    } else if (typeFilter === "effective") {
        filtered = filtered.filter(e => e.effective);
    } else if (typeFilter === "ignored") {
        filtered = filtered.filter(e => !e.effective);
    }

    if (dateFrom) {
        const fromTs = new Date(dateFrom).setHours(0, 0, 0, 0);
        filtered = filtered.filter(e => e.timestamp >= fromTs);
    }
    if (dateTo) {
        const toTs = new Date(dateTo).setHours(23, 59, 59, 999);
        filtered = filtered.filter(e => e.timestamp <= toTs);
    }

    return filtered.sort((a, b) => b.timestamp - a.timestamp);
};

App.ui.renderHistoryTable = function renderHistoryTable() {
    const tbody = document.getElementById("historyTableBody");
    const statsEl = document.getElementById("historyStats");

    const filtered = App.ui.getFilteredEvents();

    const totalEvents = App.state.eventHistory.filter(e => e.timestamp >= MIN_VALID_TIMESTAMP).length;
    const effectiveCount = filtered.filter(e => e.effective).length;
    const ignoredCount = filtered.filter(e => !e.effective).length;
    statsEl.textContent = `Showing ${filtered.length} of ${totalEvents} events | Effective: ${effectiveCount} | Ignored: ${ignoredCount}`;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #666;">No events match the current filters</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((event, idx) => {
        const date = new Date(event.timestamp);
        const dateStr = date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
        const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const typeLabel = event.type === 1 ? "ENTRY" : "EXIT";
        const typeClass = event.type === 1 ? "entry" : "exit";
        const rowClass = event.effective ? "" : "ignored";
        const statusText = event.effective ? "✅ Effective" : "⏭️ Ignored";

        return `
                <tr class="${rowClass}" data-timestamp="${event.timestamp}" data-type="${event.type}">
                    <td>${filtered.length - idx}</td>
                    <td>${dateStr}</td>
                    <td>${timeStr}</td>
                    <td><span class="type-badge ${typeClass}">${typeLabel}</span></td>
                    <td>${statusText}</td>
                    <td style="font-size: 11px; color: #888;">${event.reason || "-"}</td>
                    <td><button class="delete-btn" onclick="deleteEvent(${event.timestamp}, ${event.type})">🗑️ Delete</button></td>
                </tr>
            `;
    }).join("");
};

App.ui.deleteEvent = function deleteEvent(timestamp, type) {
    const date = new Date(timestamp);
    const typeLabel = type === 1 ? "ENTRY" : "EXIT";

    if (!confirm(`Delete this event?\n\n${typeLabel} at ${date.toLocaleString()}\n\nThis cannot be undone.`)) {
        return;
    }

    const idx = App.state.eventHistory.findIndex(e => e.timestamp === timestamp && e.type === type);
    if (idx !== -1) {
        App.state.eventHistory.splice(idx, 1);

        App.saveData();
        App.updateUI();
        App.ui.renderHistoryTable();

        App.ui.updateLog(`Deleted ${typeLabel} event from ${date.toLocaleString()}`);

        if (ghStorage && ghStorage.isConfigured) {
            ghStorage.pushData(App.state.eventHistory);
        }
    }
};

App.ui.deleteFiltered = function deleteFiltered() {
    const filtered = App.ui.getFilteredEvents();

    if (filtered.length === 0) {
        App.ui.showToast("No events match the current filters.", "info");
        return;
    }

    if (!confirm(`⚠️ DELETE ${filtered.length} EVENTS?\n\nThis will permanently remove all currently filtered events.\n\nThis cannot be undone!`)) {
        return;
    }

    if (!confirm(`Are you REALLY sure? Type count: ${filtered.length} events will be deleted.`)) {
        return;
    }

    const toDelete = new Set(filtered.map(e => `${e.timestamp}-${e.type}`));

    const before = App.state.eventHistory.length;
    App.state.eventHistory = App.state.eventHistory.filter(e => !toDelete.has(`${e.timestamp}-${e.type}`));
    const deleted = before - App.state.eventHistory.length;

    App.saveData();
    App.updateUI();
    App.ui.renderHistoryTable();

    App.ui.updateLog(`Bulk deleted ${deleted} events.`);

    if (ghStorage && ghStorage.isConfigured) {
        ghStorage.pushData(App.state.eventHistory);
    }
};

App.ui.installModalHandlers = function installModalHandlers() {
    App.ui.ensureToastContainer();

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") App.ui.closeAdvancedMode();
    });

    document.getElementById("advancedModal").addEventListener("click", e => {
        if (e.target.id === "advancedModal") App.ui.closeAdvancedMode();
    });
};

window.updateLog = App.ui.updateLog;
window.showToast = App.ui.showToast;
window.updateRecentEvents = App.ui.updateRecentEvents;
window.downloadCSV = App.ui.downloadCSV;
window.openSettings = App.ui.openSettings;
window.syncWithCloud = App.ui.syncWithCloud;
window.openAdvancedMode = App.ui.openAdvancedMode;
window.closeAdvancedMode = App.ui.closeAdvancedMode;
window.parseCSV = App.ui.parseCSV;
window.handleCSVRestore = App.ui.handleCSVRestore;
window.replaceFromCSV = App.ui.replaceFromCSV;
window.clearFilters = App.ui.clearFilters;
window.getFilteredEvents = App.ui.getFilteredEvents;
window.renderHistoryTable = App.ui.renderHistoryTable;
window.deleteEvent = App.ui.deleteEvent;
window.deleteFiltered = App.ui.deleteFiltered;

window.addEventListener("DOMContentLoaded", () => {
    App.ui.installModalHandlers();
});
