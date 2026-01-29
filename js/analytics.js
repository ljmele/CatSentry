// analytics.js - v1.5 with State Machine logic + Weather Integration

let currentPeriod = 'day';
let cachedDailyCounts = {};
let cachedDailyDurations = {};
let cachedWeatherData = {}; // Cache weather data by date

// Minimum valid timestamp (Jan 1, 2020 in ms)
const MIN_VALID_TIMESTAMP = 1577836800000;

// Maximum reasonable outing duration (24 hours in ms)
const MAX_OUTING_DURATION_MS = 24 * 60 * 60 * 1000;

// Minimum outing duration to consider valid (30 seconds)
const MIN_OUTING_DURATION_MS = 30 * 1000;

// Weather configuration - set your location coordinates
// Default: London. Change to your location for accurate weather.
let WEATHER_CONFIG = {
    latitude: 51.5074,  // Change to your latitude
    longitude: -0.1278, // Change to your longitude
    enabled: true
};

// Load saved weather config
(function loadWeatherConfig() {
    const saved = localStorage.getItem('catSentryWeatherConfig');
    if (saved) {
        try {
            WEATHER_CONFIG = { ...WEATHER_CONFIG, ...JSON.parse(saved) };
        } catch (e) {}
    }
})();

function saveWeatherConfig() {
    localStorage.setItem('catSentryWeatherConfig', JSON.stringify(WEATHER_CONFIG));
}

// Weather code to emoji mapping (WMO codes)
const WEATHER_ICONS = {
    0: '☀️',   // Clear sky
    1: '🌤️',   // Mainly clear
    2: '⛅',   // Partly cloudy
    3: '☁️',   // Overcast
    45: '🌫️',  // Fog
    48: '🌫️',  // Depositing rime fog
    51: '🌧️',  // Light drizzle
    53: '🌧️',  // Moderate drizzle
    55: '🌧️',  // Dense drizzle
    61: '🌧️',  // Slight rain
    63: '🌧️',  // Moderate rain
    65: '🌧️',  // Heavy rain
    71: '🌨️',  // Slight snow
    73: '🌨️',  // Moderate snow
    75: '🌨️',  // Heavy snow
    77: '🌨️',  // Snow grains
    80: '🌦️',  // Slight rain showers
    81: '🌦️',  // Moderate rain showers
    82: '⛈️',  // Violent rain showers
    85: '🌨️',  // Slight snow showers
    86: '🌨️',  // Heavy snow showers
    95: '⛈️',  // Thunderstorm
    96: '⛈️',  // Thunderstorm with hail
    99: '⛈️'   // Thunderstorm with heavy hail
};

function getWeatherIcon(code) {
    return WEATHER_ICONS[code] || '❓';
}

/**
 * Fetch historical weather data from Open-Meteo (free, no API key)
 * @param {string[]} dates - Array of date strings in YYYY-MM-DD format
 */
async function fetchWeatherData(dates) {
    if (!WEATHER_CONFIG.enabled || dates.length === 0) return {};
    
    // Filter dates we don't have cached
    const uncachedDates = dates.filter(d => !cachedWeatherData[d]);
    
    if (uncachedDates.length === 0) {
        return cachedWeatherData;
    }
    
    // Sort dates to find range
    const sortedDates = [...uncachedDates].sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];
    
    // Don't fetch future dates
    const today = new Date().toISOString().split('T')[0];
    const adjustedEndDate = endDate > today ? today : endDate;
    
    if (startDate > today) return cachedWeatherData;
    
    try {
        const url = `https://archive-api.open-meteo.com/v1/archive?` +
            `latitude=${WEATHER_CONFIG.latitude}&longitude=${WEATHER_CONFIG.longitude}` +
            `&start_date=${startDate}&end_date=${adjustedEndDate}` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
            `&timezone=auto`;
        
        console.log('Fetching weather data:', url);
        const response = await fetch(url);
        
        if (!response.ok) {
            console.warn('Weather API error:', response.status);
            return cachedWeatherData;
        }
        
        const data = await response.json();
        
        if (data.daily && data.daily.time) {
            data.daily.time.forEach((date, idx) => {
                cachedWeatherData[date] = {
                    code: data.daily.weather_code[idx],
                    icon: getWeatherIcon(data.daily.weather_code[idx]),
                    tempMax: Math.round(data.daily.temperature_2m_max[idx]),
                    tempMin: Math.round(data.daily.temperature_2m_min[idx])
                };
            });
        }
        
        console.log('Weather data cached:', Object.keys(cachedWeatherData).length, 'days');
        
    } catch (error) {
        console.warn('Failed to fetch weather data:', error);
    }
    
    return cachedWeatherData;
}

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

    // These are now async but we don't need to await them
    renderVisitsChart(aggCounts, currentPeriod);
    renderDurationChart(aggDuration, currentPeriod);
}

