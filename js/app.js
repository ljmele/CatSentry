// app.js - Phase 2 bootstrap, shared state, and initialization

window.App = window.App || {};

App.config = {
    serviceUUID: "19b10000-e8f2-537e-4f6c-d104768a1214",
    charUUID: "19b10001-e8f2-537e-4f6c-d104768a1214",
    timeUUID: "19b10002-e8f2-537e-4f6c-d104768a1214",
    historyUUID: "19b10003-e8f2-537e-4f6c-d104768a1214"
};

App.storage = {
    dataKey: "catSentryData",
    schemaVersion: 1
};

App.utils = {
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    async withRetry(operation, options = {}) {
        const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
        const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 400;
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation(attempt);
            } catch (error) {
                lastError = error;
                if (attempt === maxRetries) break;
                const waitMs = baseDelayMs * Math.pow(2, attempt);
                await App.utils.sleep(waitMs);
            }
        }

        throw lastError;
    }
};

App.state = {
    device: null,
    server: null,
    service: null,
    characteristic: null,
    historyChar: null,
    saveTimer: null,
    historyEventCount: 0,
    advancedModeUnlocked: false,
    eventHistory: []
};

App.dataModel = {
    dailyCounts: {},
    dailyDurations: {},
    hourlyActivity: new Array(24).fill(0),
    hourlyDuration: new Array(24).fill(0),
    stats: null,
    processedEvents: [],
    dailyHourlyDurations: {},
    catStatus: { status: "unknown", icon: "❓", text: "Unknown" },
    weatherCache: {}
};

App.isValidEvent = function isValidEvent(timestamp, type) {
    if (timestamp < MIN_VALID_TIMESTAMP) {
        console.warn(`Rejected event: timestamp ${timestamp} is before 2020`);
        return false;
    }

    if (timestamp > Date.now() + 60000) {
        console.warn(`Rejected event: timestamp ${timestamp} is in the future`);
        return false;
    }

    if (type !== 1 && type !== 2) {
        console.warn(`Rejected event: invalid type ${type}`);
        return false;
    }

    return true;
};

App.addEvent = function addEvent(timestamp, type) {
    if (!App.isValidEvent(timestamp, type)) {
        return false;
    }

    const exists = App.state.eventHistory.some(e => e.type === type && Math.abs(e.timestamp - timestamp) < 5000);
    if (exists) {
        return false;
    }

    App.state.eventHistory.push({ timestamp, type });
    return true;
};

App.migrateStorageData = function migrateStorageData() {
    const raw = localStorage.getItem(App.storage.dataKey);
    if (!raw) return [];

    const normalizeEvents = events => {
        if (!Array.isArray(events)) return [];
        return events
            .filter(item => item && Number.isFinite(item.timestamp) && Number.isFinite(item.type))
            .map(item => ({ timestamp: Number(item.timestamp), type: Number(item.type) }))
            .filter(item => App.isValidEvent(item.timestamp, item.type));
    };

    try {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
            const migrated = normalizeEvents(parsed);
            localStorage.setItem(App.storage.dataKey, JSON.stringify({
                version: App.storage.schemaVersion,
                eventHistory: migrated
            }));
            if (App.ui && typeof App.ui.showToast === "function") {
                App.ui.showToast("Data upgraded to schema v1.", "info");
            }
            return migrated;
        }

        if (parsed && typeof parsed === "object") {
            const version = Number(parsed.version);

            if (version === App.storage.schemaVersion) {
                return normalizeEvents(parsed.eventHistory);
            }

            const migrated = normalizeEvents(parsed.eventHistory || parsed.data || []);
            localStorage.setItem(App.storage.dataKey, JSON.stringify({
                version: App.storage.schemaVersion,
                eventHistory: migrated
            }));
            if (App.ui && typeof App.ui.showToast === "function") {
                App.ui.showToast(`Data migrated from schema v${Number.isFinite(version) ? version : "unknown"}.`, "info");
            }
            return migrated;
        }
    } catch (error) {
        console.warn("Failed to parse local storage data, starting with empty history.", error);
    }

    return [];
};

App.saveData = function saveData() {
    App.state.eventHistory.sort((a, b) => a.timestamp - b.timestamp);
    localStorage.setItem(App.storage.dataKey, JSON.stringify({
        version: App.storage.schemaVersion,
        eventHistory: App.state.eventHistory
    }));
};

