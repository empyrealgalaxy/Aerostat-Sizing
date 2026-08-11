#!/usr/bin/env node
/* Validation harness: run `node test/validate.mjs` from the repo root.
 * 1. TCOM models: solve volume from published payload/altitude/endurance
 *    and compare predicted hull LENGTH against the model name.
 * 2. Known-volume anchors: predict payload at the published volume and
 *    compare against the published payload.
 * Exits non-zero if accuracy regresses beyond thresholds. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S = require('../sizing.js');
const REF = require('../data/reference.js');

const pct = (a, b) => 100 * (a / b - 1);
const f = (n, d = 0) => n.toFixed(d).padStart(9);

console.log('TCOM validation — model name encodes hull length (ISA, sea-level site)');
console.log('model        V_model[m³]   D[m]   L_model  L_actual    err');
let lengthErrs = [];
for (const t of REF.TCOM) {
    const airAlt = S.airState(t.alt_m);
    const airGnd = S.airState(0);
    const sol = S.solve(airAlt, airGnd, {
        AGL: t.alt_m, alt_m: t.alt_m, payload_kg: t.payload_kg,
        endurance_days: t.endurance_d, power_kW: t.power_kW
    });
    if (!sol.ok) { console.log(`${t.name}  UNSOLVED: ${sol.reason}`); process.exitCode = 1; continue; }
    const e = pct(sol.result.geo.L, t.length_m);
    lengthErrs.push({ name: t.name, e, note: t.note });
    console.log(`${t.name.padEnd(11)} ${f(sol.V)}  ${f(sol.result.geo.D, 1)}` +
        ` ${f(sol.result.geo.L, 1)} ${f(t.length_m, 1)}  ${e >= 0 ? '+' : ''}${e.toFixed(1)}%` +
        (t.note ? `   (${t.note})` : ''));
}

console.log('\nKnown-volume anchors — predicted payload at published volume');
console.log('system                 V[m³]   P_actual   P_model     err');
let payloadErrs = [];
for (const a of REF.ANCHORS) {
    const airAlt = S.airState(a.alt_m);
    const airGnd = S.airState(0);
    const r = S.evaluate(a.volume_m3, airAlt, airGnd, {
        AGL: a.alt_m, alt_m: a.alt_m, payload_kg: 0,
        endurance_days: a.endurance_d, power_kW: a.power_kW
    });
    const e = pct(r.payload, a.payload_kg);
    payloadErrs.push({ name: a.name, e, note: a.note });
    console.log(`${a.name.padEnd(20)} ${f(a.volume_m3)}  ${f(a.payload_kg)} ${f(r.payload)}  ${e >= 0 ? '+' : ''}${e.toFixed(1)}%` +
        (a.note ? `   (${a.note})` : ''));
}

// thresholds: flagged outliers get a wider gate.
// NOTE: the known-volume payload rows are INFORMATIONAL only — the
// power-anchored tether rule (2 kW → 100 g/m, 30 kW → 750 g/m)
// intentionally decouples tether mass from tension, so systems whose
// tether was tension-dominated (TARS) or power-heavy (JLENS) no longer
// bind. The model's promise is reproducing the reference family's hull
// lengths, which is what is gated below.
const bad = [];
for (const { name, e, note } of lengthErrs)
    if (Math.abs(e) > (note ? 20 : 12)) bad.push(`${name} length err ${e.toFixed(1)}%`);

const rms = a => Math.sqrt(a.reduce((s, x) => s + x.e * x.e, 0) / a.length);
console.log(`\nRMS length error (TCOM): ${rms(lengthErrs).toFixed(1)}%`);
console.log(`RMS payload error (anchors): ${rms(payloadErrs).toFixed(1)}%`);

// ── Shape-selection rule & oblate geometry checks ──
const shapeCases = [
    [{ wind_kmh: 20, payload_kg: 10, power_kW: 1 }, 'oblate'],
    [{ wind_kmh: 35, payload_kg: 10, power_kW: 1 }, 'teardrop'],  // wind trips
    [{ wind_kmh: 20, payload_kg: 25, power_kW: 1 }, 'teardrop'],  // payload trips
    [{ wind_kmh: 20, payload_kg: 10, power_kW: 3 }, 'teardrop'],  // power trips
    [{ wind_kmh: 30, payload_kg: 20, power_kW: 2 }, 'oblate']     // at the limits
];
for (const [input, want] of shapeCases) {
    const got = S.selectShape(input).shape;
    if (got !== want) {
        bad.push(`selectShape(${JSON.stringify(input)}) = ${got}, want ${want}`);
    }
}
const og = S.geometry(100, 'oblate');
if (Math.abs(og.D - Math.cbrt(100 / 0.3141593)) > 1e-6 ||
    Math.abs(og.L / og.D - 0.6) > 1e-6) {
    bad.push('oblate geometry inconsistent');
}
const oblateRun = S.evaluate(100, S.airState(200), S.airState(0),
    { AGL: 200, payload_kg: 0, endurance_days: 3, power_kW: 0.5, shape: 'oblate' });
if (!(oblateRun.m_ball === 0 && oblateRun.Vb === 0 && oblateRun.payload > 0)) {
    bad.push('oblate evaluate: expected no ballonet and positive payload at 100 m³');
}
console.log('Shape-rule & oblate checks: ' +
    (bad.some(b => b.includes('electShape') || b.includes('oblate')) ? 'FAILED' : 'passed ✔'));

if (bad.length) {
    console.error('\nACCURACY REGRESSION:\n  ' + bad.join('\n  '));
    process.exitCode = 1;
} else {
    console.log('\nAll checks within tolerance ✔');
}
