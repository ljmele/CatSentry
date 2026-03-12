
window.App = window.App || {};
App.analytics = App.analytics || {};

const MIN_VALID_TIMESTAMP = 1577836800000;
const MAX_OUTING_DURATION_MS = 5 * 60 * 60 * 1000;
const MIN_OUTING_DURATION_MS = 30 * 1000;

App.analytics.currentPeriod = "day";
App.analytics.charts = {
    visits: null,
    duration: null,
    hourly: null,
    weatherCorrelation: null
};

function updateAnalytics(history, dataModel) {
    if (!history || history.length === 0) return;

    const model = dataModel
        || (typeof App.refreshDataModel === "function" ? App.refreshDataModel() : null);

    if (!model) return;

    renderHourlyChart(model.hourlyDuration || new Array(24).fill(0));
    renderWeatherCorrelationChart(model.dailyDurations || {}, model);
    renderInsightsPanel(model.dailyCounts || {}, model.dailyDurations || {}, model.hourlyDuration || [], model.stats || {}, model);

    if (App.predictions && typeof App.predictions.renderPredictionPanel === "function") {
        App.predictions.renderPredictionPanel(history, model);
    }

    refreshTimeCharts(model);
}

function setChartPeriod(period) {
    App.analytics.currentPeriod = period;
    
    document.querySelectorAll('.period-btn').forEach(btn => {
        if(btn.id === `btn-${period}`) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    refreshTimeCharts(App.dataModel || {});
}

function refreshTimeCharts(dataModel) {
    const model = dataModel || App.dataModel || {};
    const dailyCounts = model.dailyCounts || {};
    const dailyDurations = model.dailyDurations || {};

    const aggCounts = aggregateData(dailyCounts, App.analytics.currentPeriod);
    const aggDuration = aggregateData(dailyDurations, App.analytics.currentPeriod);

    renderVisitsChart(aggCounts, App.analytics.currentPeriod, model);
    renderDurationChart(aggDuration, App.analytics.currentPeriod, model);
}

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

function aggregateDatesForWeather(dailyData, period) {
    if (period === 'day') {
        const result = {};
        Object.keys(dailyData).forEach(dateStr => {
            const isoDate = App.weather && App.weather.localeDateToISO
                ? App.weather.localeDateToISO(dateStr)
                : null;
            if (isoDate) result[dateStr] = [isoDate];
        });
        return result;
    }

    const aggregated = {};
    
    Object.keys(dailyData).forEach(dateStr => {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return;
        
        const isoDate = App.weather && App.weather.localeDateToISO
            ? App.weather.localeDateToISO(dateStr)
            : null;
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

function processDataWithStateMachine(events) {
    const dailyCounts = {};      // Counts VALID outings (EXIT→ENTRY pairs)
    const dailyDurations = {};   // Duration in minutes
    const hourlyActivity = new Array(24).fill(0); // All events for activity pattern
    const hourlyDuration = new Array(24).fill(0);  // Minutes outside per hour (for Preferred Hours chart)
    const dailyHourlyDurations = {}; // Traccia i minuti passati fuori ora per ora, giorno per giorno

    const processedEvents = [];
    
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

    let catIsOutside = false;
    let currentOuting = null; // { exitTimestamp, exitDateKey, exitEventIndex }
    let lastEntryTimestamp = null;
    let lastEntryIndex = null;

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const date = new Date(event.timestamp);
        const dateKey = date.toLocaleDateString();
        const hour = date.getHours();

        hourlyActivity[hour]++;
        
        const processedEvent = {
            timestamp: event.timestamp,
            type: event.type,
            effective: false,
            reason: ''
        };

        if (event.type === 2) { // EXIT
            if (!catIsOutside) {
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
                if (currentOuting && currentOuting.exitEventIndex !== null) {
                    const prevIdx = currentOuting.exitEventIndex;
                    if (processedEvents[prevIdx]) {
                        processedEvents[prevIdx].effective = false;
                        processedEvents[prevIdx].reason = 'Superseded: later exit detected';
                        stats.effectiveExits--;
                        stats.updatedExits++;
                    }
                }
                
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
                catIsOutside = false;
                
                const durationMs = event.timestamp - currentOuting.exitTimestamp;
                
                if (durationMs >= MIN_OUTING_DURATION_MS && durationMs <= MAX_OUTING_DURATION_MS) {
                    const minutes = durationMs / 1000 / 60;
                    
                    dailyCounts[currentOuting.exitDateKey] = (dailyCounts[currentOuting.exitDateKey] || 0) + 1;
                    dailyDurations[currentOuting.exitDateKey] = (dailyDurations[currentOuting.exitDateKey] || 0) + minutes;
                    
                    const exitDate = new Date(currentOuting.exitTimestamp);
                    const entryDate = new Date(event.timestamp);
                    let cursor = new Date(exitDate);
                    while (cursor < entryDate) {    
                        const hour = cursor.getHours();
                        const cursorDateKey = cursor.toLocaleDateString();
                        
                        if (!dailyHourlyDurations[cursorDateKey]) {
                            dailyHourlyDurations[cursorDateKey] = new Array(24).fill(0);
                        }
                        
                        const nextHour = new Date(cursor);
                        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
                        const sliceEnd = entryDate < nextHour ? entryDate : nextHour;
                        const sliceMinutes = (sliceEnd - cursor) / 1000 / 60;
                        
                        hourlyDuration[hour] += sliceMinutes; // Statistica globale
                        dailyHourlyDurations[cursorDateKey][hour] += sliceMinutes; // Statistica del singolo giorno
                        
                        cursor = nextHour;
                    }
                    
                    stats.completedOutings++;
                    stats.totalTimeOutsideMinutes += minutes;
                    
                    processedEvent.effective = true;
                    processedEvent.reason = `Completed outing: ${Math.round(minutes)} min`;
                    
                } else if (durationMs < MIN_OUTING_DURATION_MS) {
                    processedEvent.effective = true;
                    processedEvent.reason = `Quick return (${Math.round(durationMs/1000)}s) - not counted`;
                    stats.invalidDurations++;
                    
                } else {
                    processedEvent.effective = true;
                    processedEvent.reason = `Duration too long (${Math.round(durationMs/1000/60/60)}h) - not counted`;
                    stats.invalidDurations++;
                }
                
                lastEntryTimestamp = event.timestamp;
                lastEntryIndex = i;
                currentOuting = null;
                stats.effectiveEntries++;
                
            } else {
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
    
    Object.keys(dailyCounts).forEach(dateKey => {
        if (!(dateKey in dailyDurations)) {
            dailyDurations[dateKey] = 0;
        }
    });

    return { dailyCounts, dailyDurations, hourlyActivity, hourlyDuration, stats, processedEvents, dailyHourlyDurations };
}

function getCatStatus(events) {
    if (!events || events.length === 0) return { status: 'unknown', icon: '❓' };
    
    const validEvents = events.filter(e => e.timestamp >= MIN_VALID_TIMESTAMP);
    const sorted = [...validEvents].sort((a, b) => a.timestamp - b.timestamp);
    
    let catIsOutside = false;
    let lastEffectiveExitTime = null;
    let lastEffectiveEntryTime = null;
    
    for (const event of sorted) {
        if (event.type === 2) { // EXIT
            catIsOutside = true;
            lastEffectiveExitTime = event.timestamp;
        } else if (event.type === 1) { // ENTRY
            catIsOutside = false;
            lastEffectiveEntryTime = event.timestamp;
        }
    }
    
    return catIsOutside 
        ? { status: 'outside', icon: '🌳', text: 'Marie is Outside' }
        : { status: 'inside', icon: '🏠', text: 'Marie is Inside' };
}

async function renderVisitsChart(dataObj, period, dataModel) {
    const canvas = document.getElementById('visitsChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj);
    
    const labelText = period === 'day' ? 'Outings per Day' : `Outings per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (App.analytics.charts.visits) App.analytics.charts.visits.destroy();

    const model = dataModel || App.dataModel || {};
    const dateMapping = aggregateDatesForWeather(model.dailyCounts || {}, period);
    const allDates = Object.values(dateMapping).flat();
    if (App.weather && App.weather.config.enabled && allDates.length > 0) {
        await App.weather.fetchWeatherData(allDates, model.dailyHourlyDurations || {});
    }

    const weatherCache = (App.dataModel && App.dataModel.weatherCache) || {};
    
    let weatherLabels = labels;
    const weatherInfo = {}; // Store for tooltips
    
    if (App.weather && App.weather.config.enabled) {
        weatherLabels = labels.map(label => {
            const dates = dateMapping[label];
            if (!dates) return label;
            
            if (period === 'day') {
                const weather = weatherCache[dates[0]];
                if (weather) {
                    weatherInfo[label] = weather;
                    return `${weather.icon} ${label}`;
                }
            } else {
                const aggWeather = App.weather.getAggregatedWeather(dates, weatherCache);
                if (aggWeather) {
                    weatherInfo[label] = aggWeather;
                    return `${aggWeather.icon} ${label}`;
                }
            }
            return label;
        });
    }

    App.analytics.charts.visits = new Chart(ctx, {
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

async function renderDurationChart(dataObj, period) {
    const canvas = document.getElementById('durationChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj).map(m => Math.round(m)); 

    const labelText = period === 'day' ? 'Minutes per Day' : `Minutes per ${period.charAt(0).toUpperCase() + period.slice(1)}`;

    if (App.analytics.charts.duration) App.analytics.charts.duration.destroy();

    const model = App.dataModel || {};
    const dateMapping = aggregateDatesForWeather(model.dailyDurations || {}, period);
    const allDates = Object.values(dateMapping).flat();
    if (App.weather && App.weather.config.enabled && allDates.length > 0) {
        await App.weather.fetchWeatherData(allDates, model.dailyHourlyDurations || {});
    }

    const weatherCache = (App.dataModel && App.dataModel.weatherCache) || {};
    
    let weatherLabels = labels;
    const weatherInfo = {}; // Store for tooltips
    
    if (App.weather && App.weather.config.enabled) {
        weatherLabels = labels.map(label => {
            const dates = dateMapping[label];
            if (!dates) return label;
            
            if (period === 'day') {
                const weather = weatherCache[dates[0]];
                if (weather) {
                    weatherInfo[label] = weather;
                    return `${weather.icon} ${label}`;
                }
            } else {
                const aggWeather = App.weather.getAggregatedWeather(dates, weatherCache);
                if (aggWeather) {
                    weatherInfo[label] = aggWeather;
                    return `${aggWeather.icon} ${label}`;
                }
            }
            return label;
        });
    }

    App.analytics.charts.duration = new Chart(ctx, {
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
    const labels = Array.from({length: 24}, (_, i) => {
        if (i === 0) return '12AM';
        if (i < 12) return `${i}AM`;
        if (i === 12) return '12PM';
        return `${i - 12}PM`;
    });
    const rounded = dataArray.map(v => Math.round(v * 10) / 10);

    const maxVal = Math.max(...rounded);
    
    if (App.analytics.charts.hourly) App.analytics.charts.hourly.destroy();

    const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.height / 2
    );
    gradient.addColorStop(0, 'rgba(0, 230, 118, 0.05)');
    gradient.addColorStop(1, 'rgba(0, 230, 118, 0.25)');

    App.analytics.charts.hourly = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Minutes Outside',
                data: rounded,
                backgroundColor: gradient,
                borderColor: 'rgba(0, 230, 118, 0.8)',
                borderWidth: 2,
                pointRadius: rounded.map(v => v === maxVal && maxVal > 0 ? 5 : 2),
                pointHoverRadius: 6,
                pointBackgroundColor: rounded.map(v => v === maxVal && maxVal > 0 ? '#00e676' : 'rgba(0, 230, 118, 0.6)'),
                pointBorderColor: 'transparent',
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { color: 'rgba(255,255,255,0.06)' },
                    grid: { color: 'rgba(255,255,255,0.06)', circular: true },
                    pointLabels: { 
                        color: '#a0a0a0', 
                        font: { size: 11, family: "'Inter', system-ui, sans-serif", weight: '500' },
                        padding: 12
                    },
                    ticks: { 
                        backdropColor: 'transparent', 
                        display: false,
                        stepSize: Math.ceil(maxVal / 4) || 5
                    },
                    suggestedMin: 0
                }
            },
            plugins: { 
                title: { 
                    display: true, 
                    text: maxVal > 0 ? `Peak: ${labels[rounded.indexOf(maxVal)]} (${maxVal} min)` : 'Time Outside by Hour',
                    color: '#a0a0a0',
                    font: { size: 12, family: "'Inter', system-ui, sans-serif", weight: '500' },
                    padding: { bottom: 8 }
                },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(20,20,20,0.95)',
                    borderColor: 'rgba(0, 230, 118, 0.3)',
                    borderWidth: 1,
                    titleColor: '#f0f0f0',
                    bodyColor: '#a0a0a0',
                    titleFont: { family: "'Inter', system-ui, sans-serif" },
                    bodyFont: { family: "'Inter', system-ui, sans-serif" },
                    cornerRadius: 8,
                    padding: 10,
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

async function renderWeatherCorrelationChart(dailyDurations, dataModel) {
    if (App.weather && typeof App.weather.renderWeatherCorrelationChart === "function") {
        await App.weather.renderWeatherCorrelationChart(dailyDurations, dataModel);
    }
}

async function renderInsightsPanel(dailyCounts, dailyDurations, hourlyDuration, stats, dataModel) {
    if (App.insights && typeof App.insights.renderInsightsPanel === "function") {
        await App.insights.renderInsightsPanel(dailyCounts, dailyDurations, hourlyDuration, stats, dataModel);
    }
}

window.updateAnalytics = updateAnalytics;
window.setChartPeriod = setChartPeriod;
window.processDataWithStateMachine = processDataWithStateMachine;
window.getCatStatus = getCatStatus;
