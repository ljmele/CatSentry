// predictions.js - behavioral forecasting panel

window.App = window.App || {};
App.predictions = App.predictions || {};

/**
 * Formats a 24h hour index into a 12h time label.
 * @param {number} h - Hour index in [0, 23].
 * @returns {string} Formatted hour label.
 */
App.predictions.formatHour = function formatHour(h) {
	if (h === 0) return "12 AM";
	if (h < 12) return `${h} AM`;
	if (h === 12) return "12 PM";
	return `${h - 12} PM`;
};

/**
 * Applies a day modifier to a base probability with hard clamping to [0, 1].
 * @param {number} baseProbability - Unadjusted probability.
 * @param {number} dayModifier - Weekday/weekend adjustment factor.
 * @returns {number} Adjusted and clamped probability.
 */
App.predictions.calculateAdjustedProbability = function calculateAdjustedProbability(baseProbability, dayModifier) {
	const base = Number.isFinite(baseProbability) ? baseProbability : 0;
	const modifier = Number.isFinite(dayModifier) ? dayModifier : 1;
	const adjusted = base * modifier;
	if (adjusted < 0) return 0;
	if (adjusted > 1) return 1;
	return Math.round(adjusted * 1000) / 1000;
};

App.predictions.renderPredictionPanel = function renderPredictionPanel(history, dataModel) {
	const panel = document.getElementById("predictionContent");
	if (!panel) return;

	const model = dataModel || App.dataModel || {};
	const validHistory = (history || []).filter(e => e.timestamp >= MIN_VALID_TIMESTAMP);

	if (validHistory.length < 10) {
		panel.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Need more data to predict - keep tracking! (min 10 events)</p>';
		return;
	}

	const sorted = [...validHistory].sort((a, b) => a.timestamp - b.timestamp);
	const dailyCounts = model.dailyCounts || {};
	const hourlyDuration = model.hourlyDuration || new Array(24).fill(0);
	const dailyHourlyDurations = model.dailyHourlyDurations || {};

	const now = new Date();
	const currentHour = now.getHours();
	const currentDay = now.getDay();
	const isWeekend = currentDay === 0 || currentDay === 6;

	const hourlyOutsideDays = new Array(24).fill(0);
	const totalDaysTracked = Object.keys(dailyCounts).length || 1;

	Object.values(dailyHourlyDurations).forEach(hourArray => {
		for (let h = 0; h < 24; h++) {
			if ((hourArray[h] || 0) > 0) hourlyOutsideDays[h]++;
		}
	});

	const hourlyProbability = hourlyOutsideDays.map(d => Math.min(d / totalDaysTracked, 1.0));

	const wdDays = { count: 0, outings: 0 };
	const weDays = { count: 0, outings: 0 };

	Object.keys(dailyCounts).forEach(dateStr => {
		const d = new Date(dateStr);
		const dayNum = d.getDay();

		if (dayNum === 0 || dayNum === 6) {
			weDays.count++;
			weDays.outings += dailyCounts[dateStr];
		} else {
			wdDays.count++;
			wdDays.outings += dailyCounts[dateStr];
		}
	});

	const wdAvgOutings = wdDays.count > 0 ? wdDays.outings / wdDays.count : 1;
	const weAvgOutings = weDays.count > 0 ? weDays.outings / weDays.count : 1;
	const overallAvg = (wdAvgOutings * 5 + weAvgOutings * 2) / 7 || 1;
	const dayModifier = isWeekend ? (weAvgOutings / overallAvg) : (wdAvgOutings / overallAvg);

	const hourlyAvgDuration = new Array(24).fill(0);
	hourlyDuration.forEach((min, h) => {
		hourlyAvgDuration[h] = hourlyOutsideDays[h] > 0 ? Math.round(min / hourlyOutsideDays[h]) : 0;
	});

	const catStatus = model.catStatus || getCatStatus(validHistory);
	const isCurrentlyOutside = catStatus.status === "outside";

	let avgOutingDurationNow = 0;
	let avgInsideDurationNow = 0;
	let outingCountForHour = 0;
	let insideCountForHour = 0;

	let state = false;
	let lastChangeTime = null;

	for (const event of sorted) {
		if (event.type === 2) {
			if (!state && lastChangeTime) {
				const insideHour = new Date(lastChangeTime).getHours();
				const dur = (event.timestamp - lastChangeTime) / 1000 / 60;

				if (dur > 0.5 && dur < 1440 && insideHour === currentHour) {
					avgInsideDurationNow += dur;
					insideCountForHour++;
				}
			}

			state = true;
			lastChangeTime = event.timestamp;
		} else if (event.type === 1) {
			if (state && lastChangeTime) {
				const outHour = new Date(lastChangeTime).getHours();
				const dur = (event.timestamp - lastChangeTime) / 1000 / 60;

				if (dur >= 0.5 && dur <= 300 && outHour === currentHour) {
					avgOutingDurationNow += dur;
					outingCountForHour++;
				}
			}

			state = false;
			lastChangeTime = event.timestamp;
		}
	}

	avgOutingDurationNow = outingCountForHour > 0 ? Math.round(avgOutingDurationNow / outingCountForHour) : 15;
	avgInsideDurationNow = insideCountForHour > 0 ? Math.round(avgInsideDurationNow / insideCountForHour) : 60;

	const currentProb = App.predictions.calculateAdjustedProbability(hourlyProbability[currentHour], dayModifier);
	const currentProbPct = Math.round(currentProb * 100);

	let nowPrediction;
	if (isCurrentlyOutside) {
		nowPrediction = {
			icon: "🌳",
			label: "Marie is outside right now",
			detail: `Based on her patterns, she typically stays out ~${avgOutingDurationNow} min when leaving around this hour.`,
			confidence: `${currentProbPct}% of tracked days she's been outside at ${currentHour}:00`
		};
	} else if (currentProbPct >= 50) {
		nowPrediction = {
			icon: "🚪",
			label: "Marie is likely to head out soon!",
			detail: `At this hour she's historically outside ${currentProbPct}% of the time - an outing may be imminent.`,
			confidence: `Avg outing length at this hour: ~${avgOutingDurationNow} min`
		};
	} else if (currentProbPct >= 20) {
		nowPrediction = {
			icon: "🏠",
			label: "Marie is chilling inside",
			detail: `There's a moderate ${currentProbPct}% chance she heads out this hour.`,
			confidence: `She's inside - typical for this time of day (~${avgInsideDurationNow} min)`
		};
	} else {
		nowPrediction = {
			icon: "😴",
			label: "Marie is snoozing",
			detail: `Very low activity at this hour - only ${currentProbPct}% chance of going out.`,
			confidence: "This is usually quiet time for her"
		};
	}

	const timelineSlots = [];
	for (let offset = 1; offset <= 6; offset++) {
		const h = (currentHour + offset) % 24;
		const prob = App.predictions.calculateAdjustedProbability(hourlyProbability[h], dayModifier);
		const probPct = Math.round(prob * 100);
		const avgDur = hourlyAvgDuration[h];

		let icon;
		let label;
		if (probPct >= 60) {
			icon = "🌳";
			label = "Likely out";
		} else if (probPct >= 35) {
			icon = "🐾";
			label = "Maybe out";
		} else if (probPct >= 10) {
			icon = "🏠";
			label = "Probably in";
		} else {
			icon = "😴";
			label = "Asleep";
		}

		timelineSlots.push({
			time: App.predictions.formatHour(h),
			icon,
			label,
			probPct,
			avgDur,
			highlight: probPct >= 50
		});
	}

	let peakHour = -1;
	let peakProb = 0;
	for (let offset = 1; offset <= 12; offset++) {
		const h = (currentHour + offset) % 24;
		const p = App.predictions.calculateAdjustedProbability(hourlyProbability[h], dayModifier);
		if (p > peakProb) {
			peakProb = p;
			peakHour = h;
		}
	}

	const expectedOutings = isWeekend
		? (weAvgOutings > 0 ? weAvgOutings.toFixed(1) : "?")
		: (wdAvgOutings > 0 ? wdAvgOutings.toFixed(1) : "?");

	const funFact = peakHour >= 0
		? `<strong>Next activity peak:</strong> around ${App.predictions.formatHour(peakHour)} (${Math.round(peakProb * 100)}% chance). On a typical ${isWeekend ? "weekend" : "weekday"}, Marie averages <strong>${expectedOutings} outings</strong>.`
		: `Marie averages <strong>${expectedOutings} outings</strong> on ${isWeekend ? "weekends" : "weekdays"}.`;

	panel.innerHTML = `
		<div class="prediction-now">
			<div class="prediction-now-icon">${nowPrediction.icon}</div>
			<div class="prediction-now-text">
				<div class="prediction-now-label">Right now</div>
				<div class="prediction-now-value">${nowPrediction.label}</div>
				<div class="prediction-confidence">${nowPrediction.detail}</div>
				<div class="prediction-confidence" style="margin-top: 1px; opacity: 0.7;">${nowPrediction.confidence}</div>
			</div>
		</div>
		<div class="prediction-timeline">
			${timelineSlots.map(slot => `
				<div class="prediction-slot ${slot.highlight ? "highlight" : ""}">
					<div class="prediction-slot-time">${slot.time}</div>
					<div class="prediction-slot-icon">${slot.icon}</div>
					<div class="prediction-slot-label">${slot.label}</div>
					<div class="prediction-slot-prob">${slot.probPct}%${slot.avgDur > 0 ? ` · ~${slot.avgDur}m` : ""}</div>
				</div>
			`).join("")}
		</div>
		<div class="prediction-fun-fact">🎯 ${funFact}</div>
	`;
};

window.renderPredictionPanel = function renderPredictionPanelCompat(history, hourlyDuration, dailyCounts, dailyDurations) {
	const model = {
		...(App.dataModel || {}),
		hourlyDuration: hourlyDuration || (App.dataModel && App.dataModel.hourlyDuration) || new Array(24).fill(0),
		dailyCounts: dailyCounts || (App.dataModel && App.dataModel.dailyCounts) || {},
		dailyDurations: dailyDurations || (App.dataModel && App.dataModel.dailyDurations) || {},
		dailyHourlyDurations: (App.dataModel && App.dataModel.dailyHourlyDurations) || {}
	};

	App.predictions.renderPredictionPanel(history, model);
};

window.formatHour = App.predictions.formatHour;
window.calculatePredictionProbability = App.predictions.calculateAdjustedProbability;
