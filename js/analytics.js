// analytics.js

let currentPeriod = 'day'; // 'day', 'week', 'month'
let cachedDailyCounts = {};
let cachedDailyDurations = {};

/**
 * Updates all detailed analytics charts based on the event history.
 * @param {Array} history - Array of {timestamp, type} objects.
 */
function updateAnalytics(history) {
    if (!history || history.length === 0) return;

    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

    // 1. Process base data (Daily resolution)
    const { dailyCounts, dailyDurations, hourlyActivity } = processData(sorted);
    
    // Cache for aggregator
    cachedDailyCounts = dailyCounts;
    cachedDailyDurations = dailyDurations;

    // 2. Render Activity Radar (always same)
    renderHourlyChart(hourlyActivity);

    // 3. Render Aggregated Charts
    refreshTimeCharts();
}

/**
 * Switch period and refresh charts
 */
function setChartPeriod(period) {
    currentPeriod = period;
    
    // Update active button state
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
        // dateStr is local date string. Ideally we parse it back to a Date object.
        const date = new Date(dateStr);
        let key = '';

        if (period === 'week') {
            // Get week number
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
 * Process raw events into chart-friendly datasets
 */
function processData(events) {
    const dailyCounts = {};     
    const dailyDurations = {};  
    const hourlyActivity = new Array(24).fill(0);

    let lastExitTime = null;

    events.forEach(event => {
        const date = new Date(event.timestamp);
        const dateKey = date.toLocaleDateString(); 
        const hour = date.getHours();

        // 1. Hourly Activity
        hourlyActivity[hour]++;

        // 2. Daily Counts (Exits)
        if (event.type === 2) { // EXIT
            dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
            lastExitTime = event.timestamp;
            if (!dailyDurations[dateKey]) dailyDurations[dateKey] = 0;
        } else if (event.type === 1) { // ENTRY
            // 3. Time Spent Outside
            if (lastExitTime !== null) {
                const durationMs = event.timestamp - lastExitTime;
                if (durationMs > 0 && durationMs < 24 * 60 * 60 * 1000) {
                    const minutes = durationMs / 1000 / 60;
                    const exitDate = new Date(lastExitTime).toLocaleDateString();
                    dailyDurations[exitDate] = (dailyDurations[exitDate] || 0) + minutes;
                }
                lastExitTime = null; 
            }
        }
    });

    return { dailyCounts, dailyDurations, hourlyActivity };
}

// --- Chart Instances ---
let visitsChartInstance = null;
let durationChartInstance = null;
let hourlyChartInstance = null;

function renderVisitsChart(dataObj, period) {
    const ctx = document.getElementById('visitsChart').getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj);
    
    const labelText = period === 'day' ? 'Exits per Day' : `Exits per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (visitsChartInstance) visitsChartInstance.destroy();

    visitsChartInstance = new Chart(ctx, {
        type: 'bar', // Bar is good for frequency
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
    const ctx = document.getElementById('durationChart').getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj).map(m => Math.round(m)); 

    const labelText = period === 'day' ? 'Minutes per Day' : `Minutes per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (durationChartInstance) durationChartInstance.destroy();

    // Pie chart might be cool for monthly, but Line is best for trends over time
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
    const ctx = document.getElementById('hourlyChart').getContext('2d');
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
