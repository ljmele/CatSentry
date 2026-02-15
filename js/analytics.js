// analytics.js - v1.7 with State Machine logic + Weather Integration + Insights (Udine, Italy)

let currentPeriod = 'day';
let cachedDailyCounts = {};
let cachedDailyDurations = {};
let cachedWeatherData = {}; // Cache weather data by date

// Minimum valid timestamp (Jan 1, 2020 in ms)
const MIN_VALID_TIMESTAMP = 1577836800000;

// Maximum reasonable outing duration (5 hours in ms)
const MAX_OUTING_DURATION_MS = 5 * 60 * 60 * 1000;

// Minimum outing duration to consider valid (30 seconds)
const MIN_OUTING_DURATION_MS = 30 * 1000;

// Weather configuration - Fixed location: Udine, Italy
const WEATHER_CONFIG = {
    latitude: 46.0711,   // Udine, Italy
    longitude: 13.2346,  // Udine, Italy
    enabled: true
};

// Weather code to emoji mapping (WMO codes from Open-Meteo)
// These are standard World Meteorological Organization codes
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
    56: '🌧️',  // Freezing drizzle light
    57: '🌧️',  // Freezing drizzle dense
    61: '🌧️',  // Slight rain
    63: '🌧️',  // Moderate rain
    65: '🌧️',  // Heavy rain
    66: '🌧️',  // Freezing rain light
    67: '🌧️',  // Freezing rain heavy
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

// Weather severity ranking (for aggregation - used for averaging)
const WEATHER_SEVERITY = {
    0: 0,   // Clear - best
    1: 1,   // Mainly clear
    2: 2,   // Partly cloudy
    3: 3,   // Overcast
    45: 4,  // Fog
    48: 4,  // Fog
    51: 5,  // Drizzle
    53: 5, 55: 5, 56: 5, 57: 5,
    61: 6,  // Rain
    63: 7, 65: 8, 66: 7, 67: 8,
    71: 6,  // Snow
    73: 7, 75: 8, 77: 6,
    80: 6,  // Showers
    81: 7, 82: 9,
    85: 7, 86: 8,
    95: 9,  // Thunderstorm
    96: 10, 99: 10
};

// Reverse mapping: severity score → representative weather code
const SEVERITY_TO_CODE = {
    0: 0,   // Clear
    1: 1,   // Mainly clear
    2: 2,   // Partly cloudy
    3: 3,   // Overcast
    4: 45,  // Fog
    5: 51,  // Drizzle
    6: 61,  // Light rain
    7: 63,  // Moderate rain
    8: 65,  // Heavy rain
    9: 95,  // Thunderstorm
    10: 96  // Severe thunderstorm
};

function getWeatherIcon(code) {
    return WEATHER_ICONS[code] || '❓';
}

/**
 * Get AVERAGE weather for a set of weather codes
 * Uses average severity score, rounded to nearest weather type
 * This is fair: 5 sunny + 2 rainy = mostly sunny, not rainy
 */
function getAverageWeather(weatherCodes) {
    if (!weatherCodes || weatherCodes.length === 0) return null;
    
    // Calculate average severity
    let totalSeverity = 0;
    for (const code of weatherCodes) {
        totalSeverity += WEATHER_SEVERITY[code] ?? 0;
    }
    
    const avgSeverity = Math.round(totalSeverity / weatherCodes.length);
    
    // Map back to a weather code
    return SEVERITY_TO_CODE[avgSeverity] ?? 0;
}

/**
 * Fetch historical weather data from Open-Meteo (free, no API key required)
 * 
 * Open-Meteo uses:
 * - ERA5 reanalysis data (ECMWF) for historical data (very accurate)
 * - ICON, GFS, and other models for recent/forecast data
 * 
 * Uses a hybrid fetching strategy:
 * - Recent dates (within 90 days): Forecast API (has real-time data, no lag)
 * - Historical dates (older than 90 days): Archive API (complete historical records)
 * 
 * @param {string[]} dates - Array of date strings in YYYY-MM-DD format
 */
