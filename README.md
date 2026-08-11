# Aerostat Sizing Calculator

A static web tool (plain HTML/JS, GitHub-Pages ready) that sizes a helium tethered
aerostat from **city, altitude above ground, payload weight, design wind, endurance
and payload power**. The physics engine is calibrated against published data of
operational tethered-aerostat systems from the tactical (~100 m³) to the strategic
(~60,000 m³) class, and reproduces their published hull dimensions to within a
few percent (RMS ≈ 4.8% on hull length across the nine-model reference family —
see docs/Aerostat_Sizing_Test_Report.docx for the full comparison).

**Open `index.html` to use it.** Everything runs in the browser; the only network
calls are a city lookup (OpenStreetMap) and elevation/weather (Open-Meteo).

---

## How to operate the calculator (step by step)

1. **Open `index.html`** (double-click it, or serve the folder with any static
   server, or use the GitHub Pages URL once published).
2. **City / Location** — type any city or place name (e.g. `Mumbai`, `Leh`,
   `New Delhi`). This sets the ground elevation of the launch site via
   OpenStreetMap + Open-Meteo. In *Live* mode it also fetches today's weather
   there. An internet connection is needed for this lookup.
3. **Altitude Above Ground (m)** — how high above the launch site the aerostat
   must fly (50–7,000 m). This is AGL; the tool adds the city's elevation
   internally to get the true design altitude.
4. **Payload Weight (kg)** — the sensor/antenna weight the aerostat must carry,
   *excluding* everything that is part of the aerostat itself (envelope, tether,
   power system — the tool computes those).
5. **Design Wind Speed** — choose *Automatic* (the tool takes today's maximum
   10 m wind at the site from the weather API) or *Manual entry*, which reveals
   a box to type the wind in kmph. Together with payload weight and power the
   wind decides the hull shape (see the rule below).
6. **Endurance (days)** — how many days it should stay up between helium
   top-ups (typically 7–30). Longer endurance adds free-lift margin, so the
   envelope grows slightly.
7. **Payload Power (kW)** — electrical power that must be delivered up the
   tether to the payload; it sizes the conductor weight in the tether and
   feeds the shape rule.
8. **Helium Price (₹/m³)** — your procurement price; used only for the cost
   outputs.
9. **Atmosphere** — pick the design condition:
   - *ISA standard*: textbook standard atmosphere. **Default.**
   - *Hot day (ISA+15 °C)*: conservative sizing for Indian summer — air is
     thinner, so the aerostat comes out ~5–10% bigger. Use this for real
     procurement decisions.
   - *Live API*: sizes for the weather at the chosen city right now (falls
     back to ISA automatically if the weather service is unreachable).
10. **Press "Size the Aerostat"** and read the results top to bottom:
    - *Site & Atmosphere* — the conditions the sizing used, and the net lift
      per m³ of helium at altitude (sanity check: ~0.9–1.0 near sea level,
      falling with altitude).
    - *Envelope* — the selected hull **shape** (with the reason), hull volume,
      length (or height for the oblate spheroid), diameter, surface area, the
      fabric weight class, and the ballonet size (teardrop only).
    - *Mass & Lift Budget* — where every kilogram of lift goes. The bottom
      line equals your requested payload.
    - *Tether* — required length, weight per metre, working tension and the
      minimum breaking load to specify when buying the tether.
    - *Helium & Cost* — the initial fill, daily leak rate, and the top-up
      volume/cost over the endurance period.
    - *Shape Diagram* — at the end of the page, a to-scale drawing of the
      selected hull, redrawn on every calculation with its dimensions
      annotated (length + diameter for the teardrop, diameter + height for
      the oblate spheroid). Teardrop fins follow the reference parameter set
      Sfin/Senv = 0.2, AR = 0.8, b/Cr = 0.68, Ct/Cr = 0.7083, with the fin's centre at 0.8·L.

## Hull shape selection rule

