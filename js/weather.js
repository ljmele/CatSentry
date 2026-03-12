// weather.js - weather config, mappings, and data fetch helpers

window.App = window.App || {};
App.weather = App.weather || {};

App.weather.config = {
    latitude: 46.0711,
    longitude: 13.2346,
    enabled: true
};

App.weather.sleep = function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

App.weather.fetchWithRetry = async function fetchWithRetry(url, options = {}) {
    const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
    const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 500;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (response.ok) return response;

            if (response.status >= 500 || response.status === 429) {
                throw new Error(`Weather API temporary failure: ${response.status}`);
            }

            return response;
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries) break;
            const waitMs = baseDelayMs * Math.pow(2, attempt);
            await App.weather.sleep(waitMs);
        }
    }

    throw lastError;
};

const WEATHER_ICONS = {
    0: "☀️",
    1: "🌤️",
    2: "⛅",
    3: "☁️",
    45: "🌫️",
    48: "🌫️",
    51: "🌧️",
    53: "🌧️",
    55: "🌧️",
    56: "🌧️",
    57: "🌧️",
    61: "🌧️",
    63: "🌧️",
    65: "🌧️",
    66: "🌧️",
    67: "🌧️",
    71: "🌨️",
    73: "🌨️",
    75: "🌨️",
    77: "🌨️",
    80: "🌦️",
    81: "🌦️",
    82: "⛈️",
    85: "🌨️",
    86: "🌨️",
    95: "⛈️",
    96: "⛈️",
    99: "⛈️"
};

const WEATHER_SEVERITY = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    45: 4,
    48: 4,
    51: 5,
    53: 5,
    55: 5,
    56: 5,
    57: 5,
    61: 6,
    63: 7,
    65: 8,
    66: 7,
    67: 8,
    71: 6,
    73: 7,
    75: 8,
    77: 6,
    80: 6,
    81: 7,
    82: 9,
    85: 7,
    86: 8,
    95: 9,
    96: 10,
    99: 10
};

const SEVERITY_TO_CODE = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 45,
    5: 51,
    6: 61,
    7: 63,
    8: 65,
    9: 95,
    10: 96
};

App.weather.getSeverity = function getSeverity(code) {
    return WEATHER_SEVERITY[code] ?? 0;
};

App.weather.getWeatherIcon = function getWeatherIcon(code) {
    return WEATHER_ICONS[code] || "❓";
};

App.weather.getAverageWeather = function getAverageWeather(weatherCodes) {
    if (!weatherCodes || weatherCodes.length === 0) return null;

    let totalSeverity = 0;
    for (const code of weatherCodes) {
        totalSeverity += App.weather.getSeverity(code);
    }

    const avgSeverity = Math.round(totalSeverity / weatherCodes.length);
    return SEVERITY_TO_CODE[avgSeverity] ?? 0;
};

