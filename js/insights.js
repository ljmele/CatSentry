// insights.js - insights panel generation

window.App = window.App || {};
App.insights = App.insights || {};

App.insights.renderInsightsPanel = async function renderInsightsPanel(dailyCounts, dailyDurations, hourlyDuration, stats, dataModel) {
    const panel = document.getElementById("insightsPanel");
    if (!panel) return;

    const dates = Object.keys(dailyDurations || {});
    const isoDates = dates
        .map(d => (App.weather && App.weather.localeDateToISO ? App.weather.localeDateToISO(d) : null))
        .filter(Boolean);

    const model = dataModel || App.dataModel || {};
    if (App.weather && App.weather.config.enabled && isoDates.length > 0) {
        await App.weather.fetchWeatherData(isoDates, model.dailyHourlyDurations || {});
    }

    const weatherCache = (App.dataModel && App.dataModel.weatherCache) || {};
    const insights = [];

    if (hourlyDuration) {
        let maxHour = -1;
        let maxMinutes = 0;

        hourlyDuration.forEach((min, hour) => {
            if (min > maxMinutes) {
                maxMinutes = min;
                maxHour = hour;
            }
        });

        if (maxHour >= 0 && maxMinutes > 0) {
            const endHour = (maxHour + 1) % 24;
            const period = maxHour < 6
                ? "night owl"
                : maxHour < 12
                    ? "morning cat"
                    : maxHour < 17
                        ? "afternoon adventurer"
                        : "evening prowler";

            insights.push({
                icon: maxHour < 6 ? "🌙" : maxHour < 12 ? "🌅" : maxHour < 17 ? "☀️" : "🌆",
                text: `Marie is a <strong>${period}</strong>`,
                detail: `Peak activity: ${maxHour}:00-${endHour}:00 (${Math.round(maxMinutes)} min total)`
            });
        }
    }

    const weatherGroups = { sunny: { min: 0, days: 0 }, cloudy: { min: 0, days: 0 }, rainy: { min: 0, days: 0 } };
    dates.forEach(dateStr => {
        const isoDate = App.weather && App.weather.localeDateToISO ? App.weather.localeDateToISO(dateStr) : null;
        if (!isoDate || !weatherCache[isoDate]) return;

        const severity = App.weather.getSeverity(weatherCache[isoDate].code);
        const minutes = dailyDurations[dateStr] || 0;

        if (severity <= 2) {
            weatherGroups.sunny.min += minutes;
            weatherGroups.sunny.days++;
        } else if (severity <= 4) {
            weatherGroups.cloudy.min += minutes;
            weatherGroups.cloudy.days++;
        } else {
            weatherGroups.rainy.min += minutes;
            weatherGroups.rainy.days++;
        }
    });

    const sunnyAvg = weatherGroups.sunny.days > 0 ? Math.round(weatherGroups.sunny.min / weatherGroups.sunny.days) : 0;
    const cloudyAvg = weatherGroups.cloudy.days > 0 ? Math.round(weatherGroups.cloudy.min / weatherGroups.cloudy.days) : 0;
    const rainyAvg = weatherGroups.rainy.days > 0 ? Math.round(weatherGroups.rainy.min / weatherGroups.rainy.days) : 0;

    if (weatherGroups.sunny.days > 0 && (weatherGroups.cloudy.days > 0 || weatherGroups.rainy.days > 0)) {
        const best = [
            { name: "sunny", avg: sunnyAvg, icon: "☀️" },
            { name: "cloudy", avg: cloudyAvg, icon: "☁️" },
            { name: "rainy", avg: rainyAvg, icon: "🌧️" }
        ]
            .filter(w => w.avg > 0)
            .sort((a, b) => b.avg - a.avg);

        if (best.length >= 2) {
            const pctMore = best[1].avg > 0 ? Math.round((best[0].avg / best[1].avg - 1) * 100) : 0;
            insights.push({
                icon: best[0].icon,
                text: `Prefers <strong>${best[0].name} days</strong> - ${best[0].avg} min/day avg`,
                detail: pctMore > 10
                    ? `${pctMore}% more time outside than on ${best[1].name} days (${best[1].avg} min)`
                    : `Similar to ${best[1].name} days (${best[1].avg} min)`
            });
        }
    }

    const tempBuckets = {};
    dates.forEach(dateStr => {
        const isoDate = App.weather && App.weather.localeDateToISO ? App.weather.localeDateToISO(dateStr) : null;
        if (!isoDate || !weatherCache[isoDate]) return;

        const weather = weatherCache[isoDate];
        const avgTemp = (weather.tempMax + weather.tempMin) / 2;
        const bucket = Math.round(avgTemp / 5) * 5;

        if (!tempBuckets[bucket]) {
            tempBuckets[bucket] = { totalMin: 0, days: 0 };
        }

        tempBuckets[bucket].totalMin += dailyDurations[dateStr] || 0;
        tempBuckets[bucket].days++;
    });

    let bestTemp = null;
    let bestTempAvg = 0;
    Object.keys(tempBuckets).forEach(t => {
        const b = tempBuckets[t];
        if (b.days < 2) return;

        const avg = b.totalMin / b.days;
        if (avg > bestTempAvg) {
            bestTempAvg = avg;
            bestTemp = parseInt(t, 10);
        }
    });

    if (bestTemp !== null) {
        const lo = bestTemp - 2;
        const hi = bestTemp + 2;
        insights.push({
            icon: "🌡️",
            text: `Sweet spot: <strong>${lo}°C - ${hi}°C</strong>`,
            detail: `Avg ${Math.round(bestTempAvg)} min outside when temps are around ${bestTemp}°C`
        });
    }

    let longestDay = 0;
    let longestDayDate = "";
    Object.keys(dailyDurations).forEach(dateStr => {
        if (dailyDurations[dateStr] > longestDay) {
            longestDay = dailyDurations[dateStr];
            longestDayDate = dateStr;
        }
    });

    if (longestDay > 0) {
        const hours = Math.floor(longestDay / 60);
        const mins = Math.round(longestDay % 60);
        const formatted = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        const isoDate = App.weather && App.weather.localeDateToISO ? App.weather.localeDateToISO(longestDayDate) : null;
        const weather = isoDate ? weatherCache[isoDate] : null;
        const weatherNote = weather ? ` - it was ${weather.icon} ${weather.tempMax}°C` : "";

        insights.push({
            icon: "🏆",
            text: `Record adventure: <strong>${formatted}</strong> outside`,
            detail: `${longestDayDate}${weatherNote}`
        });
    }

    const weekdayData = { minutes: 0, days: 0 };
    const weekendData = { minutes: 0, days: 0 };
    Object.keys(dailyDurations).forEach(dateStr => {
        const date = new Date(dateStr);
        const day = date.getDay();
        const target = day === 0 || day === 6 ? weekendData : weekdayData;
        target.minutes += dailyDurations[dateStr] || 0;
        target.days++;
    });

    if (weekdayData.days > 0 && weekendData.days > 0) {
        const wdAvg = Math.round(weekdayData.minutes / weekdayData.days);
        const weAvg = Math.round(weekendData.minutes / weekendData.days);
        const diff = Math.abs(weAvg - wdAvg);

        if (diff > 5) {
            if (weAvg > wdAvg) {
                insights.push({ icon: "😴", text: "Lazy weekdays, wild weekends", detail: `${weAvg} min/day on weekends vs ${wdAvg} on weekdays` });
            } else {
                insights.push({ icon: "💼", text: "Weekday wanderer", detail: `${wdAvg} min/day on weekdays vs ${weAvg} on weekends` });
            }
        } else {
            insights.push({ icon: "⚖️", text: "Perfectly balanced schedule", detail: `~${wdAvg} min/day regardless of the day` });
        }
    }

    if (weatherGroups.rainy.days >= 2 && weatherGroups.sunny.days >= 2) {
        if (rainyAvg > sunnyAvg * 0.8) {
            insights.push({
                icon: "☔",
                text: "<strong>Rain lover!</strong> Marie doesn't mind the wet",
                detail: `${rainyAvg} min/day even in rain (${weatherGroups.rainy.days} rainy days tracked)`
            });
        } else if (rainyAvg < sunnyAvg * 0.3) {
            insights.push({
                icon: "🐱",
                text: "<strong>Rain dodger</strong> - Marie knows when to stay inside",
                detail: `Only ${rainyAvg} min/day in rain vs ${sunnyAvg} on sunny days`
            });
        }
    }

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
    `).join("");
};