async function fetchWeatherData(dates) {
    if (!WEATHER_CONFIG.enabled || dates.length === 0) return {};
    
    // Filter dates we don't have cached
    const uncachedDates = dates.filter(d => !cachedWeatherData[d]);
    
    if (uncachedDates.length === 0) {
        return cachedWeatherData;
    }
    
    // Don't fetch future dates
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const validDates = uncachedDates.filter(d => d <= todayStr);
    
    if (validDates.length === 0) return cachedWeatherData;
    
    // Calculate the threshold for "recent" dates (90 days ago)
    const recentThreshold = new Date();
    recentThreshold.setDate(recentThreshold.getDate() - 90);
    const recentThresholdStr = recentThreshold.toISOString().split('T')[0];
    
    // Split dates into recent and historical
    const recentDates = validDates.filter(d => d >= recentThresholdStr);
    const historicalDates = validDates.filter(d => d < recentThresholdStr);
    
    try {
        const fetchPromises = [];
        
        // Fetch recent dates using Forecast API (supports past_days parameter)
        if (recentDates.length > 0) {
            const sortedRecent = [...recentDates].sort();
            const startDate = sortedRecent[0];
            const endDate = sortedRecent[sortedRecent.length - 1];
            
            // Calculate how many days back from today
            const startDateObj = new Date(startDate);
            const daysDiff = Math.ceil((today - startDateObj) / (1000 * 60 * 60 * 24));
            
            const forecastUrl = `https://api.open-meteo.com/v1/forecast?` +
                `latitude=${WEATHER_CONFIG.latitude}&longitude=${WEATHER_CONFIG.longitude}` +
                `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
                `&timezone=Europe/Rome` +
                `&past_days=${Math.min(daysDiff, 92)}`; // Forecast API supports up to 92 past days
            
            console.log(`Fetching ${recentDates.length} recent dates using Forecast API`);
            fetchPromises.push(
                fetch(forecastUrl)
                    .then(response => {
                        if (!response.ok) throw new Error(`Forecast API error: ${response.status}`);
                        return response.json();
                    })
                    .then(data => ({ type: 'recent', data }))
            );
        }
        
        // Fetch historical dates using Archive API
        if (historicalDates.length > 0) {
            const sortedHistorical = [...historicalDates].sort();
            const startDate = sortedHistorical[0];
            const endDate = sortedHistorical[sortedHistorical.length - 1];
            
            const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?` +
                `latitude=${WEATHER_CONFIG.latitude}&longitude=${WEATHER_CONFIG.longitude}` +
                `&start_date=${startDate}&end_date=${endDate}` +
                `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
                `&timezone=Europe/Rome`;
            
            console.log(`Fetching ${historicalDates.length} historical dates using Archive API`);
            fetchPromises.push(
                fetch(archiveUrl)
                    .then(response => {
                        if (!response.ok) throw new Error(`Archive API error: ${response.status}`);
                        return response.json();
                    })
                    .then(data => ({ type: 'historical', data }))
            );
        }
        
        // Wait for all fetch requests to complete
        const results = await Promise.all(fetchPromises);
        
        // Process and merge results from both APIs
        for (const result of results) {
            const { data } = result;
            
            if (data.daily && data.daily.time) {
                data.daily.time.forEach((date, idx) => {
                    // Cache all dates returned by the API (including today and dates in between)
                    cachedWeatherData[date] = {
                        code: data.daily.weather_code[idx],
                        icon: getWeatherIcon(data.daily.weather_code[idx]),
                        tempMax: Math.round(data.daily.temperature_2m_max[idx]),
                        tempMin: Math.round(data.daily.temperature_2m_min[idx]),
                        precipitation: data.daily.precipitation_sum[idx] || 0
                    };
                });
            }
        }
        
        console.log(`Weather data cached: ${Object.keys(cachedWeatherData).length} days total ` +
                   `(${recentDates.length} recent, ${historicalDates.length} historical)`);
        
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
    const { dailyCounts, dailyDurations, hourlyActivity, hourlyDuration, stats, processedEvents } = processDataWithStateMachine(sorted);
    
    // Log stats for debugging
    console.log("Analytics Stats:", stats);
    
    // Cache for aggregator
    cachedDailyCounts = dailyCounts;
    cachedDailyDurations = dailyDurations;
    
    // Store processed events globally for the Recent Events display
    window.lastProcessedEvents = processedEvents;

    // 2. Render Preferred Hours (time-based) + Weather Correlation + Insights
    renderHourlyChart(hourlyDuration);
    renderWeatherCorrelationChart(cachedDailyDurations);
    renderInsightsPanel(dailyCounts, dailyDurations, hourlyDuration, stats);

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
 * Aggregates daily data into weeks or months
 * Also tracks which dates belong to each aggregated period (for weather)
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
 * Aggregates daily dates into weeks or months for weather lookup
 */
function aggregateDatesForWeather(dailyData, period) {
    if (period === 'day') {
        // Return map of label -> [single ISO date]
        const result = {};
        Object.keys(dailyData).forEach(dateStr => {
            const isoDate = localeDateToISO(dateStr);
            if (isoDate) result[dateStr] = [isoDate];
        });
        return result;
    }

    const aggregated = {};
    
    Object.keys(dailyData).forEach(dateStr => {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return;
        
        const isoDate = localeDateToISO(dateStr);
        if (!isoDate) return;
        
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

        if (!aggregated[key]) aggregated[key] = [];
        aggregated[key].push(isoDate);
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
    const hourlyDuration = new Array(24).fill(0);  // Minutes outside per hour (for Preferred Hours chart)
    
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
                    
                    // Distribute time across hours for the Preferred Hours chart
                    const exitDate = new Date(currentOuting.exitTimestamp);
                    const entryDate = new Date(event.timestamp);
                    let cursor = new Date(exitDate);
                    while (cursor < entryDate) {
                        const hour = cursor.getHours();
                        const nextHour = new Date(cursor);
                        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
                        const sliceEnd = entryDate < nextHour ? entryDate : nextHour;
                        const sliceMinutes = (sliceEnd - cursor) / 1000 / 60;
                        hourlyDuration[hour] += sliceMinutes;
                        cursor = nextHour;
                    }
                    
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

    return { dailyCounts, dailyDurations, hourlyActivity, hourlyDuration, stats, processedEvents };
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
let weatherCorrelationInstance = null;

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
 * Get aggregated weather info for a period (week/month)
 * Returns AVERAGE weather icon and average temps (fair representation)
 */
function getAggregatedWeather(isoDates) {
    if (!isoDates || isoDates.length === 0) return null;
    
    const weatherCodes = [];
    let tempMaxSum = 0, tempMinSum = 0, count = 0;
    
    for (const date of isoDates) {
        const weather = cachedWeatherData[date];
        if (weather) {
            weatherCodes.push(weather.code);
            tempMaxSum += weather.tempMax;
            tempMinSum += weather.tempMin;
            count++;
        }
    }
    
    if (count === 0) return null;
    
    const avgCode = getAverageWeather(weatherCodes);
    return {
        icon: getWeatherIcon(avgCode),
        tempMax: Math.round(tempMaxSum / count),
        tempMin: Math.round(tempMinSum / count),
        daysWithData: count
    };
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

    // Get date mapping for weather
    const dateMapping = aggregateDatesForWeather(cachedDailyCounts, period);
    
    // Collect all dates we need weather for
    const allDates = Object.values(dateMapping).flat();
    if (WEATHER_CONFIG.enabled && allDates.length > 0) {
        await fetchWeatherData(allDates);
    }
    
    // Build weather labels
    let weatherLabels = labels;
    const weatherInfo = {}; // Store for tooltips
    
    if (WEATHER_CONFIG.enabled) {
        weatherLabels = labels.map(label => {
            const dates = dateMapping[label];
            if (!dates) return label;
            
            if (period === 'day') {
                const weather = cachedWeatherData[dates[0]];
                if (weather) {
                    weatherInfo[label] = weather;
                    return `${weather.icon} ${label}`;
                }
            } else {
                // Week or month - aggregate weather
                const aggWeather = getAggregatedWeather(dates);
                if (aggWeather) {
                    weatherInfo[label] = aggWeather;
                    return `${aggWeather.icon} ${label}`;
                }
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
                            const label = labels[context.dataIndex];
                            const weather = weatherInfo[label];
                            if (weather) {
                                if (period === 'day') {
                                    return `Weather: ${weather.icon} ${weather.tempMin}°C - ${weather.tempMax}°C`;
                                } else {
                                    return `Avg weather: ${weather.icon} ${weather.tempMin}°C - ${weather.tempMax}°C (${weather.daysWithData} days)`;
                                }
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

    // Get date mapping for weather
    const dateMapping = aggregateDatesForWeather(cachedDailyDurations, period);
    
    // Collect all dates we need weather for
    const allDates = Object.values(dateMapping).flat();
    if (WEATHER_CONFIG.enabled && allDates.length > 0) {
        await fetchWeatherData(allDates);
    }
    
    // Build weather labels
    let weatherLabels = labels;
    const weatherInfo = {}; // Store for tooltips
    
    if (WEATHER_CONFIG.enabled) {
        weatherLabels = labels.map(label => {
            const dates = dateMapping[label];
            if (!dates) return label;
            
            if (period === 'day') {
                const weather = cachedWeatherData[dates[0]];
                if (weather) {
                    weatherInfo[label] = weather;
                    return `${weather.icon} ${label}`;
                }
            } else {
                // Week or month - aggregate weather
                const aggWeather = getAggregatedWeather(dates);
                if (aggWeather) {
                    weatherInfo[label] = aggWeather;
                    return `${aggWeather.icon} ${label}`;
                }
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
                            const label = labels[context.dataIndex];
                            const weather = weatherInfo[label];
                            if (weather) {
                                if (period === 'day') {
                                    return `Weather: ${weather.icon} ${weather.tempMin}°C - ${weather.tempMax}°C`;
                                } else {
                                    return `Avg weather: ${weather.icon} ${weather.tempMin}°C - ${weather.tempMax}°C (${weather.daysWithData} days)`;
                                }
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
    const rounded = dataArray.map(v => Math.round(v * 10) / 10);
    
    if (hourlyChartInstance) hourlyChartInstance.destroy();

    hourlyChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Minutes Outside',
                data: rounded,
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointBackgroundColor: 'rgba(75, 192, 192, 1)'
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
                title: { display: true, text: 'Time Outside by Hour (minutes)', color: '#fff' },
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.raw} min outside`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render Weather Correlation scatter chart
 * X-axis: Average temperature (°C), Y-axis: Total minutes outside that day
 */
async function renderWeatherCorrelationChart(dailyDurations) {
    const canvas = document.getElementById('weatherCorrelationChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (weatherCorrelationInstance) weatherCorrelationInstance.destroy();

    // Collect all dates with outing data
    const dates = Object.keys(dailyDurations).filter(d => dailyDurations[d] > 0);
    const isoDates = dates.map(d => localeDateToISO(d)).filter(Boolean);

    if (isoDates.length === 0) {
        // No data yet
        weatherCorrelationInstance = new Chart(ctx, {
            type: 'scatter',
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'Need more data...', color: '#666' }
                }
            }
        });
        return;
    }

    // Fetch weather for all relevant dates
    if (WEATHER_CONFIG.enabled) {
        await fetchWeatherData(isoDates);
    }

    // Build scatter data points
    const dataPoints = [];
    dates.forEach(dateStr => {
        const isoDate = localeDateToISO(dateStr);
        if (!isoDate || !cachedWeatherData[isoDate]) return;

        const weather = cachedWeatherData[isoDate];
        const avgTemp = Math.round(((weather.tempMax + weather.tempMin) / 2) * 10) / 10;
        const duration = Math.round(dailyDurations[dateStr]);

        if (duration > 0) {
            dataPoints.push({
                x: avgTemp,
                y: duration,
                label: dateStr,
                weather: weather
            });
        }
    });

    if (dataPoints.length === 0) {
        weatherCorrelationInstance = new Chart(ctx, {
            type: 'scatter',
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'No weather data available yet', color: '#666' }
                }
            }
        });
        return;
    }

    // Group data points by weather category for separate datasets (legend)
    const categories = {
        'Sunny': { color: 'rgba(255, 206, 86, 0.7)', border: 'rgba(255, 206, 86, 1)', points: [] },
        'Cloudy': { color: 'rgba(201, 203, 207, 0.7)', border: 'rgba(201, 203, 207, 1)', points: [] },
        'Drizzle': { color: 'rgba(54, 162, 235, 0.7)', border: 'rgba(54, 162, 235, 1)', points: [] },
        'Rain/Storm': { color: 'rgba(255, 99, 132, 0.7)', border: 'rgba(255, 99, 132, 1)', points: [] }
    };

    dataPoints.forEach(p => {
        const severity = WEATHER_SEVERITY[p.weather.code] ?? 0;
        if (severity <= 1) categories['Sunny'].points.push(p);
        else if (severity <= 3) categories['Cloudy'].points.push(p);
        else if (severity <= 5) categories['Drizzle'].points.push(p);
        else categories['Rain/Storm'].points.push(p);
    });

    const datasets = Object.entries(categories)
        .filter(([_, cat]) => cat.points.length > 0)
        .map(([name, cat]) => ({
            label: `${name} (${cat.points.length})`,
            data: cat.points,
            backgroundColor: cat.color,
            borderColor: cat.border,
            pointRadius: 5,
            pointHoverRadius: 7,
            borderWidth: 1
        }));

    weatherCorrelationInstance = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'Avg Temperature (°C)', color: '#888' },
                    grid: { color: '#333' },
                    ticks: { color: '#888' }
                },
                y: {
                    title: { display: true, text: 'Minutes Outside', color: '#888' },
                    beginAtZero: true,
                    grid: { color: '#333' },
                    ticks: { color: '#888' }
                }
            },
            plugins: {
                title: { display: true, text: 'Weather vs Time Outside', color: '#fff' },
                legend: { 
                    display: true, 
                    position: 'top',
                    labels: { color: '#aaa', usePointStyle: true, pointStyle: 'circle', padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const point = context.raw;
                            return [
                                `${point.label}`,
                                `${point.weather.icon} ${point.x}°C avg`,
                                `${point.y} min outside`
                            ];
                        }
                    }
                }
            }
        }
    });
}

