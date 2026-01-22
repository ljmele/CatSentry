// analytics.js - v1.3 with robust duration calculation

let currentPeriod = 'day';
let cachedDailyCounts = {};
let cachedDailyDurations = {};

// Minimum valid timestamp (Jan 1, 2020 in ms)
const MIN_VALID_TIMESTAMP = 1577836800000;

// Maximum reasonable outing duration (24 hours in ms)
const MAX_OUTING_DURATION_MS = 24 * 60 * 60 * 1000;

// Minimum outing duration to consider valid (30 seconds)
const MIN_OUTING_DURATION_MS = 30 * 1000;

/**
 * Updates all detailed analytics charts based on the event history.
 * @param {Array} history - Array of {timestamp, type} objects.
 */
function updateAnalytics(history) {
    if (!history || history.length === 0) return;

    // Filter out invalid timestamps (1970 bug)
    const validHistory = history.filter(e => e.timestamp >= MIN_VALID_TIMESTAMP);
    
    if (validHistory.length === 0) {
        console.warn("No valid events found (all filtered due to invalid timestamps)");
        return;
    }

    const sorted = [...validHistory].sort((a, b) => a.timestamp - b.timestamp);

    // 1. Process base data (Daily resolution)
    const { dailyCounts, dailyDurations, hourlyActivity, stats } = processData(sorted);
    
    // Log stats for debugging
    console.log("Analytics Stats:", stats);
    
    // Cache for aggregator
    cachedDailyCounts = dailyCounts;
    cachedDailyDurations = dailyDurations;

    // 2. Render Activity Radar
    renderHourlyChart(hourlyActivity);

    // 3. Render Aggregated Charts
    refreshTimeCharts();
}

/**
 * Switch period and refresh charts
 */
