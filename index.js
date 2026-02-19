// Local CSV used as the single source of truth for chart data.
const CSV_PATH = "./assets/imdb_top_1000.csv";

// Human-readable labels shown in the dropdown/button/equation text.
const TREND_LABELS = {
    linear: "Linear regression",
    quadratic: "Quadratic curve",
    logarithmic: "Logarithmic fit",
    exponential: "Exponential fit"
};

// Color coding for each trend model so mode changes are visually obvious.
const TREND_COLORS = {
    linear: "#1668c1",
    quadratic: "#b843c9",
    logarithmic: "#1c8f63",
    exponential: "#c05b17"
};
const GROUP_COLOR_PALETTE = [
    "#f5c518",
    "#5b8def",
    "#f97316",
    "#22c55e",
    "#e11d48",
    "#14b8a6",
    "#a855f7",
    "#0ea5e9",
    "#84cc16",
    "#ef4444"
];

// Raw rows parsed from CSV (strings before numeric conversion).
let rows = [];
// Columns considered numeric enough to be valid axes.
let numericColumns = [];
// Clean points currently used by the chart/table.
let points = [];
// Default axis choices on first load.
let xColumn = "IMDB_Rating";
let yColumn = "Meta_score";
let groupBy = "primaryGenre";
let predictFeatureA = "Gross";
let predictFeatureB = "IMDB_Rating";
let predictTarget = "Runtime";
let predictK = 7;
// Active trend model selected by the user.
let trendMode = "linear";
// Chart.js instance (created once, updated after).
let chart = null;
// Tracks hovered point so we only pulse info box on actual row change.
let lastHoverRowId = null;
// requestAnimationFrame handle for trendline animation cancellation.
let trendAnimationFrame = null;

// Wait for DOM to be ready before querying controls/canvas.
document.addEventListener("DOMContentLoaded", () => {
    // Trigger CSS entrance transitions after first paint.
    requestAnimationFrame(() => {
        document.body.classList.add("page-ready");
    });
    // Begin data load immediately after UI mount.
    loadDataset();
});

// Fetch CSV, parse it, and initialize controls + first render.
async function loadDataset() {
    const stats = document.getElementById("point-stats");
    try {
        const response = await fetch(CSV_PATH);
        const csvText = await response.text();

        // Parse CSV text into row objects keyed by header.
        rows = parseCsv(csvText);
        // Detect which columns can reliably be treated as numbers.
        numericColumns = detectNumericColumns(rows);

        if (!numericColumns.length) {
            stats.textContent = "No numeric columns found in dataset.";
            return;
        }

        // Fallback to first numeric column if default x is missing.
        if (!numericColumns.includes(xColumn)) {
            xColumn = numericColumns[0];
        }
        // Fallback to second numeric column for y when available.
        if (!numericColumns.includes(yColumn)) {
            yColumn = numericColumns[Math.min(1, numericColumns.length - 1)];
        }

        // Bind UI events only after data is known.
        setupControls();
        // Build points and render chart/table.
        rebuildPoints();
    } catch (_error) {
        // Keep failure message user-facing and non-technical.
        stats.textContent = "Failed to load assets/imdb_top_1000.csv";
    }
}