/**
 * Configure weather location
 */
function configureWeather() {
    const lat = prompt('Enter your latitude (e.g., 51.5074 for London):', WEATHER_CONFIG.latitude);
    if (lat === null) return;
    
    const lon = prompt('Enter your longitude (e.g., -0.1278 for London):', WEATHER_CONFIG.longitude);
    if (lon === null) return;
    
    const enabled = confirm('Enable weather display on charts?');
    
    WEATHER_CONFIG.latitude = parseFloat(lat) || 51.5074;
    WEATHER_CONFIG.longitude = parseFloat(lon) || -0.1278;
    WEATHER_CONFIG.enabled = enabled;
    
    saveWeatherConfig();
    
    // Clear cache and refresh
    cachedWeatherData = {};
    refreshTimeCharts();
    
    console.log('Weather config saved:', WEATHER_CONFIG);
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
 * STATE MACHINE APPROACH (v2 - "Keep Last" Logic)
 * 
 * Rules:
 * - Cat starts INSIDE (conservative assumption)
 * - EXIT when inside → cat goes outside, start timing
 * - EXIT when already outside → UPDATE exit timestamp (cat was lingering, this might be the real exit)
 * - ENTRY when outside → cat comes inside, record duration using LAST exit timestamp
 * - ENTRY when already inside → UPDATE entry timestamp (same logic)
 * 
 * The "keep last" approach handles the lingering scenario:
 * - 10:23 EXIT (lingering starts)
 * - 10:24 EXIT (still lingering) → updates exit time
 * - 10:24 EXIT (still lingering) → updates exit time  
 * - [gap - cat came back undetected]
 * - 10:27 EXIT (real exit) → updates exit time to 10:27 ✓
 * - 10:45 ENTRY → duration calculated from 10:27, not 10:23
 * 
 * The key insight: consecutive same-type events within a session mean lingering.
 * The LAST one before a state change is the "real" event.
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
        updatedExits: 0,
        updatedEntries: 0,
        completedOutings: 0,
        invalidDurations: 0,
        totalTimeOutsideMinutes: 0
    };

    // STATE MACHINE
    let catIsOutside = false;
    let currentOuting = null; // { exitTimestamp, exitDateKey, exitEventIndex }
    let lastEntryTimestamp = null;
    let lastEntryIndex = null;

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
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
                // First exit: cat was inside, now going outside
                catIsOutside = true;
                currentOuting = {
                    exitTimestamp: event.timestamp,
                    exitDateKey: dateKey,
                    exitEventIndex: i
                };
                
                processedEvent.effective = true;
                processedEvent.reason = 'Cat went outside';
                stats.effectiveExits++;
                
            } else {
                // Cat already "outside" - UPDATE the exit timestamp (lingering scenario)
                // Mark the previous exit as superseded
                if (currentOuting && currentOuting.exitEventIndex !== null) {
                    const prevIdx = currentOuting.exitEventIndex;
                    if (processedEvents[prevIdx]) {
                        processedEvents[prevIdx].effective = false;
                        processedEvents[prevIdx].reason = 'Superseded: later exit detected';
                        stats.effectiveExits--;
                        stats.updatedExits++;
                    }
                }
                
                // Update to this new exit
                currentOuting = {
                    exitTimestamp: event.timestamp,
                    exitDateKey: dateKey,
                    exitEventIndex: i
                };
                
                processedEvent.effective = true;
                processedEvent.reason = 'Cat went outside (updated)';
                stats.effectiveExits++;
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
                    // Too short - likely noise (but still counts as state change)
                    processedEvent.effective = true;
                    processedEvent.reason = `Quick return (${Math.round(durationMs/1000)}s) - not counted`;
                    stats.invalidDurations++;
                    
                } else {
                    // Too long - likely missed events
                    processedEvent.effective = true;
                    processedEvent.reason = `Duration too long (${Math.round(durationMs/1000/60/60)}h) - not counted`;
                    stats.invalidDurations++;
                }
                
                lastEntryTimestamp = event.timestamp;
                lastEntryIndex = i;
                currentOuting = null;
                stats.effectiveEntries++;
                
            } else {
                // Cat already "inside" - UPDATE the entry timestamp
                if (lastEntryIndex !== null && processedEvents[lastEntryIndex]) {
                    processedEvents[lastEntryIndex].effective = false;
                    processedEvents[lastEntryIndex].reason = 'Superseded: later entry detected';
                    stats.effectiveEntries--;
                    stats.updatedEntries++;
                }
                
                lastEntryTimestamp = event.timestamp;
                lastEntryIndex = i;
                
                processedEvent.effective = true;
                processedEvent.reason = 'Cat came inside (updated)';
                stats.effectiveEntries++;
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
 * Get current cat status based on state machine logic (keep-last approach)
 */
function getCatStatus(events) {
    if (!events || events.length === 0) return { status: 'unknown', icon: '❓' };
    
    const validEvents = events.filter(e => e.timestamp >= MIN_VALID_TIMESTAMP);
    const sorted = [...validEvents].sort((a, b) => a.timestamp - b.timestamp);
    
    // Run state machine with "keep last" logic
    let catIsOutside = false;
    let lastEffectiveExitTime = null;
    let lastEffectiveEntryTime = null;
    
    for (const event of sorted) {
        if (event.type === 2) { // EXIT
            // Always update - keep the last exit
            catIsOutside = true;
            lastEffectiveExitTime = event.timestamp;
        } else if (event.type === 1) { // ENTRY
            // Always update - keep the last entry
            catIsOutside = false;
            lastEffectiveEntryTime = event.timestamp;
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

/**
 * Convert locale date string to YYYY-MM-DD for weather API
 */
function localeDateToISO(localeDateStr) {
    // Handle various locale formats
    const date = new Date(localeDateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
}

/**
 * Render visits chart with weather overlay
 */
async function renderVisitsChart(dataObj, period) {
    const canvas = document.getElementById('visitsChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj);
    
    const labelText = period === 'day' ? 'Outings per Day' : `Outings per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (visitsChartInstance) visitsChartInstance.destroy();

    // Fetch weather data for daily view
    let weatherLabels = labels;
    if (period === 'day' && WEATHER_CONFIG.enabled) {
        const isoDates = labels.map(localeDateToISO).filter(d => d);
        await fetchWeatherData(isoDates);
        
        // Add weather icons to labels
        weatherLabels = labels.map(label => {
            const isoDate = localeDateToISO(label);
            const weather = cachedWeatherData[isoDate];
            if (weather) {
                return `${weather.icon} ${label}`;
            }
            return label;
        });
    }

    visitsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: weatherLabels,
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
                x: { 
                    grid: { color: '#333' },
                    ticks: { 
                        maxRotation: 45, 
                        minRotation: 0,
                        font: { size: 11 }
                    }
                }
            },
            plugins: { 
                legend: { display: false },
                title: { display: true, text: 'Completed Outings (EXIT→ENTRY pairs)', color: '#fff' },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            if (period !== 'day') return '';
                            const label = labels[context.dataIndex];
                            const isoDate = localeDateToISO(label);
                            const weather = cachedWeatherData[isoDate];
                            if (weather) {
                                return `Weather: ${weather.icon} ${weather.tempMin}°C - ${weather.tempMax}°C`;
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render duration chart with weather overlay
 */
async function renderDurationChart(dataObj, period) {
    const canvas = document.getElementById('durationChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj).map(m => Math.round(m)); 

    const labelText = period === 'day' ? 'Minutes per Day' : `Minutes per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (durationChartInstance) durationChartInstance.destroy();

    // Fetch weather data for daily view
    let weatherLabels = labels;
    if (period === 'day' && WEATHER_CONFIG.enabled) {
        const isoDates = labels.map(localeDateToISO).filter(d => d);
        await fetchWeatherData(isoDates);
        
        // Add weather icons to labels
        weatherLabels = labels.map(label => {
            const isoDate = localeDateToISO(label);
            const weather = cachedWeatherData[isoDate];
            if (weather) {
                return `${weather.icon} ${label}`;
            }
            return label;
        });
    }

    durationChartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: weatherLabels,
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
                x: { 
                    grid: { color: '#333' },
                    ticks: { 
                        maxRotation: 45, 
                        minRotation: 0,
                        font: { size: 11 }
                    }
                }
            },
            plugins: { 
                legend: { display: false },
                title: { display: true, text: 'Time Spent Outside (validated)', color: '#fff' },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            if (period !== 'day') return '';
                            const label = labels[context.dataIndex];
                            const isoDate = localeDateToISO(label);
                            const weather = cachedWeatherData[isoDate];
                            if (weather) {
                                return `Weather: ${weather.icon} ${weather.tempMin}°C - ${weather.tempMax}°C`;
                            }
                            return '';
                        }
                    }
                }
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
