/* ============================================================
 * Reference aerostat systems — data/reference.js
 * Published figures used for calibration & validation.
 *
 * TCOM figures: tcomlp.com "Tethered Aerostats" product page +
 * model spec-sheet PDFs (payload / altitude / endurance / wind /
 * power). TCOM model names encode hull LENGTH in metres, which
 * is what the validation compares against.
 * Volumes marked est:true are estimates (TCOM does not publish
 * hull volume for current models).
 * ============================================================ */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AerostatReference = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // TCOM validation set — model name encodes hull length (m)
    const TCOM = [
        { name: 'TCOM 12M', length_m: 12, payload_kg: 27, alt_m: 305, endurance_d: 7, power_kW: 0.5, wind: '40/55 kt' },
        { name: 'TCOM 17M', length_m: 17, payload_kg: 145, alt_m: 610, endurance_d: 7, power_kW: 2.0, wind: '40/55 kt' },
        { name: 'TCOM 22M', length_m: 22, payload_kg: 202, alt_m: 900, endurance_d: 14, power_kW: 2.0, wind: '55/75 kt' },
        { name: 'TCOM 28M', length_m: 28, payload_kg: 385, alt_m: 1525, endurance_d: 14, power_kW: 5.0, wind: '55/75 kt' },
        { name: 'TCOM 34M', length_m: 34, payload_kg: 689, alt_m: 1525, endurance_d: 30, power_kW: 5.0, wind: '55/75 kt' },
        { name: 'TCOM 55M', length_m: 55, payload_kg: 907, alt_m: 2133, endurance_d: 30, power_kW: 23.5, wind: '70/90 kt', note: 'high-wind optimised — model runs ~15% short' },
        { name: 'TCOM 71M', length_m: 71, payload_kg: 2155, alt_m: 4570, endurance_d: 30, power_kW: 23.5, wind: '70/90 kt' },
        { name: 'TCOM 74M', length_m: 74, payload_kg: 3855, alt_m: 3000, endurance_d: 30, power_kW: 70, wind: '70/100 kt', volume_m3: 16700, volNote: 'JLENS 74K: 590,000 ft³' },
        { name: 'TCOM 117M', length_m: 117, payload_kg: 8164, alt_m: 4877, endurance_d: 60, power_kW: 130, wind: '80/90 kt' }
    ];

    // Known-volume anchors (independent manufacturers/programmes)
    const ANCHORS = [
        { name: 'ADASI Aerostat 200', volume_m3: 200, length_m: 14.2, dia_m: 5.8, payload_kg: 70, alt_m: 305, endurance_d: 5, power_kW: 0.5 },
        { name: 'ADASI Aerostat 400', volume_m3: 400, length_m: 19, payload_kg: 140, alt_m: 457, endurance_d: 5, power_kW: 0.5 },
        { name: 'TARS 275K (TCOM)', volume_m3: 7787, length_m: 56.7, dia_m: 19.05, payload_kg: 1000, alt_m: 3650, endurance_d: 14, power_kW: 5 },
        { name: 'LM 420K (TARS)', volume_m3: 11893, length_m: 63.6, dia_m: 21.2, payload_kg: 1000, alt_m: 4600, endurance_d: 14, power_kW: 6, note: 'payload likely derated' },
        { name: 'JLENS 74K (TCOM)', volume_m3: 16700, length_m: 74, payload_kg: 3855, alt_m: 3000, endurance_d: 30, power_kW: 70 }
    ];

    const SOURCES = [
        ['TCOM — Tethered Aerostats (payload/altitude/endurance/wind for all models)', 'https://tcomlp.com/aerospace-platforms/tethered-aerostats/'],
        ['TCOM 17M spec sheet (PDF)', 'https://tcomlp.com/wp-content/uploads/2023/04/TCOM-17M-aerostats-system-2023.pdf'],
        ['TCOM 71M spec sheet (PDF)', 'https://tcomlp.com/wp-content/uploads/2023/08/TCOM-71M-aerostat_2023_Final.pdf'],
        ['TARS aerostat dimensions & volumes (275K / 420K)', 'https://www.defenseindustrydaily.com/Time-for-TARS-Along-USAs-Southern-Borders-04973/'],
        ['JLENS 74K volume 590,000 ft³', 'https://en.wikipedia.org/wiki/JLENS'],
        ['ADASI tethered aerostats (volumes & payloads) — Lobner, Modern Airships', 'https://lynceans.org/wp-content/uploads/2023/06/ADASI-aerostats.pdf'],
        ['Aerostat class volumes & materials review (AJT 2018)', 'https://docsdrive.com/pdfs/ansinet/ajt/2018/1-12.pdf'],
        ['IIT Bombay / ADRDE envelope design papers (fabric 280–385 g/m², free lift 15%, leak 2.5 L/m²/day)', 'https://www.aero.iitb.ac.in/~airships/WEBPAGES/PDFs/ADRDE%20paper%20_%20final.pdf']
    ];

    return { TCOM, ANCHORS, SOURCES };
}));