App.getCounts = function getCounts() {
    let entryCount = 0;
    let exitCount = 0;

    for (const event of App.state.eventHistory) {
        if (event.type === 1) entryCount++;
        if (event.type === 2) exitCount++;
    }

    return { entryCount, exitCount };
};

App.refreshDataModel = function refreshDataModel() {
    const validHistory = App.state.eventHistory.filter(e => e.timestamp >= MIN_VALID_TIMESTAMP);
    const sorted = [...validHistory].sort((a, b) => a.timestamp - b.timestamp);

    const fallbackStats = {
        totalEvents: sorted.length,
        effectiveExits: 0,
        effectiveEntries: 0,
        updatedExits: 0,
        updatedEntries: 0,
        completedOutings: 0,
        invalidDurations: 0,
        totalTimeOutsideMinutes: 0
    };

    if (typeof processDataWithStateMachine !== "function") {
        App.dataModel = {
            ...App.dataModel,
            dailyCounts: {},
            dailyDurations: {},
            hourlyActivity: new Array(24).fill(0),
            hourlyDuration: new Array(24).fill(0),
            stats: fallbackStats,
            processedEvents: [],
            dailyHourlyDurations: {},
            catStatus: { status: "unknown", icon: "❓", text: "Unknown" }
        };
        return App.dataModel;
    }

    const processed = processDataWithStateMachine(sorted);

    App.dataModel = {
        ...App.dataModel,
        dailyCounts: processed.dailyCounts,
        dailyDurations: processed.dailyDurations,
        hourlyActivity: processed.hourlyActivity,
        hourlyDuration: processed.hourlyDuration,
        stats: processed.stats,
        processedEvents: processed.processedEvents,
        dailyHourlyDurations: processed.dailyHourlyDurations,
        catStatus: typeof getCatStatus === "function"
            ? getCatStatus(sorted)
            : { status: "unknown", icon: "❓", text: "Unknown" }
    };

    return App.dataModel;
};

App.updateUI = function updateUI() {
    document.getElementById("statRawEvents").textContent = App.state.eventHistory.length;

    const model = App.refreshDataModel();
    const outings = Object.values(model.dailyCounts || {}).reduce((sum, count) => sum + count, 0);
    const totalMinutes = model.stats && Number.isFinite(model.stats.totalTimeOutsideMinutes)
        ? model.stats.totalTimeOutsideMinutes
        : Object.values(model.dailyDurations || {}).reduce((sum, mins) => sum + mins, 0);

    document.getElementById("statOutings").textContent = outings;

    if (totalMinutes < 60) {
        document.getElementById("statTimeOutside").textContent = Math.round(totalMinutes) + "m";
    } else {
        const hours = Math.floor(totalMinutes / 60);
        const mins = Math.round(totalMinutes % 60);
        document.getElementById("statTimeOutside").textContent = `${hours}h ${mins}m`;
    }

    const catStatus = model.catStatus || { status: "unknown", icon: "❓", text: "Unknown" };
    document.getElementById("statCatStatus").textContent = catStatus.icon + " " + (catStatus.text || "");

    const topbarCatIcon = document.getElementById("topbarCatIcon");
    const topbarCatText = document.getElementById("topbarCatText");
    if (topbarCatIcon) topbarCatIcon.textContent = catStatus.icon || "❓";
    if (topbarCatText) topbarCatText.textContent = catStatus.text || "Unknown";

    if (App.ui && typeof App.ui.updateRecentEvents === "function") {
        App.ui.updateRecentEvents();
    }

    if (typeof updateAnalytics === "function") {
        updateAnalytics(App.state.eventHistory, model);
    }
};

App.init = function init() {
    App.state.eventHistory = App.migrateStorageData();

    App.updateUI();

    if (ghStorage && ghStorage.isConfigured && App.ui && typeof App.ui.syncWithCloud === "function") {
        App.ui.updateLog("Found GitHub credentials. Checking for updates...");
        App.ui.syncWithCloud();
    }

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js")
            .catch(() => {});
    }
};

window.addEventListener("DOMContentLoaded", () => {
    App.init();
});