The tool builds either of two envelope shapes, chosen automatically from the
mission inputs:

```
oblate spheroid  ⇐  wind ≤ 30 kmph  AND  payload ≤ 20 kg  AND  power ≤ 2 kW
teardrop         ⇐  any one of the three above its limit
```

- **Oblate spheroid** (height = 0.6 × diameter): simple, cheap, quick to launch;
  used for small, low-power payloads at benign sites. No ballonet — it is
  launched partially full and the helium expands to fill it at altitude. No
  full empennage; only a light Passive Aerodynamic Control Surface.
- **Teardrop** (streamlined body of revolution with fins and ballonet):
  aerodynamically stable and much lower drag — required in wind, for heavier
  payloads, and for higher power (heavier tether needs the extra lift
  efficiency).

The result card always shows *which* rule fired, e.g. `wind 45 kmph > 30 kmph`.
If the oblate shape is selected but the altitude is above ~500 m AGL, the tool
shows a caution — at that height a ballonet-equipped teardrop is the usual
engineering choice even for small payloads.

### Typical questions

- *"It says requirements exceed the model range"* — the payload/altitude/
  endurance combination needs more than 300,000 m³ of helium (bigger than
  anything ever built). Reduce altitude or payload.
- *"City not found / service unavailable"* — the geocoding or weather service
  is briefly down or rate-limiting; wait a few seconds and retry. ISA results
  don't depend on the weather service (only the elevation lookup).
- *"Why is my aerostat bigger than a datasheet system with the same payload?"*
  — check the atmosphere mode (hot-day adds size), your site elevation (high
  cities like Leh cost a lot of lift), and payload power (heavy conductors).
- *Adjusting the model* — all calibration constants live in one commented
  block (`CAL`) at the top of `sizing.js`, and the shape thresholds in
  `SHAPE_LIMITS` next to it. After any change, run `node test/validate.mjs`;
  it fails loudly if accuracy against the reference systems regresses.

---

## How the model works

```
atmosphere (ISA / hot-day / live Open-Meteo)
  → air & gas densities at design altitude (99.99% He purity, humidity-corrected air)
  → unit lift u = ρ_air − ρ_gas          [kg per m³ of gas]
  → gross lift GL = u × V                 (ballonet empty at design altitude)
  → mass budget:
      envelope  = gsm(h) × S × 1.824
                  gsm(h): 120 gsm @ 100 m → 350 gsm @ 4,000 m design altitude,
                  linear (extrapolated above 4,000 m, floor 120), +10 gsm
                  anti-fragility coating when T(altitude) < 0 °C
      fins      = (0.252 − 0.065·log₁₀(V/100)) × envelope   (×0.5 for the oblate's
                  Passive Aerodynamic Control Surface)
      ballonet  = 120 g/m² × 6.3 × Vb^⅔ ;  Vb = (1 − σ)·V   (teardrop only)
                  σ = P_alt·T_gnd / (P_gnd·T_alt)  = ground fill fraction
      suspension= 7% × (envelope + fins)
      systems   = 8 kg + 10% × GL
      tether    = 1.22·AGL × (53.57 + 23.21·kW) g/m
                  — anchored rule: 2 kW → 100 g/m, 30 kW → 750 g/m, linear
                  through both; conductors take 12 + 2.2·kW g/m and the
                  strengthening member takes the remainder. The required
                  break load (3.0 × 1.15 × gross lift) is still reported as
                  a spec, and the tool warns if the strengthening share
                  cannot physically meet it.
      free lift = 14% × GL + endurance × 4 L/m²/day × S × u   (He make-up)
  → payload(V) = GL − Σ masses − free lift
  → bisection on V until payload(V) = requested payload
```