// Wire select/button controls to reactive chart updates.
function setupControls() {
    const xSelect = document.getElementById("x-select");
    const ySelect = document.getElementById("y-select");
    const groupSelect = document.getElementById("group-by-select");
    const trendSelect = document.getElementById("trend-model-select");
    const trendlineButton = document.getElementById("trendline-btn");
    const predictFeatureASelect = document.getElementById("predict-feature-a");
    const predictFeatureBSelect = document.getElementById("predict-feature-b");
    const predictTargetSelect = document.getElementById("predict-target");
    const predictKSelect = document.getElementById("predict-k");
    const predictButton = document.getElementById("predict-btn");
    const predictInputA = document.getElementById("predict-input-a");
    const predictInputB = document.getElementById("predict-input-b");

    // Build option list once from numeric column names.
    const optionsHtml = numericColumns
        .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`)
        .join("");

    setPredictionDefaults();

    // Hydrate controls with current state values.
    xSelect.innerHTML = optionsHtml;
    ySelect.innerHTML = optionsHtml;
    predictFeatureASelect.innerHTML = optionsHtml;
    predictFeatureBSelect.innerHTML = optionsHtml;
    predictTargetSelect.innerHTML = optionsHtml;
    xSelect.value = xColumn;
    ySelect.value = yColumn;
    groupSelect.value = groupBy;
    trendSelect.value = trendMode;
    predictFeatureASelect.value = predictFeatureA;
    predictFeatureBSelect.value = predictFeatureB;
    predictTargetSelect.value = predictTarget;
    predictKSelect.value = String(predictK);
    updatePredictionInputPlaceholders();
    updateTrendlineButtonLabel();
    updateTrendEquation(`Trend line: ${TREND_LABELS[trendMode]} not generated`);

    // Axis changes rebuild all points because parsability can change by column.
    xSelect.addEventListener("change", (event) => {
        xColumn = event.target.value;
        rebuildPoints();
    });

    ySelect.addEventListener("change", (event) => {
        yColumn = event.target.value;
        rebuildPoints();
    });

    predictFeatureASelect.addEventListener("change", (event) => {
        predictFeatureA = event.target.value;
        updatePredictionInputPlaceholders();
    });

    predictFeatureBSelect.addEventListener("change", (event) => {
        predictFeatureB = event.target.value;
        updatePredictionInputPlaceholders();
    });

    predictTargetSelect.addEventListener("change", (event) => {
        predictTarget = event.target.value;
    });

    predictKSelect.addEventListener("change", (event) => {
        predictK = Number.parseInt(event.target.value, 10) || 7;
    });

    predictButton.addEventListener("click", () => {
        runKnnPrediction();
    });

    predictInputA.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            runKnnPrediction();
        }
    });

    predictInputB.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            runKnnPrediction();
        }
    });

    // Grouping changes only affect coloring/splitting of point datasets.
    groupSelect.addEventListener("change", (event) => {
        groupBy = event.target.value;
        updateChart();
        clearTrendLine(`Trend line: ${TREND_LABELS[trendMode]} not generated`);
    });

    // Model changes reset the line but keep scatter points untouched.
    trendSelect.addEventListener("change", (event) => {
        trendMode = event.target.value;
        updateTrendlineButtonLabel();
        clearTrendLine(`Trend line: ${TREND_LABELS[trendMode]} not generated`);
    });

    // Explicit button action draws trendline on demand.
    trendlineButton.addEventListener("click", () => {
        generateTrendLineAnimated();
    });
}

// Recompute plot-ready points from selected x/y columns.
function rebuildPoints() {
    points = rows
        .map((row, index) => {
            // Parse values using project-specific numeric rules.
            const x = parseNumeric(row[xColumn]);
            const y = parseNumeric(row[yColumn]);
            // Skip records that do not produce a numeric pair.
            if (x === null || y === null) {
                return null;
            }
            // Keep extra metadata for tooltip/info-box text.
            return {
                rowId: index + 1,
                title: row.Series_Title || `Row ${index + 1}`,
                year: row.Released_Year || "",
                genre: row.Genre || "",
                rating: row.IMDB_Rating || "",
                certificate: row.Certificate || "Unknown",
                decade: toDecadeLabel(row.Released_Year),
                primaryGenre: getPrimaryGenre(row.Genre),
                ratingBand: toRatingBand(row.IMDB_Rating),
                x,
                y
            };
        })
        .filter(Boolean);

    // Update table preview with latest points.
    renderPointList();
    // Update/initialize chart datasets and labels.
    updateChart();
    // Any axis change invalidates the previous fitted line.
    clearTrendLine(`Trend line: ${TREND_LABELS[trendMode]} not generated`);

    const stats = document.getElementById("point-stats");
    stats.textContent = `${points.length} points plotted from ${rows.length} movies`;
    // Replay visual feedback animation on every recompute.
    pulseElement(stats);
}

// Create the chart once, then mutate datasets/options for subsequent updates.
function updateChart() {
    const canvas = document.getElementById("scatter-chart");
    if (!canvas) {
        return;
    }

    // Split points into color-coded datasets by the selected grouping key.
    const groupedMovieDatasets = buildGroupedMovieDatasets(points, groupBy);

    if (!chart) {
        chart = new Chart(canvas, {
            type: "scatter",
            data: {
                datasets: [...groupedMovieDatasets, makeTrendDataset()]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // Disable Chart.js built-in animations; custom animation is handled manually.
                animation: false,
                plugins: {
                    legend: { display: true, position: "bottom" },
                    tooltip: {
                        // Ignore trendline dataset so tooltip callbacks only process movie points.
                        filter(context) {
                            return Boolean(context.raw && context.raw.movie);
                        },
                        callbacks: {
                            label(context) {
                                const movie = context.raw.movie;
                                // Defensive guard in case raw point does not include metadata.
                                if (!movie) {
                                    return null;
                                }
                                return `${movie.title}: (${formatNumber(movie.x)}, ${formatNumber(movie.y)})`;
                            },
                            afterLabel(context) {
                                const movie = context.raw.movie;
                                if (!movie) {
                                    return null;
                                }
                                return `Year: ${movie.year} | Genre: ${movie.genre}`;
                            }
                        }
                    }
                },
                scales: {
                    // Dynamic titles reflect current x/y selections.
                    x: {
                        type: "linear",
                        title: { display: true, text: xColumn, color: "#1e1f23", font: { weight: "700" } },
                        ticks: { color: "#2c2f36" },
                        grid: { color: "rgba(44, 47, 54, 0.12)" }
                    },
                    y: {
                        type: "linear",
                        title: { display: true, text: yColumn, color: "#1e1f23", font: { weight: "700" } },
                        ticks: { color: "#2c2f36" },
                        grid: { color: "rgba(44, 47, 54, 0.12)" }
                    }
                },
                // Custom hover handling drives the external info box.
                onHover(event, activeElements) {
                    if (!activeElements.length) {
                        updateInfoBox(null);
                        event.native.target.style.cursor = "default";
                        return;
                    }

                    const hoveredMovie = getHoveredMovie(activeElements);
                    if (!hoveredMovie) {
                        updateInfoBox(null);
                        event.native.target.style.cursor = "default";
                        return;
                    }

                    event.native.target.style.cursor = "pointer";
                    updateInfoBox(hoveredMovie);
                }
            }
        });
        return;
    }

    // Fast path: mutate existing chart instead of recreating instance.
    const trendDataset = getTrendDataset();
    chart.data.datasets = [...groupedMovieDatasets, trendDataset];
    trendDataset.borderColor = TREND_COLORS[trendMode];
    chart.options.scales.x.title.text = xColumn;
    chart.options.scales.y.title.text = yColumn;
    chart.update();
    // Reset info panel because active point index may no longer match.
    updateInfoBox(null);
}

// Build and animate the selected model line on top of the scatter plot.
function generateTrendLineAnimated() {
    if (!chart || points.length < 2) {
        return;
    }

    // Build model-specific predictor and equation text.
    const fit = buildTrendFit(points, trendMode);
    if (!fit) {
        updateTrendEquation(`Trend line: ${TREND_LABELS[trendMode]} unavailable for selected data`);
        return;
    }

    // Sample predictor over x-range to create drawable polyline.
    const targetLine = createLinePoints(fit.predict, fit.minX, fit.maxX, 100);
    if (targetLine.length < 2) {
        updateTrendEquation(`Trend line: ${TREND_LABELS[trendMode]} unavailable for selected data`);
        return;
    }

    const trendlineButton = document.getElementById("trendline-btn");
    const trendDataset = getTrendDataset();
    const currentLine = trendDataset.data;
    // Re-sample existing line so animation morphs from current shape smoothly.
    const startLine = normalizeLineForAnimation(currentLine, targetLine);
    const durationMs = 1300;
    const startTime = performance.now();

    // Cancel any in-flight animation before starting another.
    if (trendAnimationFrame) {
        cancelAnimationFrame(trendAnimationFrame);
    }

    updateTrendEquation(fit.equation);
    trendlineButton.disabled = true;
    trendDataset.borderColor = TREND_COLORS[trendMode];

    // Animate both reveal length and y-value interpolation for fluid transitions.
    const animate = (timestamp) => {
        const t = Math.min(1, (timestamp - startTime) / durationMs);
        const eased = easeInOutCubic(t);
        const visibleCount = Math.max(2, Math.floor(eased * targetLine.length));
        const frameData = [];

        for (let i = 0; i < visibleCount; i += 1) {
            const source = startLine[i];
            const target = targetLine[i];
            frameData.push({
                x: target.x,
                y: lerp(source.y, target.y, eased)
            });
        }

        trendDataset.data = frameData;
        chart.update("none");

        if (t < 1) {
            trendAnimationFrame = requestAnimationFrame(animate);
            return;
        }

        trendAnimationFrame = null;
        trendlineButton.disabled = false;
        // Snap to exact target points at animation end.
        trendDataset.data = targetLine;
        chart.update("none");
    };

    trendAnimationFrame = requestAnimationFrame(animate);
}

// Return predictor + equation text for currently selected trend mode.
function buildTrendFit(dataPoints, mode) {
    const xValues = dataPoints.map((point) => point.x);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);

    if (mode === "linear") {
        const fit = calculateLinearRegression(dataPoints);
        if (!fit) {
            return null;
        }
        return {
            minX,
            maxX,
            predict: (x) => fit.slope * x + fit.intercept,
            equation: `Linear regression: y = ${formatSigned(fit.slope)}x ${formatOffset(fit.intercept)} (R^2 ${formatNumber(fit.rSquared)})`
        };
    }

    if (mode === "quadratic") {
        const fit = calculateQuadraticRegression(dataPoints);
        if (!fit) {
            return null;
        }
        return {
            minX,
            maxX,
            predict: (x) => fit.a * x * x + fit.b * x + fit.c,
            equation: `Quadratic curve: y = ${formatSigned(fit.a)}x^2 ${formatOffset(fit.b)}x ${formatOffset(fit.c)} (R^2 ${formatNumber(fit.rSquared)})`
        };
    }

    if (mode === "logarithmic") {
        // ln(x) requires x > 0, so filter invalid samples.
        const positiveX = dataPoints.filter((point) => point.x > 0);
        if (positiveX.length < 2) {
            return null;
        }
        // Transform x with ln(x), then fit a straight line in transformed space.
        const transformed = positiveX.map((point) => ({ x: Math.log(point.x), y: point.y }));
        const fit = calculateLinearRegression(transformed);
        if (!fit) {
            return null;
        }
        const xPositive = positiveX.map((point) => point.x);
        return {
            minX: Math.min(...xPositive),
            maxX: Math.max(...xPositive),
            predict: (x) => fit.slope * Math.log(x) + fit.intercept,
            equation: `Logarithmic fit: y = ${formatSigned(fit.slope)}ln(x) ${formatOffset(fit.intercept)}`
        };
    }

    if (mode === "exponential") {
        // exp fit via log transform needs y > 0 to compute ln(y).
        const positiveY = dataPoints.filter((point) => point.y > 0);
        if (positiveY.length < 2) {
            return null;
        }
        // Fit ln(y) = bx + ln(a), then convert back to y = a*e^(bx).
        const transformed = positiveY.map((point) => ({ x: point.x, y: Math.log(point.y) }));
        const fit = calculateLinearRegression(transformed);
        if (!fit) {
            return null;
        }
        const a = Math.exp(fit.intercept);
        const b = fit.slope;
        return {
            minX,
            maxX,
            predict: (x) => a * Math.exp(b * x),
            equation: `Exponential fit: y = ${formatNumber(a)}e^(${formatSigned(b)}x)`
        };
    }

    return null;
}

// Sample a predictor function at evenly spaced x values.
function createLinePoints(predict, minX, maxX, steps) {
    const linePoints = [];
    for (let i = 0; i < steps; i += 1) {
        const ratio = steps === 1 ? 0 : i / (steps - 1);
        const x = minX + (maxX - minX) * ratio;
        const y = predict(x);
        // Skip NaN/Infinity so Chart.js receives only valid points.
        if (Number.isFinite(y)) {
            linePoints.push({ x, y });
        }
    }
    return linePoints;
}

// Produce start curve aligned to target x-grid for smooth morph animation.
function normalizeLineForAnimation(currentLine, targetLine) {
    if (!currentLine || currentLine.length < 2) {
        // First render: start flat from first target y.
        const initialY = targetLine[0].y;
        return targetLine.map((point) => ({ x: point.x, y: initialY }));
    }
    // Existing render: interpolate old curve values at each new x.
    return targetLine.map((target) => ({
        x: target.x,
        y: interpolateYAtX(currentLine, target.x)
    }));
}

// Piecewise-linear interpolation of y for a given x on existing line data.
function interpolateYAtX(lineData, x) {
    const sorted = lineData;
    if (x <= sorted[0].x) {
        return sorted[0].y;
    }
    if (x >= sorted[sorted.length - 1].x) {
        return sorted[sorted.length - 1].y;
    }

    for (let i = 1; i < sorted.length; i += 1) {
        const left = sorted[i - 1];
        const right = sorted[i];
        if (x >= left.x && x <= right.x) {
            const span = right.x - left.x || 1;
            const ratio = (x - left.x) / span;
            return lerp(left.y, right.y, ratio);
        }
    }
    return sorted[sorted.length - 1].y;
}

// Remove trend line and reset equation/button UI state.
function clearTrendLine(label = `Trend line: ${TREND_LABELS[trendMode]} not generated`) {
    if (trendAnimationFrame) {
        cancelAnimationFrame(trendAnimationFrame);
        trendAnimationFrame = null;
    }

    const trendlineButton = document.getElementById("trendline-btn");
    if (trendlineButton) {
        trendlineButton.disabled = false;
    }

    if (chart && chart.data.datasets.length) {
        const trendDataset = getTrendDataset();
        trendDataset.data = [];
        trendDataset.borderColor = TREND_COLORS[trendMode];
        chart.update();
    }

    updateTrendEquation(label);
}

// Keep button text synchronized with selected model.
function updateTrendlineButtonLabel() {
    const trendlineButton = document.getElementById("trendline-btn");
    if (trendlineButton) {
        trendlineButton.textContent = `Generate ${TREND_LABELS[trendMode]}`;
    }
}

// Update equation label and trigger subtle pulse animation.
function updateTrendEquation(text) {
    const equationLabel = document.getElementById("line-equation");
    if (!equationLabel) {
        return;
    }
    equationLabel.textContent = text;
    pulseElement(equationLabel);
}

// Render details for hovered movie point in the fixed info box.
function updateInfoBox(point) {
    const infoBox = document.getElementById("info-box");
    if (!point) {
        infoBox.innerHTML = "Hover a point to inspect movie details.";
        lastHoverRowId = null;
        return;
    }

    if (lastHoverRowId !== point.rowId) {
        pulseElement(infoBox);
    }
    lastHoverRowId = point.rowId;

    infoBox.innerHTML = `
        <strong>${escapeHtml(point.title)}</strong><br>
        Year: ${escapeHtml(point.year)}<br>
        Genre: ${escapeHtml(point.genre)}<br>
        ${escapeHtml(xColumn)}: ${formatNumber(point.x)}<br>
        ${escapeHtml(yColumn)}: ${formatNumber(point.y)}<br>
        IMDB rating: ${escapeHtml(point.rating)}
    `;
}

// Render top-N rows to keep table usable with large datasets.
function renderPointList() {
    const body = document.getElementById("xy-body");
    if (points.length === 0) {
        body.innerHTML = "<tr><td colspan=\"4\">No points available.</td></tr>";
        return;
    }

    const maxRows = Math.min(40, points.length);
    let html = "";
    for (let index = 0; index < maxRows; index += 1) {
        const point = points[index];
        html += `<tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(point.title)}</td>
            <td>${formatNumber(point.x)}</td>
            <td>${formatNumber(point.y)}</td>
        </tr>`;
    }
    body.innerHTML = html;
}

// Initialize prediction selectors with sensible defaults from available numeric columns.
function setPredictionDefaults() {
    predictFeatureA = pickPredictionColumn("Gross", []);
    predictFeatureB = pickPredictionColumn("IMDB_Rating", [predictFeatureA]);
    predictTarget = pickPredictionColumn("Runtime", [predictFeatureA, predictFeatureB]);
    if (!predictTarget) {
        predictTarget = pickPredictionColumn("", []);
    }
}

function pickPredictionColumn(preferred, excluded) {
    if (preferred && numericColumns.includes(preferred) && !excluded.includes(preferred)) {
        return preferred;
    }
    const fallback = numericColumns.find((column) => !excluded.includes(column));
    return fallback || "";
}

function updatePredictionInputPlaceholders() {
    const inputA = document.getElementById("predict-input-a");
    const inputB = document.getElementById("predict-input-b");
    if (inputA) {
        inputA.placeholder = `Enter ${predictFeatureA}`;
    }
    if (inputB) {
        inputB.placeholder = `Enter ${predictFeatureB}`;
    }
}

// Predict one target value from two user-provided features using KNN regression.
function runKnnPrediction() {
    const featureAInput = document.getElementById("predict-input-a");
    const featureBInput = document.getElementById("predict-input-b");
    const titleInput = document.getElementById("predict-movie-title");

    if (!predictFeatureA || !predictFeatureB || !predictTarget) {
        showPredictionResult("Prediction setup is incomplete.", "error");
        return;
    }
    if (predictFeatureA === predictFeatureB) {
        showPredictionResult("Feature A and Feature B must be different columns.", "error");
        return;
    }
    if (predictTarget === predictFeatureA || predictTarget === predictFeatureB) {
        showPredictionResult("Target must be different from the two input features.", "error");
        return;
    }

    const inputA = parseNumeric(featureAInput.value);
    const inputB = parseNumeric(featureBInput.value);
    if (inputA === null || inputB === null) {
        showPredictionResult("Please enter valid numeric values for both features.", "error");
        return;
    }

    const trainingRows = buildPredictionTrainingRows(predictFeatureA, predictFeatureB, predictTarget);
    if (trainingRows.length < 3) {
        showPredictionResult("Not enough valid rows found for this feature/target combination.", "error");
        return;
    }

    const prediction = predictWithKnn(trainingRows, inputA, inputB, predictK);
    if (!prediction) {
        showPredictionResult("Prediction could not be calculated.", "error");
        return;
    }

    const movieTitle = (titleInput.value || "").trim() || "Your movie";
    const nearestPreview = prediction.neighbors
        .slice(0, 3)
        .map((neighbor) => escapeHtml(neighbor.title))
        .join(", ");
    const message = `<strong>${escapeHtml(movieTitle)}</strong>: predicted ${escapeHtml(predictTarget)} = <strong>${formatPredictedValue(predictTarget, prediction.value)}</strong> (K=${prediction.k}, trained on ${prediction.trainingSize} movies). Closest matches: ${nearestPreview || "N/A"}.`;
    showPredictionResult(message, "success");
}

function buildPredictionTrainingRows(featureAKey, featureBKey, targetKey) {
    return rows
        .map((row) => {
            const featureA = parseNumeric(row[featureAKey]);
            const featureB = parseNumeric(row[featureBKey]);
            const target = parseNumeric(row[targetKey]);
            if (featureA === null || featureB === null || target === null) {
                return null;
            }
            return {
                featureA,
                featureB,
                target,
                title: row.Series_Title || "Unknown"
            };
        })
        .filter(Boolean);
}

function predictWithKnn(trainingRows, inputA, inputB, requestedK) {
    if (!trainingRows.length) {
        return null;
    }

    // Standardize each feature so large-scale columns (e.g. Gross) do not dominate distance.
    const statsA = calculateStandardizationStats(trainingRows.map((row) => row.featureA));
    const statsB = calculateStandardizationStats(trainingRows.map((row) => row.featureB));
    const normalizedA = normalizeValue(inputA, statsA);
    const normalizedB = normalizeValue(inputB, statsB);

    const neighborsByDistance = trainingRows
        .map((row) => {
            const rowA = normalizeValue(row.featureA, statsA);
            const rowB = normalizeValue(row.featureB, statsB);
            return {
                ...row,
                distance: Math.hypot(rowA - normalizedA, rowB - normalizedB)
            };
        })
        .sort((left, right) => left.distance - right.distance);

    const k = Math.max(1, Math.min(requestedK, neighborsByDistance.length));
    const neighbors = neighborsByDistance.slice(0, k);
    let weightedSum = 0;
    let weightTotal = 0;
    for (const neighbor of neighbors) {
        const weight = 1 / (neighbor.distance + 1e-6);
        weightedSum += neighbor.target * weight;
        weightTotal += weight;
    }

    if (weightTotal === 0) {
        return null;
    }

    return {
        value: weightedSum / weightTotal,
        neighbors,
        k,
        trainingSize: trainingRows.length
    };
}

function calculateStandardizationStats(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => {
        const diff = value - mean;
        return sum + diff * diff;
    }, 0) / values.length;
    const std = Math.sqrt(variance);
    return {
        mean,
        std: std > 0 ? std : 1
    };
}

function normalizeValue(value, stats) {
    return (value - stats.mean) / stats.std;
}

function formatPredictedValue(columnKey, value) {
    if (columnKey === "Runtime") {
        return `${formatNumber(value)} min`;
    }
    return formatNumber(value);
}

function showPredictionResult(message, status) {
    const result = document.getElementById("predict-result");
    if (!result) {
        return;
    }
    result.classList.remove("error", "success");
    if (status) {
        result.classList.add(status);
    }
    result.innerHTML = message;
    pulseElement(result);
}

// Parse numbers from plain numeric strings, grouped numbers, and "min" values.
function parseNumeric(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    if (/^[-+]?\d+(\.\d+)?$/.test(text)) {
        return Number(text);
    }
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
        return Number(text.replace(/,/g, ""));
    }
    if (/^[-+]?\d+(\.\d+)?\s*min$/i.test(text)) {
        return Number(text.toLowerCase().replace("min", "").trim());
    }
    return null;
}

// Classic least-squares line fit; also reused by transformed models.
function calculateLinearRegression(dataPoints) {
    if (dataPoints.length < 2) {
        return null;
    }

    const n = dataPoints.length;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    let sumYY = 0;

    for (const point of dataPoints) {
        sumX += point.x;
        sumY += point.y;
        sumXX += point.x * point.x;
        sumXY += point.x * point.y;
        sumYY += point.y * point.y;
    }

    // Degenerate case: all x are identical, slope undefined.
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) {
        return null;
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    const corrDenominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    const correlation = corrDenominator === 0 ? 0 : (n * sumXY - sumX * sumY) / corrDenominator;
    const rSquared = correlation * correlation;

    return { slope, intercept, rSquared };
}

// Quadratic fit solved from normal equations: y = ax^2 + bx + c.
function calculateQuadraticRegression(dataPoints) {
    if (dataPoints.length < 3) {
        return null;
    }

    let sx = 0;
    let sx2 = 0;
    let sx3 = 0;
    let sx4 = 0;
    let sy = 0;
    let sxy = 0;
    let sx2y = 0;

    // Accumulate polynomial sums required by the normal-equation matrix.
    for (const point of dataPoints) {
        const x = point.x;
        const y = point.y;
        const x2 = x * x;
        sx += x;
        sx2 += x2;
        sx3 += x2 * x;
        sx4 += x2 * x2;
        sy += y;
        sxy += x * y;
        sx2y += x2 * y;
    }

    const n = dataPoints.length;
    const coefficients = solve3x3(
        [
            [sx4, sx3, sx2],
            [sx3, sx2, sx],
            [sx2, sx, n]
        ],
        [sx2y, sxy, sy]
    );

    if (!coefficients) {
        return null;
    }

    const [a, b, c] = coefficients;
    const rSquared = computeRSquared(dataPoints, (x) => a * x * x + b * x + c);
    return { a, b, c, rSquared };
}

// Solve 3x3 linear system with Gaussian elimination + partial pivoting.
function solve3x3(matrix, vector) {
    // Augment matrix with RHS column.
    const m = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

    for (let col = 0; col < 3; col += 1) {
        // Pick numerically strongest pivot in this column.
        let pivot = col;
        for (let row = col + 1; row < 3; row += 1) {
            if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
                pivot = row;
            }
        }
        // Singular/near-singular system cannot be solved safely.
        if (Math.abs(m[pivot][col]) < 1e-12) {
            return null;
        }
        // Swap pivot row into current position.
        if (pivot !== col) {
            const temp = m[col];
            m[col] = m[pivot];
            m[pivot] = temp;
        }

        // Normalize pivot row to make diagonal = 1.
        const pivotValue = m[col][col];
        for (let j = col; j < 4; j += 1) {
            m[col][j] /= pivotValue;
        }
        // Eliminate current column from all other rows.
        for (let row = 0; row < 3; row += 1) {
            if (row === col) {
                continue;
            }
            const factor = m[row][col];
            for (let j = col; j < 4; j += 1) {
                m[row][j] -= factor * m[col][j];
            }
        }
    }

    return [m[0][3], m[1][3], m[2][3]];
}

// Compute coefficient of determination against an arbitrary predictor.
function computeRSquared(dataPoints, predict) {
    const meanY = dataPoints.reduce((sum, point) => sum + point.y, 0) / dataPoints.length;
    let ssRes = 0;
    let ssTot = 0;
    for (const point of dataPoints) {
        const error = point.y - predict(point.x);
        ssRes += error * error;
        const spread = point.y - meanY;
        ssTot += spread * spread;
    }
    if (ssTot === 0) {
        return 1;
    }
    return Math.max(0, 1 - ssRes / ssTot);
}

// Heuristic: column is numeric when at least ~60% of rows are parseable.
function detectNumericColumns(dataRows) {
    if (!dataRows.length) {
        return [];
    }
    const headers = Object.keys(dataRows[0]);
    const threshold = Math.max(15, Math.floor(dataRows.length * 0.6));
    const columns = [];

    for (const header of headers) {
        let validCount = 0;
        for (const row of dataRows) {
            if (parseNumeric(row[header]) !== null) {
                validCount += 1;
            }
        }
        if (validCount >= threshold) {
            columns.push(header);
        }
    }

    return columns;
}

// Lightweight CSV parser supporting quotes, escaped quotes, and newlines.
function parseCsv(csvText) {
    const lines = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let index = 0; index < csvText.length; index += 1) {
        const char = csvText[index];
        const next = csvText[index + 1];

        // Toggle quote mode unless this is an escaped quote pair.
        if (char === "\"") {
            if (inQuotes && next === "\"") {
                value += "\"";
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === "," && !inQuotes) {
            // Comma splits fields only when outside quoted text.
            row.push(value);
            value = "";
        } else if ((char === "\n" || char === "\r") && !inQuotes) {
            // Newline ends row only when outside quoted text.
            if (char === "\r" && next === "\n") {
                index += 1;
            }
            row.push(value);
            if (row.some((cell) => cell !== "")) {
                lines.push(row);
            }
            row = [];
            value = "";
        } else {
            value += char;
        }
    }

    // Flush trailing row if file does not end with newline.
    if (value.length > 0 || row.length > 0) {
        row.push(value);
        lines.push(row);
    }

    const headers = lines[0];
    // Convert matrix rows to objects keyed by header names.
    return lines.slice(1).map((line) => {
        const item = {};
        headers.forEach((header, idx) => {
            item[header] = line[idx] || "";
        });
        return item;
    });
}

// Number formatter for compact axis/tooltip/equation output.
function formatNumber(value) {
    return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
    });
}

// Format coefficient with explicit sign for leading term.
function formatSigned(value) {
    return value >= 0 ? formatNumber(value) : `-${formatNumber(Math.abs(value))}`;
}

// Format coefficient as " + c" / " - c" for equation readability.
function formatOffset(value) {
    if (value >= 0) {
        return `+ ${formatNumber(value)}`;
    }
    return `- ${formatNumber(Math.abs(value))}`;
}

// Linear interpolation utility used during line morphing.
function lerp(start, end, t) {
    return start + (end - start) * t;
}

// Easing function gives smoother acceleration/deceleration than linear time.
function easeInOutCubic(t) {
    if (t < 0.5) {
        return 4 * t * t * t;
    }
    return 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Escape content inserted into HTML to avoid broken markup/XSS.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Restart CSS pulse animation by removing and re-adding the class.
function pulseElement(element) {
    if (!element) {
        return;
    }
    element.classList.remove("pulse");
    // Force reflow so repeated pulses retrigger reliably.
    void element.offsetWidth;
    element.classList.add("pulse");
}

function makeTrendDataset() {
    return {
        label: "Trend Line",
        type: "line",
        data: [],
        parsing: false,
        showLine: true,
        pointRadius: 0,
        borderWidth: 3,
        borderColor: TREND_COLORS[trendMode],
        tension: 0,
        order: 0
    };
}

function getTrendDataset() {
    const existing = chart.data.datasets.find((dataset) => dataset.type === "line");
    return existing || makeTrendDataset();
}

function buildGroupedMovieDatasets(allPoints, groupKey) {
    const grouped = new Map();
    for (const point of allPoints) {
        const key = String(point[groupKey] || "Unknown");
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push({
            x: point.x,
            y: point.y,
            movie: point
        });
    }

    const sortedKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    return sortedKeys.map((key, index) => {
        const color = GROUP_COLOR_PALETTE[index % GROUP_COLOR_PALETTE.length];
        return {
            label: key,
            data: grouped.get(key),
            parsing: false,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: withAlpha(color, 0.75),
            pointBorderColor: "#111",
            pointBorderWidth: 1
        };
    });
}

function getHoveredMovie(activeElements) {
    for (const active of activeElements) {
        const dataset = chart.data.datasets[active.datasetIndex];
        const item = dataset && dataset.data ? dataset.data[active.index] : null;
        if (item && item.movie) {
            return item.movie;
        }
    }
    return null;
}

function toDecadeLabel(yearValue) {
    const year = Number.parseInt(String(yearValue || "").trim(), 10);
    if (!Number.isFinite(year)) {
        return "Unknown";
    }
    const decade = Math.floor(year / 10) * 10;
    return `${decade}s`;
}

function getPrimaryGenre(genreValue) {
    const raw = String(genreValue || "").trim();
    if (!raw) {
        return "Unknown";
    }
    return raw.split(",")[0].trim() || "Unknown";
}

function toRatingBand(ratingValue) {
    const rating = parseNumeric(ratingValue);
    if (rating === null) {
        return "Unknown";
    }
    const lower = Math.floor(rating);
    if (lower >= 9) {
        return "9.0+";
    }
    return `${lower}.0-${lower}.9`;
}

function withAlpha(hexColor, alpha) {
    const hex = hexColor.replace("#", "");
    if (hex.length !== 6) {
        return hexColor;
    }
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