App.weather.localeDateToISO = function localeDateToISO(localeDateStr) {
    const date = new Date(localeDateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split("T")[0];
};

App.weather.getAggregatedWeather = function getAggregatedWeather(isoDates, weatherCache) {
    if (!isoDates || isoDates.length === 0) return null;

    const cache = weatherCache || (App.dataModel && App.dataModel.weatherCache) || {};
    const weatherCodes = [];
    let tempMaxSum = 0;
    let tempMinSum = 0;
    let count = 0;

    for (const date of isoDates) {
        const weather = cache[date];
        if (!weather) continue;

        weatherCodes.push(weather.code);
        tempMaxSum += weather.tempMax;
        tempMinSum += weather.tempMin;
        count++;
    }

    if (count === 0) return null;

    const avgCode = App.weather.getAverageWeather(weatherCodes);
    return {
        icon: App.weather.getWeatherIcon(avgCode),
        tempMax: Math.round(tempMaxSum / count),
        tempMin: Math.round(tempMinSum / count),
        daysWithData: count
    };
};

App.weather.fetchWeatherData = async function fetchWeatherData(dates, dailyHourlyDurations) {
    if (!App.weather.config.enabled || !dates || dates.length === 0) {
        return (App.dataModel && App.dataModel.weatherCache) || {};
    }

    App.dataModel = App.dataModel || {};
    App.dataModel.weatherCache = App.dataModel.weatherCache || {};
    const cache = App.dataModel.weatherCache;

    const uncachedDates = dates.filter(d => !cache[d]);
    if (uncachedDates.length === 0) return cache;

    const todayStr = new Date().toISOString().split("T")[0];
    const validDates = uncachedDates.filter(d => d <= todayStr);
    if (validDates.length === 0) return cache;

    validDates.sort();
    const startDate = validDates[0];
    const endDate = validDates[validDates.length - 1];

    const apiUrl = "https://archive-api.open-meteo.com/v1/archive?"
        + `latitude=${App.weather.config.latitude}&longitude=${App.weather.config.longitude}`
        + `&start_date=${startDate}&end_date=${endDate}`
        + "&hourly=weather_code,temperature_2m,precipitation"
        + "&timezone=Europe/Rome";

    try {
        const response = await App.weather.fetchWithRetry(apiUrl, {
            maxRetries: 2,
            baseDelayMs: 600
        });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();

        const hourlyDataByDate = {};
        for (let i = 0; i < data.hourly.time.length; i++) {
            const timeStr = data.hourly.time[i];
            const dateStrIso = timeStr.split("T")[0];
            const hour = parseInt(timeStr.split("T")[1].substring(0, 2), 10);

            if (!hourlyDataByDate[dateStrIso]) {
                hourlyDataByDate[dateStrIso] = new Array(24);
            }

            hourlyDataByDate[dateStrIso][hour] = {
                temp: data.hourly.temperature_2m[i],
                code: data.hourly.weather_code[i],
                precip: data.hourly.precipitation[i] || 0
            };
        }

        const perDayDurations = dailyHourlyDurations || (App.dataModel && App.dataModel.dailyHourlyDurations) || {};

        validDates.forEach(isoDate => {
            const dayHourlyWeather = hourlyDataByDate[isoDate];
            if (!dayHourlyWeather) return;

            const localeDateKey = Object.keys(perDayDurations).find(
                key => App.weather.localeDateToISO(key) === isoDate
            );

            const hourlyDurations = localeDateKey
                ? perDayDurations[localeDateKey]
                : new Array(24).fill(0);

            let totalMinsOutside = 0;
            let weightedTemp = 0;
            let weightedSeverity = 0;
            let exactPrecipitation = 0;

            for (let h = 0; h < 24; h++) {
                const mins = hourlyDurations[h] || 0;
                if (mins > 0 && dayHourlyWeather[h]) {
                    totalMinsOutside += mins;
                    weightedTemp += dayHourlyWeather[h].temp * mins;
                    weightedSeverity += App.weather.getSeverity(dayHourlyWeather[h].code) * mins;
                    exactPrecipitation += dayHourlyWeather[h].precip;
                }
            }

            if (totalMinsOutside === 0) {
                let sumTemp = 0;
                let maxCode = 0;

                for (let h = 0; h < 24; h++) {
                    sumTemp += dayHourlyWeather[h].temp;
                    maxCode = Math.max(maxCode, dayHourlyWeather[h].code);
                }

                const avgDayTemp = Math.round(sumTemp / 24);
                cache[isoDate] = {
                    code: maxCode,
                    icon: App.weather.getWeatherIcon(maxCode),
                    tempMax: avgDayTemp,
                    tempMin: avgDayTemp,
                    precipitation: 0
                };
                return;
            }

            const avgTemp = Math.round(weightedTemp / totalMinsOutside);
            const avgSeverity = Math.round(weightedSeverity / totalMinsOutside);
            let finalCode = SEVERITY_TO_CODE[avgSeverity] || 0;

            if (finalCode >= 51 && exactPrecipitation < 1.0) {
                finalCode = 2;
            }

            cache[isoDate] = {
                code: finalCode,
                icon: App.weather.getWeatherIcon(finalCode),
                tempMax: avgTemp,
                tempMin: avgTemp,
                precipitation: exactPrecipitation
            };
        });
    } catch (error) {
        console.warn("Failed to fetch weather data:", error);
        if (App.ui && typeof App.ui.showToast === "function") {
            App.ui.showToast("Weather service is temporarily unavailable.", "warning");
        }
    }

    return cache;
};

App.weather.renderWeatherCorrelationChart = async function renderWeatherCorrelationChart(dailyDurations, dataModel) {
    const canvas = document.getElementById("weatherCorrelationChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    App.analytics = App.analytics || {};
    App.analytics.charts = App.analytics.charts || {};

    if (App.analytics.charts.weatherCorrelation) {
        App.analytics.charts.weatherCorrelation.destroy();
    }

    const dates = Object.keys(dailyDurations || {}).filter(d => (dailyDurations[d] || 0) > 0);
    const isoDates = dates.map(d => App.weather.localeDateToISO(d)).filter(Boolean);

    if (isoDates.length === 0) {
        App.analytics.charts.weatherCorrelation = new Chart(ctx, {
            type: "scatter",
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: "Need more data...", color: "#666" }
                }
            }
        });
        return;
    }

    const model = dataModel || App.dataModel || {};
    if (App.weather.config.enabled) {
        await App.weather.fetchWeatherData(isoDates, model.dailyHourlyDurations || {});
    }

    const weatherCache = (App.dataModel && App.dataModel.weatherCache) || {};
    const dataPoints = [];

    dates.forEach(dateStr => {
        const isoDate = App.weather.localeDateToISO(dateStr);
        if (!isoDate || !weatherCache[isoDate]) return;

        const weather = weatherCache[isoDate];
        const avgTemp = Math.round(((weather.tempMax + weather.tempMin) / 2) * 10) / 10;
        const duration = Math.round(dailyDurations[dateStr]);

        if (duration > 0) {
            dataPoints.push({ x: avgTemp, y: duration, label: dateStr, weather });
        }
    });

    if (dataPoints.length === 0) {
        App.analytics.charts.weatherCorrelation = new Chart(ctx, {
            type: "scatter",
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: "No weather data available yet", color: "#666" }
                }
            }
        });
        return;
    }

    const categories = {
        Sunny: { color: "rgba(255, 206, 86, 0.7)", border: "rgba(255, 206, 86, 1)", points: [] },
        Cloudy: { color: "rgba(201, 203, 207, 0.7)", border: "rgba(201, 203, 207, 1)", points: [] },
        Drizzle: { color: "rgba(54, 162, 235, 0.7)", border: "rgba(54, 162, 235, 1)", points: [] },
        "Rain/Storm": { color: "rgba(255, 99, 132, 0.7)", border: "rgba(255, 99, 132, 1)", points: [] }
    };

    dataPoints.forEach(p => {
        const severity = App.weather.getSeverity(p.weather.code);
        if (severity <= 1) categories.Sunny.points.push(p);
        else if (severity <= 3) categories.Cloudy.points.push(p);
        else if (severity <= 5) categories.Drizzle.points.push(p);
        else categories["Rain/Storm"].points.push(p);
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

    App.analytics.charts.weatherCorrelation = new Chart(ctx, {
        type: "scatter",
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: "Avg Temperature (°C)", color: "#888" },
                    grid: { color: "#333" },
                    ticks: { color: "#888" }
                },
                y: {
                    title: { display: true, text: "Minutes Outside", color: "#888" },
                    beginAtZero: true,
                    grid: { color: "#333" },
                    ticks: { color: "#888" }
                }
            },
            plugins: {
                title: { display: true, text: "Weather vs Time Outside", color: "#fff" },
                legend: {
                    display: true,
                    position: "top",
                    labels: { color: "#aaa", usePointStyle: true, pointStyle: "circle", padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
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
};