Teardrop geometry: streamlined body of revolution, prismatic coefficient 0.52,
wetted area 0.67·πDL, fineness L/D = 2.18 / 2.51 / 2.90 for tactical (≤600 m³) /
operational (≤3 000 m³) / strategic hulls. Oblate geometry: V = 0.314·D³,
S = 2.347·D², height 0.6·D. After every calculation the result card draws a
to-scale diagram of the selected hull with its length, diameter and height
dimensions annotated.

The calibrated coefficients (fabric-weight curve, construction factor, fin curve,
systems fraction, free-lift floor, fineness classes — the tether follows the
fixed power-anchored rule and is not fitted)
were fitted so that solving the published missions of nine operational aerostat
systems reproduces their published hull dimensions, while predicting payload
within ±10% for the systems whose hull volumes are public. The reference dataset
with sources sits in `data/reference.js`; `node test/validate.mjs` re-runs the
whole comparison and exits non-zero if accuracy regresses. Everything else is
physics or published engineering values (ISA, gas constants, Magnus saturation
pressure, 2.5 L/m²/day helium permeation, safety factor 3 tethers).

### Corrections vs the original `sizing_site`

1. Gross lift now uses the **full hull volume at design altitude** (ballonet
   empty) instead of the ground-fill helium volume × altitude density — the old
   formula under-predicted lift by ~3% at 300 m up to ~37% at 4,600 m.
2. Helium purity 97% (was 100%).
3. Fin/empennage mass added (was missing entirely).
4. Ballonet area formula restored its surface shape coefficient.
5. Tether sized by tension + power conductors (was altitude-tier guesswork).
6. Systems mass = floor + fraction of gross lift (was 20% of fabric+tether).
7. Payload + altitude now drive the size; endurance adds a helium make-up
   margin (was endurance-only sizing).
8. Consistent hull geometry constants; oblate spheroid restored with an
   explicit wind/payload/power selection rule (was diameter/altitude based).
9. API fixes: robust hour indexing (`findIndex` −1 bug), `timezone=auto`,
   elevation taken from Open-Meteo (dropped the CORS-flaky open-elevation);
   wind can be fetched automatically (today's max at the site) or entered
   manually.
10. Design-condition sizing (ISA / hot-day) instead of sizing to whatever the
    weather is right now; live mode remains available.

## Repo layout

```
index.html          calculator UI
docs/               test & validation report (.docx)
app.js              UI glue + API calls (no physics)
sizing.js           the sizing engine (browser + Node, zero deps)
data/reference.js   published reference systems + sources (used by tests)
test/validate.mjs   accuracy harness (CI-friendly, exits 1 on regression)
styles.css
```

## Run / develop

Open `index.html` in a browser (or any static server). Tests:

```bash
node test/validate.mjs
```

To put this on GitHub (new repo, e.g. `aerostat-sizing`):

```bash
cd aerostat-sizing
git remote add origin https://github.com/<your-username>/aerostat-sizing.git
git push -u origin main
```

Then publish on GitHub Pages: repo → Settings → Pages → deploy from branch →
`main` / root.

## Limitations (honest ones)

- Wind speed selects the hull shape but wind *loads* are not computed; blow-by
  and tether catenary under wind are approximated by the 1.22 length factor,
  and the wind ratings shown are class-typical published values.
- The power-anchored tether rule intentionally decouples tether mass from
  tether tension. For long-tether, low-power systems the strengthening share
  can fall below what the required break load implies (the tool warns when it
  does), and the known-volume payload cross-checks in `test/validate.mjs` are
  informational only for this reason — the gated accuracy target is the
  reference family's hull dimensions (RMS ≈ 4%).
- Calibration data are manufacturer datasheet values — themselves conservative
  and rounded; ±10% is the realistic floor of what public data supports.
- Above ~5,500 m design altitude (or below ~50 m³) you are extrapolating.
- The oblate-spheroid branch reuses the calibrated fabric/system weights of the
  streamlined family with a reduced fin allowance; small-craft data scatter is
  large (±30–50% between real products of the same size).
- Costs cover helium only (fill + top-up), not envelope/tether/ground equipment.
