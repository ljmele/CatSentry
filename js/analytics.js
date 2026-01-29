// analytics.js - v1.4 with State Machine logic for robust duration calculation

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

    // 1. Process base data using State Machine (Daily resolution)
    const { dailyCounts, dailyDurations, hourlyActivity, stats, processedEvents } = processDataWithStateMachine(sorted);
    
    // Log stats for debugging
    console.log("Analytics Stats:", stats);
    
    // Cache for aggregator
    cachedDailyCounts = dailyCounts;
    cachedDailyDurations = dailyDurations;
    
    // Store processed events globally for the Recent Events display
    window.lastProcessedEvents = processedEvents;

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
 * STATE MACHINE APPROACH
 * 
 * Rules:
 * - Cat starts INSIDE (conservative assumption)
 * - EXIT when inside → cat goes outside, start timing
 * - EXIT when already outside → IGNORED (duplicate/noise)
 * - ENTRY when outside → cat comes inside, record duration
 * - ENTRY when already inside → IGNORED (duplicate/noise)
 * 
 * This ensures we only count time when we have valid EXIT→ENTRY pairs.
 */
function processDataWithStateMachine(events) {
    const dailyCounts = {};      // Counts VALID outings (EXIT→ENTRY pairs)
    const dailyDurations = {};   // Duration in minutes
    const hourlyActivity = new Array(24).fill(0); // All events for activity pattern
    
    // Processed events with their effective status
    const processedEvents = [];
    
    // Statistics for debugging
    const stats = {
        totalEvents: events.length,
        effectiveExits: 0,
        effectiveEntries: 0,
        ignoredExits: 0,
        ignoredEntries: 0,
        completedOutings: 0,
        invalidDurations: 0,
        totalTimeOutsideMinutes: 0
    };

    // STATE MACHINE
    let catIsOutside = false;
    let currentOuting = null; // { exitTimestamp, exitDateKey }

    for (const event of events) {
        const date = new Date(event.timestamp);
        const dateKey = date.toLocaleDateString();
        const hour = date.getHours();

        // Always count for hourly activity pattern (raw data)
        hourlyActivity[hour]++;
        
        // Process event record
        const processedEvent = {
            timestamp: event.timestamp,
            type: event.type,
            effective: false,
            reason: ''
        };

        if (event.type === 2) { // EXIT
            if (!catIsOutside) {
                // Valid exit: cat was inside, now going outside
                catIsOutside = true;
                currentOuting = {
                    exitTimestamp: event.timestamp,
                    exitDateKey: dateKey
                };
                
                processedEvent.effective = true;
                processedEvent.reason = 'Cat went outside';
                stats.effectiveExits++;
                
            } else {
                // Ignored: cat already outside (duplicate exit or missed entry)
                processedEvent.effective = false;
                processedEvent.reason = 'Ignored: cat already outside';
                stats.ignoredExits++;
            }
            
        } else if (event.type === 1) { // ENTRY
            if (catIsOutside && currentOuting) {
                // Valid entry: cat was outside, now coming inside
                catIsOutside = false;
                
                const durationMs = event.timestamp - currentOuting.exitTimestamp;
                
                // Validate duration
                if (durationMs >= MIN_OUTING_DURATION_MS && durationMs <= MAX_OUTING_DURATION_MS) {
                    const minutes = durationMs / 1000 / 60;
                    
                    // Count this as a completed outing on the EXIT date
                    dailyCounts[currentOuting.exitDateKey] = (dailyCounts[currentOuting.exitDateKey] || 0) + 1;
                    dailyDurations[currentOuting.exitDateKey] = (dailyDurations[currentOuting.exitDateKey] || 0) + minutes;
                    
                    stats.completedOutings++;
                    stats.totalTimeOutsideMinutes += minutes;
                    
                    processedEvent.effective = true;
                    processedEvent.reason = `Completed outing: ${Math.round(minutes)} min`;
                    
                } else if (durationMs < MIN_OUTING_DURATION_MS) {
                    // Too short - likely noise
                    processedEvent.effective = true; // Still effective (state changed)
                    processedEvent.reason = `Quick return (${Math.round(durationMs/1000)}s) - not counted`;
                    stats.invalidDurations++;
                    
                } else {
                    // Too long - likely missed events
                    processedEvent.effective = true; // Still effective (state changed)
                    processedEvent.reason = `Duration too long (${Math.round(durationMs/1000/60/60)}h) - not counted`;
                    stats.invalidDurations++;
                }
                
                currentOuting = null;
                stats.effectiveEntries++;
                
            } else {
                // Ignored: cat already inside (duplicate entry or missed exit)
                processedEvent.effective = false;
                processedEvent.reason = 'Ignored: cat already inside';
                stats.ignoredEntries++;
            }
        }
        
        processedEvents.push(processedEvent);
    }
    
    // If cat is currently outside, note it
    if (catIsOutside) {
        console.log("Cat appears to be currently outside (outing in progress)");
    }

    // Ensure all dates in counts also exist in durations (with 0 if no data)
    Object.keys(dailyCounts).forEach(dateKey => {
        if (!(dateKey in dailyDurations)) {
            dailyDurations[dateKey] = 0;
        }
    });

    return { dailyCounts, dailyDurations, hourlyActivity, stats, processedEvents };
}

/**
 * Get current cat status based on state machine logic
 */
function getCatStatus(events) {
    if (!events || events.length === 0) return { status: 'unknown', icon: '❓' };
    
    const validEvents = events.filter(e => e.timestamp >= MIN_VALID_TIMESTAMP);
    const sorted = [...validEvents].sort((a, b) => a.timestamp - b.timestamp);
    
    // Run state machine to determine current state
    let catIsOutside = false;
    
    for (const event of sorted) {
        if (event.type === 2 && !catIsOutside) { // EXIT
            catIsOutside = true;
        } else if (event.type === 1 && catIsOutside) { // ENTRY
            catIsOutside = false;
        }
    }
    
    return catIsOutside 
        ? { status: 'outside', icon: '🌳', text: 'Outside' }
        : { status: 'inside', icon: '🏠', text: 'Inside' };
}

// --- Chart Instances ---
let visitsChartInstance = null;
let durationChartInstance = null;
let hourlyChartInstance = null;

function renderVisitsChart(dataObj, period) {
    const canvas = document.getElementById('visitsChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj);
    
    const labelText = period === 'day' ? 'Outings per Day' : `Outings per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

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
                title: { display: true, text: 'Completed Outings (EXIT→ENTRY pairs)', color: '#fff' } 
            }
        }
    });
}

function renderDurationChart(dataObj, period) {
    const canvas = document.getElementById('durationChart');
    if (!canvas) return;
    
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
                title: { display: true, text: 'Time Spent Outside (validated)', color: '#fff' } 
            }
        }
    });
}

function renderHourlyChart(dataArray) {
    const canvas = document.getElementById('hourlyChart');
    if (!canvas) return;
    
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
                title: { display: true, text: 'Activity by Hour (all events)', color: '#fff' },
                legend: { display: false }
            }
        }
    });
}