/**
 * Generate and render fun insights panel with weather correlation
 */
async function renderInsightsPanel(dailyCounts, dailyDurations, hourlyDuration, stats) {
    const panel = document.getElementById('insightsPanel');
    if (!panel) return;

    // Ensure weather data is loaded for all dates with durations
    const dates = Object.keys(dailyDurations);
    const isoDates = dates.map(d => localeDateToISO(d)).filter(Boolean);
    if (WEATHER_CONFIG.enabled && isoDates.length > 0) {
        await fetchWeatherData(isoDates);
    }

    const insights = [];

    // 1. Favorite time of day (from time-based data)
    if (hourlyDuration) {
        let maxHour = -1, maxMinutes = 0;
        hourlyDuration.forEach((min, hour) => {
            if (min > maxMinutes) { maxMinutes = min; maxHour = hour; }
        });
        if (maxHour >= 0 && maxMinutes > 0) {
            const endHour = (maxHour + 1) % 24;
            const period = maxHour < 6 ? 'night owl' : maxHour < 12 ? 'morning cat' : maxHour < 17 ? 'afternoon adventurer' : 'evening prowler';
            insights.push({
                icon: maxHour < 6 ? '🌙' : maxHour < 12 ? '🌅' : maxHour < 17 ? '☀️' : '🌆',
                text: `Your cat is a <strong>${period}</strong>`,
                detail: `Peak activity: ${maxHour}:00–${endHour}:00 (${Math.round(maxMinutes)} min total)`
            });
        }
    }

    // 2. Weather preference - compare avg time outside by weather type
    const weatherGroups = { sunny: { min: 0, days: 0 }, cloudy: { min: 0, days: 0 }, rainy: { min: 0, days: 0 } };
    dates.forEach(dateStr => {
        const isoDate = localeDateToISO(dateStr);
        if (!isoDate || !cachedWeatherData[isoDate]) return;
        const severity = WEATHER_SEVERITY[cachedWeatherData[isoDate].code] ?? 0;
        const minutes = dailyDurations[dateStr] || 0;
        if (severity <= 2) { weatherGroups.sunny.min += minutes; weatherGroups.sunny.days++; }
        else if (severity <= 4) { weatherGroups.cloudy.min += minutes; weatherGroups.cloudy.days++; }
        else { weatherGroups.rainy.min += minutes; weatherGroups.rainy.days++; }
    });

    const sunnyAvg = weatherGroups.sunny.days > 0 ? Math.round(weatherGroups.sunny.min / weatherGroups.sunny.days) : 0;
    const cloudyAvg = weatherGroups.cloudy.days > 0 ? Math.round(weatherGroups.cloudy.min / weatherGroups.cloudy.days) : 0;
    const rainyAvg = weatherGroups.rainy.days > 0 ? Math.round(weatherGroups.rainy.min / weatherGroups.rainy.days) : 0;

    if (weatherGroups.sunny.days > 0 && (weatherGroups.cloudy.days > 0 || weatherGroups.rainy.days > 0)) {
        const best = [{ name: 'sunny', avg: sunnyAvg, icon: '☀️' }, { name: 'cloudy', avg: cloudyAvg, icon: '☁️' }, { name: 'rainy', avg: rainyAvg, icon: '🌧️' }]
            .filter(w => w.avg > 0)
            .sort((a, b) => b.avg - a.avg);
        if (best.length >= 2) {
            const pctMore = best[1].avg > 0 ? Math.round((best[0].avg / best[1].avg - 1) * 100) : 0;
            insights.push({
                icon: best[0].icon,
                text: `Prefers <strong>${best[0].name} days</strong> — ${best[0].avg} min/day avg`,
                detail: pctMore > 10 ? `${pctMore}% more time outside than on ${best[1].name} days (${best[1].avg} min)` : `Similar to ${best[1].name} days (${best[1].avg} min)`
            });
        }
    }

    // 3. Temperature sweet spot
    const tempBuckets = {}; // rounded to 5°C bands
    dates.forEach(dateStr => {
        const isoDate = localeDateToISO(dateStr);
        if (!isoDate || !cachedWeatherData[isoDate]) return;
        const weather = cachedWeatherData[isoDate];
        const avgTemp = (weather.tempMax + weather.tempMin) / 2;
        const bucket = Math.round(avgTemp / 5) * 5;
        if (!tempBuckets[bucket]) tempBuckets[bucket] = { totalMin: 0, days: 0 };
        tempBuckets[bucket].totalMin += dailyDurations[dateStr] || 0;
        tempBuckets[bucket].days++;
    });

    let bestTemp = null, bestTempAvg = 0;
    Object.keys(tempBuckets).forEach(t => {
        const b = tempBuckets[t];
        if (b.days >= 2) { // need at least 2 days to be meaningful
            const avg = b.totalMin / b.days;
            if (avg > bestTempAvg) { bestTempAvg = avg; bestTemp = parseInt(t); }
        }
    });

    if (bestTemp !== null) {
        const lo = bestTemp - 2, hi = bestTemp + 2;
        insights.push({
            icon: '🌡️',
            text: `Sweet spot: <strong>${lo}°C – ${hi}°C</strong>`,
            detail: `Avg ${Math.round(bestTempAvg)} min outside when temps are around ${bestTemp}°C`
        });
    }

    // 4. Record day with weather context
    let longestDay = 0, longestDayDate = '';
    Object.keys(dailyDurations).forEach(dateStr => {
        if (dailyDurations[dateStr] > longestDay) { longestDay = dailyDurations[dateStr]; longestDayDate = dateStr; }
    });
    if (longestDay > 0) {
        const hours = Math.floor(longestDay / 60);
        const mins = Math.round(longestDay % 60);
        const formatted = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        const isoDate = localeDateToISO(longestDayDate);
        const weather = isoDate ? cachedWeatherData[isoDate] : null;
        const weatherNote = weather ? ` — it was ${weather.icon} ${weather.tempMax}°C` : '';
        insights.push({
            icon: '🏆',
            text: `Record adventure: <strong>${formatted}</strong> outside`,
            detail: `${longestDayDate}${weatherNote}`
        });
    }

    // 5. Weekday vs Weekend personality
    const weekdayData = { minutes: 0, days: 0 };
    const weekendData = { minutes: 0, days: 0 };
    Object.keys(dailyDurations).forEach(dateStr => {
        const date = new Date(dateStr);
        const day = date.getDay();
        const isWeekend = (day === 0 || day === 6);
        const target = isWeekend ? weekendData : weekdayData;
        target.minutes += dailyDurations[dateStr] || 0;
        target.days++;
    });

    if (weekdayData.days > 0 && weekendData.days > 0) {
        const wdAvg = Math.round(weekdayData.minutes / weekdayData.days);
        const weAvg = Math.round(weekendData.minutes / weekendData.days);
        const diff = Math.abs(weAvg - wdAvg);
        if (diff > 5) {
            if (weAvg > wdAvg) {
                insights.push({ icon: '😴', text: `Lazy weekdays, wild weekends`, detail: `${weAvg} min/day on weekends vs ${wdAvg} on weekdays` });
            } else {
                insights.push({ icon: '💼', text: `Weekday wanderer`, detail: `${wdAvg} min/day on weekdays vs ${weAvg} on weekends` });
            }
        } else {
            insights.push({ icon: '⚖️', text: `Perfectly balanced schedule`, detail: `~${wdAvg} min/day regardless of the day` });
        }
    }

    // 6. Rain dodger or rain lover?
    if (weatherGroups.rainy.days >= 2 && weatherGroups.sunny.days >= 2) {
        if (rainyAvg > sunnyAvg * 0.8) {
            insights.push({
                icon: '☔',
                text: `<strong>Rain lover!</strong> Doesn't mind the wet`,
                detail: `${rainyAvg} min/day even in rain (${weatherGroups.rainy.days} rainy days tracked)`
            });
        } else if (rainyAvg < sunnyAvg * 0.3) {
            insights.push({
                icon: '🐱',
                text: `<strong>Rain dodger</strong> — true cat instinct`,
                detail: `Only ${rainyAvg} min/day in rain vs ${sunnyAvg} on sunny days`
            });
        }
    }

    // Render
    if (insights.length === 0) {
        panel.innerHTML = '<p style="color: #666; font-style: italic;">Not enough data for insights yet. Keep tracking!</p>';
        return;
    }

    panel.innerHTML = insights.map(insight => `
        <div style="display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid #333;">
            <span style="font-size: 20px; min-width: 28px;">${insight.icon}</span>
            <div>
                <div style="color: #ddd; font-size: 14px;">${insight.text}</div>
                <div style="color: #666; font-size: 12px; margin-top: 2px;">${insight.detail}</div>
            </div>
        </div>
    `).join('');
}