function setChartPeriod(period) {
    currentPeriod = period;
    
    document.querySelectorAll('.period-btn').forEach(btn => {
        if(btn.id === `btn-${period}`) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    refreshTimeCharts();
}

function refreshTimeCharts() {
    const aggCounts = aggregateData(cachedDailyCounts, currentPeriod);
    const aggDuration = aggregateData(cachedDailyDurations, currentPeriod);

    renderVisitsChart(aggCounts, currentPeriod);
    renderDurationChart(aggDuration, currentPeriod);
}

/**
 * Aggregates daily data into weeks or months
 */
function aggregateData(dailyData, period) {
    if (period === 'day') return dailyData;

    const aggregated = {};
    
    Object.keys(dailyData).forEach(dateStr => {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return; // Skip invalid dates
        
        let key = '';

        if (period === 'week') {
            const startOfYear = new Date(date.getFullYear(), 0, 1);
            const pastDays = (date - startOfYear) / 86400000;
            const weekNum = Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
            key = `W${weekNum} ${date.getFullYear()}`;
        } else if (period === 'month') {
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            key = `${months[date.getMonth()]} ${date.getFullYear()}`;
        }

        aggregated[key] = (aggregated[key] || 0) + dailyData[dateStr];
    });

    return aggregated;
}

/**
 * Process raw events into chart-friendly datasets.
 * Uses smart pairing algorithm to handle missing events.
 */
function processData(events) {
    const dailyCounts = {};     
    const dailyDurations = {};  
    const hourlyActivity = new Array(24).fill(0);
    
    // Statistics for debugging
    const stats = {
        totalEvents: events.length,
        entries: 0,
        exits: 0,
        pairedOutings: 0,
        unpairedExits: 0,
        unpairedEntries: 0,
        invalidDurations: 0
    };

    // --- SMART PAIRING ALGORITHM ---
    // Build a list of "outings" by pairing exits with their following entries
    const outings = [];
    let pendingExit = null;

    for (const event of events) {
        const date = new Date(event.timestamp);
        const dateKey = date.toLocaleDateString();
        const hour = date.getHours();

        // Count hourly activity (all events)
        hourlyActivity[hour]++;

        if (event.type === 2) { // EXIT
            stats.exits++;
            
            // If we already have a pending exit (cat exited twice without entering)
            // This means we missed an entry. Close the previous outing with unknown duration.
            if (pendingExit !== null) {
                stats.unpairedExits++;
                // We could add a synthetic entry here, but it's better to just discard
                // the previous incomplete outing for duration purposes
            }
            
            pendingExit = {
                exitTimestamp: event.timestamp,
                exitDate: dateKey
            };
            
            // Count exits per day (this is our "outing frequency")
            dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
            
        } else if (event.type === 1) { // ENTRY
            stats.entries++;
            
            if (pendingExit !== null) {
                // We have a complete outing!
                const durationMs = event.timestamp - pendingExit.exitTimestamp;
                
                // Validate duration
                if (durationMs >= MIN_OUTING_DURATION_MS && durationMs <= MAX_OUTING_DURATION_MS) {
                    const minutes = durationMs / 1000 / 60;
                    
                    // Attribute duration to the EXIT date (when the outing started)
                    const exitDateKey = pendingExit.exitDate;
                    dailyDurations[exitDateKey] = (dailyDurations[exitDateKey] || 0) + minutes;
                    
                    outings.push({
                        exitTime: pendingExit.exitTimestamp,
                        entryTime: event.timestamp,
                        durationMinutes: minutes
                    });
                    
                    stats.pairedOutings++;
                } else {
                    // Duration out of range - either too short (noise) or too long (missed events)
                    stats.invalidDurations++;
                    console.log(`Invalid duration: ${Math.round(durationMs/1000/60)} minutes`);
                }
                
                pendingExit = null;
                
            } else {
                // Entry without a preceding exit - we missed the exit event
                stats.unpairedEntries++;
                // Nothing to do here - we can't calculate duration without knowing when cat left
            }
        }
    }
    
    // Handle case where cat is currently outside (exit but no entry yet)
    if (pendingExit !== null) {
        // Don't count this as unpaired - it's just "currently outside"
        console.log("Cat appears to be currently outside");
    }

    // Ensure all dates in counts also exist in durations (with 0 if no data)
    Object.keys(dailyCounts).forEach(dateKey => {
        if (!(dateKey in dailyDurations)) {
            dailyDurations[dateKey] = 0;
        }
    });

    return { dailyCounts, dailyDurations, hourlyActivity, stats };
}

// --- Chart Instances ---
let visitsChartInstance = null;
let durationChartInstance = null;
let hourlyChartInstance = null;

function renderVisitsChart(dataObj, period) {
    const canvas = document.getElementById('visitsChart');
    if (!canvas) return; // Guard against missing DOM element
    
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj);
    
    const labelText = period === 'day' ? 'Exits per Day' : `Exits per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (visitsChartInstance) visitsChartInstance.destroy();

    visitsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: labelText,
                data: data,
                backgroundColor: '#36a2eb',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: '#333' } },
                x: { grid: { color: '#333' } }
            },
            plugins: { 
                legend: { display: false },
                title: { display: true, text: 'Frequency of Outings', color: '#fff' } 
            }
        }
    });
}

function renderDurationChart(dataObj, period) {
    const canvas = document.getElementById('durationChart');
    if (!canvas) return; // Guard against missing DOM element
    
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj).map(m => Math.round(m)); 

    const labelText = period === 'day' ? 'Minutes per Day' : `Minutes per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (durationChartInstance) durationChartInstance.destroy();

    durationChartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: labels,
            datasets: [{
                label: labelText,
                data: data,
                borderColor: '#ff6384',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: '#333' } },
                x: { grid: { color: '#333' } }
            },
            plugins: { 
                legend: { display: false },
                title: { display: true, text: 'Time Spent Outside', color: '#fff' } 
            }
        }
    });
}

function renderHourlyChart(dataArray) {
    const canvas = document.getElementById('hourlyChart');
    if (!canvas) return; // Guard against missing DOM element
    
    const ctx = canvas.getContext('2d');
    const labels = Array.from({length: 24}, (_, i) => `${i}:00`);
    
    if (hourlyChartInstance) hourlyChartInstance.destroy();

    hourlyChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Activity',
                data: dataArray,
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 2,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { color: '#333' },
                    grid: { color: '#333' },
                    pointLabels: { color: '#888', font: { size: 10 } },
                    ticks: { backdropColor: 'transparent', display: false }
                }
            },
            plugins: { 
                title: { display: true, text: 'Preferred Hours (24h)', color: '#fff' },
                legend: { display: false }
            }
        }
    });
}
