/* ============================================================
 * Aerostat Sizing Engine — sizing.js
 * ------------------------------------------------------------
 * Physics-correct tethered-aerostat sizing, calibrated against
 * published operational aerostat systems (tactical to strategic
 * classes; see data/reference.js for the dataset and sources).
 *
 * Model chain:
 *   atmosphere (ISA / hot-day / live) → unit lift at design
 *   altitude (ballonet empty, impure He) → streamlined hull
 *   geometry (GNVR-class streamlined family / oblate spheroid) → calibrated mass budget
 *   (envelope, fins, ballonet, suspension, systems, tether,
 *   free lift + endurance He make-up) → bisection solve for
 *   the envelope volume that carries the requested payload.
 *
 * Runs in the browser (window.AerostatSizing) and in Node
 * (module.exports) with zero dependencies.
 * ============================================================ */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AerostatSizing = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ── Physical constants ────────────────────────────────────
    const PHYS = {
        G: 9.80665,          // m/s²
        R_AIR: 287.05,       // J/(kg·K) dry air
        R_HE: 2077.1,        // J/(kg·K) helium
        R_VAP: 461.5,        // J/(kg·K) water vapour
        T0: 288.15,          // K   ISA sea level
        P0: 101325,          // Pa  ISA sea level
        LAPSE: 0.0065,       // K/m ISA troposphere
        M_AIR: 0.0289644     // kg/mol
    };
    // Barometric exponent g·M/(R*·L) = 5.2559
    const BARO_EXP = PHYS.G * PHYS.M_AIR / (8.31446 * PHYS.LAPSE);

    // ── Calibrated design coefficients ────────────────────────
    // Fitted (2026-08) so that solving the reference systems' published
    // missions reproduces their published hull dimensions,
    // while staying within ±10% payload on known-volume anchors
    // (ADASI 200/400, TARS 275K, JLENS 74M). See README + test/.
    const CAL = {
        purity: 0.9999,      // helium purity (mole fraction), 99.99% grade
        cp: 0.52,            // hull prismatic coefficient (GNVR family)
        sWet: 0.67,          // wetted area = sWet·π·D·L
        LD_tac: 2.175,       // fineness L/D, V ≤ 600 m³   (tactical)
        LD_op: 2.506,        // fineness,   600–3000 m³    (operational)
        LD_str: 2.90,        // fineness,   V > 3000 m³    (strategic)
        // Envelope fabric weight — altitude-anchored rule:
        // 120 gsm at 100 m design altitude → 350 gsm at 4,000 m, linear
        // (extrapolated above 4,000 m, floored at 120 below 100 m);
        // +10 gsm anti-fragility coating when T(altitude) < 0 °C.
        gsm_h0: 100, gsm_v0: 120,     // anchor 1: 100 m → 120 gsm
        gsm_h1: 4000, gsm_v1: 350,    // anchor 2: 4,000 m → 350 gsm
        gsm_cold_add: 10,             // sub-zero coating allowance
        k_constr: 1.824,     // seams, doublers, load patches, curtain
        fin_a: 0.2523,       // fin mass fraction of envelope at V = 100 m³
        fin_b: 0.06466,      // − per decade of volume
        fin_min: 0.10, fin_max: 0.60,
        susp_frac: 0.07,     // suspension/nose/rigging vs (envelope+fins)
        ballonet_gsm: 120,   // gsm light ballonet fabric
        ballonet_shape: 6.3, // area ≈ 6.3·Vb^(2/3) (lobed diaphragm)
        ballonet_margin: 1.05,
        sys_fix: 8.0,        // kg — blower, valves, lighting, avionics floor
        sys_frac: 0.10,      // + fraction of gross lift
        // Tether linear density — anchored rule through (2 kW, 100 g/m)
        // and (30 kW, 750 g/m): total = teth_a + teth_b × kW.
        // Conductors get the power share; the strengthening member takes
        // the remainder ("adjusted accordingly").
        teth_a: 53.5714286,  // g/m at 0 kW (from the two anchors)
        teth_b: 23.2142857,  // g/m per kW  (from the two anchors)
        teth_fix_gpm: 12,    // g/m jacket + fibre-optic floor (conductor side)
        teth_pow_gpm: 2.2,   // g/m per kW of copper conductors
        teth_sf: 3.0,        // safety factor for the REQUIRED break load spec
        teth_dyn: 1.15,      // gust/dynamic factor on static tension
        teth_fiber_eta: 1.5, // kN per g/m of bare high-modulus fibre (check)
        teth_len_f: 1.22,    // slant + catenary + winch reserve on AGL
        fl_min: 0.14,        // minimum free-lift fraction of gross lift
        leak: 0.004          // helium permeation, m³ per m² of hull per day
    };

    // ── Envelope fabric weight from design altitude ───────────
    /** gsm(h): linear through (100 m, 120 gsm) and (4,000 m, 350 gsm);
     *  +10 gsm when the air temperature at altitude is below 0 °C. */
    function fabricGsm(alt_m, T_K, cal = CAL) {
        let g = cal.gsm_v0 + (cal.gsm_v1 - cal.gsm_v0) *
            (alt_m - cal.gsm_h0) / (cal.gsm_h1 - cal.gsm_h0);
        g = Math.max(g, cal.gsm_v0);
        const cold = T_K < 273.15;
        if (cold) g += cal.gsm_cold_add;
        return { gsm: g, cold };
    }

    // ── Atmosphere ────────────────────────────────────────────
    // ISA pressure profile; temperature may be offset (hot day) or
    // overridden by live data. Humidity reduces air density.
    function isaPressure(h_m) {
        const T_std = PHYS.T0 - PHYS.LAPSE * h_m;
        return PHYS.P0 * Math.pow(T_std / PHYS.T0, BARO_EXP);
    }
    function isaTemp(h_m) { return PHYS.T0 - PHYS.LAPSE * h_m; }

    function magnusSVP_Pa(T_K) {          // saturation vapour pressure
        const Tc = T_K - 273.15;
        return 611.21 * Math.exp((17.502 * Tc) / (Tc + 240.97));
    }

    /**
     * Air state at geometric altitude.
     * @param h_m     altitude above MSL
     * @param opts    { dT: temperature offset K, T_K: override temp,
     *                  RH: relative humidity % }
     */
    function airState(h_m, opts = {}) {
        const P = isaPressure(h_m);
        let T = (opts.T_K != null) ? opts.T_K : isaTemp(h_m) + (opts.dT || 0);
        const RH = (opts.RH != null) ? opts.RH : 0;
        const e = Math.min((RH / 100) * magnusSVP_Pa(T), 0.99 * P);
        const rho = (P - e) / (PHYS.R_AIR * T) + e / (PHYS.R_VAP * T);
        return { P, T, RH, rho };
    }

    /**
     * Net aerostatic lift per m³ of lifting gas (kg/m³).
     * Impure helium: ρ_gas = purity·ρ_He + (1−purity)·ρ_air.
     * Gas assumed at ambient P and T (zero superheat/superpressure).
     */
    function unitLift(air, purity) {
        const rho_he = air.P / (PHYS.R_HE * air.T);
        const rho_gas = purity * rho_he + (1 - purity) * air.rho;
        return { u: air.rho - rho_gas, rho_he, rho_gas };
    }

    // ── Hull geometry ─────────────────────────────────────────
    // Teardrop: streamlined body of revolution (GNVR family).
    // Oblate:   oblate spheroid, height = 0.6·D (small low-wind
    //           aerostats without a ballonet).
    function fineness(V) {
        if (V <= 600) return CAL.LD_tac;
        if (V <= 3000) return CAL.LD_op;
        return CAL.LD_str;
    }
    function geometry(V, shape = 'teardrop') {
        if (shape === 'oblate') {
            // V = (4/3)π·(D/2)²·(0.3D) = 0.31416·D³ ; c/a = 0.6 → e = 0.8
            const D = Math.cbrt(V / 0.3141593);
            const H = 0.6 * D;
            // S = 2π·a²·(1 + ((1−e²)/e)·atanh(e)) = 2.3473·D²
            const S = 2.3473 * D * D;
            return { V, D, L: H, S, LD: 0.6, shape };
        }
        const LD = fineness(V);
        const D = Math.cbrt(V / (CAL.cp * Math.PI / 4 * LD));
        const L = LD * D;
        const S = CAL.sWet * Math.PI * D * L;
        return { V, D, L, S, LD, shape };
    }

    // ── Shape selection rule ──────────────────────────────────
    // Oblate spheroid only for benign, small missions: ALL of
    // wind ≤ 30 km/h, payload ≤ 20 kg, payload power ≤ 2 kW.
    // Any single criterion above its limit forces the streamlined
    // teardrop (aerodynamic stability and lower drag in wind).
    const SHAPE_LIMITS = { wind_kmh: 30, payload_kg: 20, power_kW: 2 };
    function selectShape({ wind_kmh, payload_kg, power_kW }) {
        const reasons = [];
        if (wind_kmh > SHAPE_LIMITS.wind_kmh)
            reasons.push(`wind ${wind_kmh} kmph > ${SHAPE_LIMITS.wind_kmh} kmph`);
        if (payload_kg > SHAPE_LIMITS.payload_kg)
            reasons.push(`payload ${payload_kg} kg > ${SHAPE_LIMITS.payload_kg} kg`);
        if (power_kW > SHAPE_LIMITS.power_kW)
            reasons.push(`payload power ${power_kW} kW > ${SHAPE_LIMITS.power_kW} kW`);
        if (reasons.length) return { shape: 'teardrop', reasons };
        return {
            shape: 'oblate',
            reasons: [`wind ≤ ${SHAPE_LIMITS.wind_kmh} kmph, payload ≤ ` +
                `${SHAPE_LIMITS.payload_kg} kg, power ≤ ${SHAPE_LIMITS.power_kW} kW`]
        };
    }

    // ── Mass budget & payload at a given volume ───────────────
    /**
     * @param V        envelope volume, m³
     * @param airAlt   air state at design altitude (ballonet empty here)
     * @param airGnd   air state at ground (launch site)
     * @param mission  { AGL, payload_kg, endurance_days, power_kW }
     * @param cal      coefficient set (default CAL)
     */
    function evaluate(V, airAlt, airGnd, mission, cal = CAL) {
        const shape = mission.shape || 'teardrop';
        const geo = geometry(V, shape);
        const { u } = unitLift(airAlt, cal.purity);
        const GL = u * V;                       // gross static lift, kg

        // envelope — altitude-anchored fabric weight rule
        // (design altitude from mission.alt_m, else inverted from pressure)
        const alt_m = (mission.alt_m != null) ? mission.alt_m :
            (1 - Math.pow(airAlt.P / PHYS.P0, 1 / BARO_EXP)) * PHYS.T0 / PHYS.LAPSE;
        const fabric = fabricGsm(alt_m, airAlt.T, cal);
        const gsm = fabric.gsm;
        const logdec = Math.log10(V) - 2.0;
        const m_env = (gsm / 1000) * geo.S * cal.k_constr;

        // fins (relatively larger on small hulls; oblate hulls carry only
        // a light stabiliser skirt instead of a full empennage)
        const fin_f = Math.min(Math.max(cal.fin_a - cal.fin_b * logdec,
            cal.fin_min), cal.fin_max);
        const m_fin = fin_f * m_env * (shape === 'oblate' ? 0.5 : 1.0);

        // ballonet — air volume equals helium expansion ground→altitude.
        // Oblate spheroid designs have no ballonet (launched partially
        // full; the envelope goes taut at design altitude).
        const sigma = (airAlt.P * airGnd.T) / (airGnd.P * airAlt.T);
        const Vb = shape === 'oblate' ? 0 :
            Math.max(0, (1 - sigma) * V) * cal.ballonet_margin;
        const m_ball = shape === 'oblate' ? 0 :
            (cal.ballonet_gsm / 1000) * cal.ballonet_shape * Math.pow(Vb, 2 / 3);

        const m_susp = cal.susp_frac * (m_env + m_fin);
        const m_sys = cal.sys_fix + cal.sys_frac * GL;

        // tether — total linear density from the power-anchored rule
        // (2 kW → 100 g/m, 30 kW → 750 g/m, linear through both);
        // conductors take the power share, strengthening member the rest.
        const T_design_kN = cal.teth_dyn * GL * PHYS.G / 1000;
        const MBL_kN = cal.teth_sf * T_design_kN;      // required spec
        const gpm = cal.teth_a + cal.teth_b * mission.power_kW;
        const gpm_cond = cal.teth_fix_gpm + cal.teth_pow_gpm * mission.power_kW;
        const gpm_strength = Math.max(0, gpm - gpm_cond);
        // sanity: can the strength share physically meet the required MBL
        // with bare high-modulus fibre?
        const strengthOk = gpm_strength >= MBL_kN / cal.teth_fiber_eta;
        const L_teth = cal.teth_len_f * mission.AGL;
        const m_teth = L_teth * gpm / 1000;

        // free lift: minimum margin + helium make-up over the
        // service interval (permeation loss ⇒ lift loss)
        const leak_m3day = cal.leak * geo.S;
        const FL_makeup = mission.endurance_days * leak_m3day * u;
        const FL = cal.fl_min * GL + FL_makeup;

        const m_empty = m_env + m_fin + m_ball + m_susp + m_sys + m_teth;
        const payload = GL - m_empty - FL;

        return {
            geo, u, GL, gsm, gsm_cold: fabric.cold, sigma,
            m_env, m_fin, m_ball, m_susp, m_sys, m_teth, m_empty,
            FL, FL_min: cal.fl_min * GL, FL_makeup,
            leak_m3day, Vb, L_teth, gpm, gpm_cond, gpm_strength, strengthOk,
            T_design_kN, MBL_kN,
            payload
        };
    }

    // ── Solver: volume that carries the requested payload ─────
    const V_MIN = 5, V_MAX = 300000;
    function solve(airAlt, airGnd, mission, cal = CAL) {
        // payload(V) is monotonically increasing over the practical range
        const pAtMax = evaluate(V_MAX, airAlt, airGnd, mission, cal).payload;
        if (pAtMax < mission.payload_kg) {
            return { ok: false, reason: 'Requirements exceed the model range (' +
                'payload/altitude/endurance need > 300,000 m³ of helium).' };
        }
        let lo = V_MIN, hi = V_MAX;
        for (let i = 0; i < 140; i++) {
            const mid = Math.sqrt(lo * hi);
            const p = evaluate(mid, airAlt, airGnd, mission, cal).payload;
            if (p < mission.payload_kg) lo = mid; else hi = mid;
        }
        const V = Math.sqrt(lo * hi);
        const r = evaluate(V, airAlt, airGnd, mission, cal);
        return { ok: true, V, result: r };
    }

    // ── Helium accounting ─────────────────────────────────────
    /**
     * Initial fill (m³ measured at ground conditions) = σ·V.
     * Daily top-up = permeation loss (≈ ambient m³ ≈ supply m³).
     */
    function helium(V, sigma, leak_m3day, endurance_days, price_per_m3) {
        const fill_m3 = sigma * V;
        const topup_m3 = leak_m3day * endurance_days;
        return {
            fill_m3, topup_m3,
            fill_cost: fill_m3 * price_per_m3,
            topup_cost: topup_m3 * price_per_m3
        };
    }

    // ── Wind-class guidance (typical published class ratings) ─
    function windClass(V) {
        if (V <= 600) return { op_kt: 40, surv_kt: 55 };
        if (V <= 3000) return { op_kt: 55, surv_kt: 75 };
        return { op_kt: 70, surv_kt: 90 };
    }

    return {
        PHYS, CAL, SHAPE_LIMITS, isaPressure, isaTemp, airState, unitLift,
        fineness, geometry, selectShape, fabricGsm, evaluate, solve, helium,
        windClass, V_MIN, V_MAX
    };
}));
