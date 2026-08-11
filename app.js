/* ============================================================
 * UI + live-data glue — app.js
 * (all sizing physics lives in sizing.js)
 * ============================================================ */
'use strict';

const S = window.AerostatSizing;

const API = {
    GEOCODE: 'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=en&q=',
    // One call returns model elevation + ground/level weather + wind
    FORECAST: (lat, lon, level) =>
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,` +
        `temperature_${level}hPa,relative_humidity_${level}hPa` +
        `&forecast_days=1&timezone=auto`
};

// ── DOM ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const cityInput = $('cityInput'), altitudeInput = $('altitudeInput'),
    payloadInput = $('payloadInput'), windInput = $('windInput'),
    windMode = $('windMode'), windManualGroup = $('windManualGroup'),
    enduranceInput = $('enduranceInput'), powerInput = $('powerInput'),
    heliumPriceInput = $('heliumPriceInput'), atmosphereMode = $('atmosphereMode'),
    calculateBtn = $('calculateBtn'), resetBtn = $('resetBtn'),
    resultsCard = $('resultsCard'), errorMessage = $('errorMessage'),
    warnMessage = $('warnMessage');

calculateBtn.addEventListener('click', run);
resetBtn.addEventListener('click', resetForm);
windMode.addEventListener('change', () => {
    windManualGroup.classList.toggle('hidden', windMode.value !== 'manual');
});

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
    resultsCard.classList.add('hidden');
}
function showWarn(msg) {
    warnMessage.textContent = (warnMessage.style.display === 'block'
        ? warnMessage.textContent + ' ' : '') + msg;
    warnMessage.style.display = 'block';
}
function clearMessages() {
    errorMessage.style.display = 'none';
    warnMessage.style.display = 'none';
    warnMessage.textContent = '';
}
const fmt = (n, dec = 2) => Number(n).toLocaleString('en-IN',
    { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtCost = n => '₹ ' + Number(n).toLocaleString('en-IN',
    { maximumFractionDigits: 0 });

// ── Location + weather ───────────────────────────────────────
async function geocode(city) {
    const res = await fetch(API.GEOCODE + encodeURIComponent(city),
        { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Geocoding service unavailable — try again.');
    const data = await res.json();
    if (!data || data.length === 0) throw new Error(`City "${city}" not found.`);
    const { lat, lon, display_name } = data[0];
    const parts = display_name.split(', ');
    return {
        lat: +lat, lon: +lon,
        name: parts[0], country: parts[parts.length - 1]
    };
}

function nearestPressureLevel(hPa) {
    const levels = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];
    return levels.reduce((p, c) => Math.abs(c - hPa) < Math.abs(p - hPa) ? c : p);
}

/** Fetch elevation + live weather + today's max wind in one call. */
async function fetchSiteData(lat, lon, totalAltGuess_m) {
    const level = nearestPressureLevel(S.isaPressure(totalAltGuess_m) / 100);
    const res = await fetch(API.FORECAST(lat, lon, level));
    if (!res.ok) throw new Error('Weather/elevation service unavailable — try again.');
    const data = await res.json();
    const elevation = (typeof data.elevation === 'number') ? data.elevation : 0;

    let live = null, windMax_kmph = null;
    try {
        const h = data.hourly;
        const winds = (h.wind_speed_10m || []).filter(v => typeof v === 'number');
        if (winds.length) windMax_kmph = Math.max(...winds);   // Open-Meteo default: kmph
        const nowLocal = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000)
            .toISOString().slice(0, 13) + ':00';
        let idx = h.time.findIndex(t => t === nowLocal);
        if (idx < 0) idx = 0;
        const tAlt = h[`temperature_${level}hPa`]?.[idx];
        const rhAlt = h[`relative_humidity_${level}hPa`]?.[idx];
        const tGnd = h.temperature_2m?.[idx];
        const rhGnd = h.relative_humidity_2m?.[idx];
        if ([tAlt, rhAlt, tGnd, rhGnd].every(v => typeof v === 'number')) {
            live = {
                alt: { T_K: tAlt + 273.15, RH: rhAlt },
                gnd: { T_K: tGnd + 273.15, RH: rhGnd },
                level
            };
        }
    } catch { /* fall back to ISA */ }
    return { elevation, live, windMax_kmph };
}

// ── Shape diagram (to-scale SVG, updated every calculation) ──
// Teardrop fin geometry follows the reference parameter set:
//   Sfin/Senv = 0.2 (3 fins) · AR = 3b²/Sfin = 0.8 · b/Cr = 0.68
//   Ct/Cr = 0.7083 · Lfin/Lenv = 0.8
const FIN = { areaRatio: 0.2, AR: 0.8, count: 3, spanChord: 0.68, taper: 0.7083, loc: 0.8 };

function drawShape(geo, isOblate) {
    const W = 720;
    const dim = (x1, y1, x2, y2, label, labelPos) => `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b"
            stroke-width="1.2" marker-start="url(#arr)" marker-end="url(#arr)"/>
      <text x="${labelPos[0]}" y="${labelPos[1]}" fill="#334155" font-size="14"
            font-weight="600" text-anchor="middle">${label}</text>`;
    const ext = (x1, y1, x2, y2) =>
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#cbd5e1"
               stroke-width="1" stroke-dasharray="3 3"/>`;
    let body = '', dims = '', H, caption = '';

    if (isOblate) {
        const D = geo.D, Hh = geo.L, cx = W / 2;      // geo.L = height for oblate
        const s = Math.min((W - 180) / D, 210 / Hh);
        const rx = D * s / 2, ry = Hh * s / 2;
        const cy = 30 + ry;
        H = cy + ry + 84;
        body = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
                 fill="#e0f2fe" stroke="#0284c7" stroke-width="2"/>
                <line x1="${cx - rx}" y1="${cy}" x2="${cx + rx}" y2="${cy}"
                 stroke="#7dd3fc" stroke-width="1" stroke-dasharray="5 4"/>`;
        dims += ext(cx - rx, cy, cx - rx, cy + ry + 34) + ext(cx + rx, cy, cx + rx, cy + ry + 34);
        dims += dim(cx - rx, cy + ry + 28, cx + rx, cy + ry + 28,
            `Diameter = ${fmt(D, 1)} m`, [cx, cy + ry + 52]);
        dims += ext(cx, cy - ry, cx + rx + 40, cy - ry) + ext(cx, cy + ry, cx + rx + 40, cy + ry);
        dims += dim(cx + rx + 34, cy - ry, cx + rx + 34, cy + ry,
            `Height = ${fmt(geo.L, 1)} m`, [cx + rx + 34, cy - ry - 10]);
    } else {
        const L = geo.L, D = geo.D;
        // fin geometry in real metres (from the reference parameter table)
        const Sfin = FIN.areaRatio * geo.S;
        const b = Math.sqrt(FIN.AR * Sfin / FIN.count);
        const Cr = b / FIN.spanChord, Ct = FIN.taper * Cr;
        // Lfin/Lenv locates the CENTRE of the fin root chord at 0.8·L
        const xLE = FIN.loc * L - Cr / 2, xTE = FIN.loc * L + Cr / 2;
        const XI = 0.375, FMAX = Math.pow(XI, 0.6) * (1 - XI);
        const rReal = x => (x <= 0 || x >= L) ? 0 :
            (D / 2) * Math.pow(x / L, 0.6) * (1 - x / L) / FMAX;
        // fin root follows the hull contour from the leading edge; the chord
        // may overhang the stern (root continues just off the axis there)
        const yHullOr = x => Math.max(rReal(x), x > 0.98 * L ? 0.03 * D : 0);
        const finPts = [];
        for (let i = 0; i <= 14; i++) {            // root edge along the hull
            const x = xLE + (Math.min(xTE, L) - xLE) * (i / 14);
            finPts.push([x, yHullOr(x)]);
        }
        if (xTE > L) finPts.push([xTE, 0.03 * D]); // overhang past the stern
        const yRootTE = finPts[finPts.length - 1][1];
        finPts.push([xTE, yRootTE + b]);           // tip trailing edge
        finPts.push([xTE - Ct,                     // tip leading edge (swept)
            rReal(Math.min(xTE - Ct, 0.97 * L)) + b]);
        const xmax = Math.max(L, xTE);
        const ymax = Math.max(D / 2, ...finPts.map(p => p[1]));
        const s = Math.min((W - 150) / xmax, 210 / (2 * ymax));
        const x0 = (W - xmax * s) / 2, cy = 30 + ymax * s;
        H = cy + ymax * s + 92;
        const X = x => x0 + x * s;

        let top = '', bot = '';
        for (let i = 0; i <= 60; i++) {
            const x = (i / 60) * L, y = rReal(x) * s;
            top += `${i ? 'L' : 'M'}${X(x).toFixed(1)},${(cy - y).toFixed(1)} `;
        }
        for (let i = 60; i >= 0; i--) {
            const x = (i / 60) * L, y = rReal(x) * s;
            bot += `L${X(x).toFixed(1)},${(cy + y).toFixed(1)} `;
        }
        const finPoly = sign => '<polygon points="' + finPts.map(p =>
            `${X(p[0]).toFixed(1)},${(cy + sign * p[1] * s).toFixed(1)}`).join(' ') +
            '" fill="#bae6fd" stroke="#0284c7" stroke-width="1.5" stroke-linejoin="round"/>';
        body = finPoly(-1) + finPoly(1) +
            `<path d="${top}${bot}Z" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"/>
             <line x1="${X(0)}" y1="${cy}" x2="${X(L)}" y2="${cy}"
              stroke="#7dd3fc" stroke-width="1" stroke-dasharray="5 4"/>`;
        // dimensions: length below, max diameter at its station, fin span
        const yBot = cy + ymax * s + 22;
        dims += ext(X(0), cy, X(0), yBot + 8) + ext(X(L), cy, X(L), yBot + 8);
        dims += dim(X(0), yBot + 2, X(L), yBot + 2,
            `Length = ${fmt(L, 1)} m`, [(X(0) + X(L)) / 2, yBot + 24]);
        const xm = X(XI * L);
        dims += dim(xm, cy - (D / 2) * s, xm, cy + (D / 2) * s,
            `Ø ${fmt(D, 1)} m`, [xm, cy - (D / 2) * s - 10]);
        caption = `<text x="${W / 2}" y="${H - 8}" fill="#64748b" font-size="12"
            text-anchor="middle">Tail: ${FIN.count} fins (2 shown) — Sfin/Senv ${FIN.areaRatio},
            AR ${FIN.AR}, b/Cr ${FIN.spanChord}, Ct/Cr ${FIN.taper}, centred at ${FIN.loc}·L —
            span b = ${fmt(b, 1)} m, root chord = ${fmt(Cr, 1)} m</text>`;
    }

    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
        role="img" aria-label="Hull shape diagram">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5"
        markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>
      ${body}${dims}${caption}</svg>`;
}

// ── Main ─────────────────────────────────────────────────────
async function run() {
    clearMessages();
    const origText = calculateBtn.textContent;
    calculateBtn.textContent = 'Fetching & Calculating…';
    calculateBtn.disabled = true;
    resultsCard.classList.add('hidden');

    try {
        const cityName = cityInput.value.trim();
        const AGL = parseFloat(altitudeInput.value);
        const payload_kg = parseFloat(payloadInput.value);
        const endurance_days = parseFloat(enduranceInput.value);
        const power_kW = parseFloat(powerInput.value) || 0;
        const heliumPrice = parseFloat(heliumPriceInput.value);
        const mode = atmosphereMode.value;
        const isManualWind = windMode.value === 'manual';

        if (!cityName) throw new Error('Please enter a city / location.');
        if (isNaN(AGL) || AGL < 50 || AGL > 7000)
            throw new Error('Enter an altitude above ground between 50 and 7,000 m.');
        if (isNaN(payload_kg) || payload_kg <= 0)
            throw new Error('Enter a valid payload weight (kg).');
        let wind_kmh = NaN;
        if (isManualWind) {
            wind_kmh = parseFloat(windInput.value);
            if (isNaN(wind_kmh) || wind_kmh < 0 || wind_kmh > 200)
                throw new Error('Enter a wind speed between 0 and 200 kmph.');
        }
        if (isNaN(endurance_days) || endurance_days < 1 || endurance_days > 90)
            throw new Error('Enter an endurance between 1 and 90 days.');
        if (isNaN(heliumPrice) || heliumPrice < 0)
            throw new Error('Enter a valid helium price (₹/m³).');

        const loc = await geocode(cityName);
        let site = await fetchSiteData(loc.lat, loc.lon, AGL + 200);
        const elevation = site.elevation;
        const totalAlt = elevation + AGL;
        // high-elevation sites (e.g. Leh): redo weather at the right pressure level
        if (site.live &&
            nearestPressureLevel(S.isaPressure(totalAlt) / 100) !== site.live.level) {
            site = await fetchSiteData(loc.lat, loc.lon, totalAlt);
        }
        $('resultHeader').textContent = `Results — ${loc.name}, ${loc.country}`;

        // ── design wind: API (today's max at site) or manual ──
        let windSrc;
        if (isManualWind) {
            windSrc = 'manual';
        } else {
            if (site.windMax_kmph == null)
                throw new Error('Wind data unavailable from the weather API — ' +
                    'switch Design Wind Speed to "Manual entry".');
            wind_kmh = Math.round(site.windMax_kmph * 10) / 10;
            windSrc = "API — today's max at site";
        }

        // ── hull shape from wind / payload / power rules ──
        const sel = S.selectShape({ wind_kmh, payload_kg, power_kW });
        const isOblate = sel.shape === 'oblate';

        // ── atmosphere by mode ──
        let airGnd, airAlt, sourceNote;
        if (mode === 'live' && site.live) {
            airGnd = S.airState(elevation, site.live.gnd);
            airAlt = S.airState(totalAlt, site.live.alt);
            sourceNote = `Atmosphere: live Open-Meteo data (${site.live.level} hPa level) — ` +
                `${loc.name}. Results vary with today's weather.`;
        } else if (mode === 'hot') {
            airGnd = S.airState(elevation, { dT: 15, RH: 60 });
            airAlt = S.airState(totalAlt, { dT: 15, RH: 60 });
            sourceNote = 'Atmosphere: hot-day design conditions (ISA +15°C, 60% RH).';
        } else {
            airGnd = S.airState(elevation);
            airAlt = S.airState(totalAlt);
            sourceNote = 'Atmosphere: ISA standard.' +
                (mode === 'live' ? ' Live weather unavailable — fell back to ISA.' : '');
        }

        if (totalAlt > 5500)
            showWarn('Design altitude above ~5,500 m MSL is outside the calibration ' +
                'range; treat results as extrapolation.');
        if (isOblate && AGL > 500)
            showWarn('Oblate spheroid selected by the mission rules, but above ~500 m AGL ' +
                'a ballonet-equipped teardrop is the usual engineering choice — ' +
                'consider the teardrop result too.');

        // ── solve ──
        const mission = { AGL, alt_m: totalAlt, payload_kg, endurance_days,
            power_kW, shape: sel.shape };
        const sol = S.solve(airAlt, airGnd, mission);
        if (!sol.ok) throw new Error(sol.reason);
        const r = sol.result, geo = r.geo;

        if (!r.strengthOk)
            showWarn('Note: at this size the anchored tether rule leaves less ' +
                'strengthening material than the required break load implies — ' +
                'verify the tether specification separately.');

        // ── site & atmosphere ──
        $('resElevation').textContent = fmt(elevation, 0);
        $('resDesignAlt').textContent = fmt(totalAlt, 0);
        $('resAtmos').textContent =
            `${(airAlt.T - 273.15).toFixed(1)}°C / ${(airAlt.P / 100).toFixed(0)} hPa`;
        $('resUnitLift').textContent = fmt(r.u, 3);
        $('resDesignWind').textContent = fmt(wind_kmh, 1);
        $('resDesignWindSrc').textContent = `kmph (${windSrc})`;

        // ── envelope ──
        $('resShape').textContent = isOblate ? 'Oblate Spheroid' : 'Teardrop';
        $('resShapeReason').textContent = sel.reasons.join('; ');
        $('resVolume').textContent = fmt(geo.V, 0);
        $('resDimensionLabel').textContent = isOblate ? 'Height' : 'Length';
        $('resLength').textContent = fmt(geo.L, 1);
        $('resFineness').textContent = isOblate
            ? 'm (height = 0.6 × diameter)'
            : `m — fineness L/D ${geo.LD.toFixed(2)}`;
        $('resDiameter').textContent = fmt(geo.D, 1);
        $('resSurface').textContent = fmt(geo.S, 0);
        $('resGsm').textContent = fmt(r.gsm, 0);
        $('resGsmUnit').textContent = r.gsm_cold
            ? 'gsm (incl. +10 sub-zero coating)' : 'gsm laminate class';
        if (isOblate) {
            $('resBallonetVol').textContent = 'None';
            $('resBallonetPct').textContent = 'no ballonet — launched partially full';
        } else {
            $('resBallonetVol').textContent = fmt(r.Vb, 0);
            $('resBallonetPct').textContent =
                `m³ (${(100 * r.Vb / geo.V).toFixed(0)}% of hull at ground)`;
        }

        // ── shape diagram (updates every calculation) ──
        $('shapeDiagram').innerHTML = drawShape(geo, isOblate);

        // ── mass budget table ──
        const rows = [
            ['Gross static lift', r.GL, ''],
            ['− Envelope (fabric, seams, doublers)', -r.m_env, ''],
            [isOblate ? '− Passive Aerodynamic Control Surface' : '− Fins & empennage',
                -r.m_fin, ''],
            ...(isOblate ? [] : [['− Ballonet', -r.m_ball, '']]),
            ['− Suspension, nose & rigging', -r.m_susp, ''],
            ['− Airborne systems (blower, valves, lights)', -r.m_sys, ''],
            ['− Tether (airborne weight)', -r.m_teth, `${fmt(r.L_teth, 0)} m`],
            ['− Free lift margin', -r.FL,
                `min ${fmt(r.FL_min, 1)} kg + He make-up ${fmt(r.FL_makeup, 1)} kg`],
            ['= Payload capacity', r.payload, 'target met']
        ];
        $('massTable').innerHTML =
            '<tr><th>Item</th><th>kg</th><th>note</th></tr>' +
            rows.map(([label, kg, note], i) =>
                `<tr${i === rows.length - 1 ? ' class="total"' : ''}>` +
                `<td>${label}</td><td>${fmt(Math.abs(kg), 1)}</td><td>${note}</td></tr>`
            ).join('');

        // ── tether ──
        $('resTetherLen').textContent = fmt(r.L_teth, 0);
        $('resTetherGpm').textContent = fmt(r.gpm, 0);
        $('resTetherSplit').textContent =
            `g/m = ${fmt(r.gpm_strength, 0)} strengthening + ${fmt(r.gpm_cond, 0)} conductors`;
        $('resTension').textContent = fmt(r.T_design_kN, 1);
        $('resMBL').textContent = fmt(r.MBL_kN, 1);

        // ── helium & cost ──
        const he = S.helium(geo.V, r.sigma, r.leak_m3day, endurance_days, heliumPrice);
        $('resInitialVol').textContent = fmt(he.fill_m3, 0);
        $('resFillPct').textContent =
            `m³ at ground (${(100 * r.sigma).toFixed(0)}% of hull)`;
        $('resInitialCost').textContent = fmtCost(he.fill_cost);
        $('resLeakRate').textContent = fmt(r.leak_m3day, 1);
        $('resTopupVol').textContent = fmt(he.topup_m3, 1);
        $('resTopupCost').textContent = fmtCost(he.topup_cost);

        $('resDataSource').textContent = sourceNote;
        resultsCard.classList.remove('hidden');

    } catch (err) {
        showError(err.message);
        console.error(err);
    } finally {
        calculateBtn.textContent = origText;
        calculateBtn.disabled = false;
    }
}

function resetForm() {
    cityInput.value = 'Mumbai';
    altitudeInput.value = '';
    payloadInput.value = '';
    windInput.value = '';
    windMode.value = 'auto';
    windManualGroup.classList.add('hidden');
    enduranceInput.value = '';
    powerInput.value = '1';
    heliumPriceInput.value = '2400';
    atmosphereMode.value = 'isa';
    resultsCard.classList.add('hidden');
    clearMessages();
    $('resultHeader').textContent = 'Results';
}
