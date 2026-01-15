// analytics.js

/**
 * Updates all detailed analytics charts based on the event history.
 * @param {Array} history - Array of {timestamp, type} objects.
 */
function updateAnalytics(history) {
    if (!history || history.length === 0) return;

    // Sort valid history
    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

    // Process Data
    const { dailyCounts, dailyDurations, hourlyActivity } = processData(sorted);

    // Update Plots
    renderVisitsChart(dailyCounts);
    renderDurationChart(dailyDurations);
    renderHourlyChart(hourlyActivity);
}

/**
 * Process raw events into chart-friendly datasets
 */
function processData(events) {
    const dailyCounts = {};     // 'YYYY-MM-DD': count
    const dailyDurations = {};  // 'YYYY-MM-DD': minutes
    const hourlyActivity = new Array(24).fill(0);

    let lastExitTime = null;

    events.forEach(event => {
        const date = new Date(event.timestamp);
        const dateKey = date.toLocaleDateString(); // Local date string key
        const hour = date.getHours();

        // 1. Hourly Activity (Count both Entry and Exit to see "busyness")
        hourlyActivity[hour]++;

        // 2. Daily Counts (Only count Exits)
        if (event.type === 2) { // EXIT
            dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
            lastExitTime = event.timestamp;
            
            // Initialize duration for this day (if not existing) to 0 so the bar shows up
            if (!dailyDurations[dateKey]) dailyDurations[dateKey] = 0;
        } else if (event.type === 1) { // ENTRY
            // 3. Time Spent Outside
            if (lastExitTime !== null) {
                // We have a pending exit
                const durationMs = event.timestamp - lastExitTime;
                
                // Sanity check: Ignore trips > 24 hours or < 0 (glitches)
                if (durationMs > 0 && durationMs < 24 * 60 * 60 * 1000) {
                    const minutes = durationMs / 1000 / 60;
                    
                    // Attribute duration to the day of EXIT (usually same day)
                    const exitDate = new Date(lastExitTime).toLocaleDateString();
                    dailyDurations[exitDate] = (dailyDurations[exitDate] || 0) + minutes;
                }
                lastExitTime = null; // Pair complete
            }
        }
    });

    return { dailyCounts, dailyDurations, hourlyActivity };
}

// --- Chart Instances (kept global to update/destroy) ---
let visitsChartInstance = null;
let durationChartInstance = null;
let hourlyChartInstance = null;

function renderVisitsChart(dataObj) {
    const ctx = document.getElementById('visitsChart').getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj);

    if (visitsChartInstance) visitsChartInstance.destroy();

    visitsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Exits per Day',
                data: data,
                backgroundColor: '#36a2eb',
                borderColor: '#36a2eb',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, grid: { color: '#333' }, ticks: { stepSize: 1 } },
                x: { grid: { color: '#333' } }
            },
            plugins: { title: { display: true, text: 'Frequency of Outings', color: '#fff' } }
        }
    });
}

function renderDurationChart(dataObj) {
    const ctx = document.getElementById('durationChart').getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj).map(m => Math.round(m)); // Round to nearest minute

    if (durationChartInstance) durationChartInstance.destroy();

    durationChartInstance = new Chart(ctx, {
        type: 'line', // Line chart to see trend easier
        data: {
            labels: labels,
            datasets: [{
                label: 'Time Outside (Minutes)',
                data: data,
                borderColor: '#ff6384',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, grid: { color: '#333' } },
                x: { grid: { color: '#333' } }
            },
            plugins: { title: { display: true, text: 'Time Spent Outside', color: '#fff' } }
        }
    });
}

function renderHourlyChart(dataArray) {
    const ctx = document.getElementById('hourlyChart').getContext('2d');
    const labels = Array.from({length: 24}, (_, i) => `${i}:00`);
    
    if (hourlyChartInstance) hourlyChartInstance.destroy();

    hourlyChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Activity Intensity',
                data: dataArray,
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 2,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            scales: {
                r: {
                    angleLines: { color: '#333' },
                    grid: { color: '#333' },
                    pointLabels: { color: '#888' },
                    ticks: { backdropColor: 'transparent' }
                }
            },
            plugins: { 
                title: { display: true, text: 'Preferred "Cat Hours" (24h Clock)', color: '#fff' },
                legend: { display: false }
            }
        }
    });
}
