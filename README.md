<div align="center">

```
  ◎ EXI TECHNOLOGIES
```

# AirFlow Integrity Monitor

**Real-time distributed fiber optic sensing for data center hot/cold aisle containment.**

[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](./LICENSE)

**Sub-0.5m breach localization &nbsp;·&nbsp; 8-second detection &nbsp;·&nbsp; Zero IT footprint**

</div>

---

## What This Is

Most data centers lose **15–30% of cooling capacity** to hot/cold aisle containment failures — gaps in curtains, failed door seals, missing blanking panels. Traditional DCIM sensors can tell you a rack is running hot. They can't tell you *which six inches of curtain* caused it.

EXI's AirFlow Integrity Monitor runs a single strand of distributed fiber optic sensing cable along the containment boundary. The fiber *is* the sensor — 120 measurement points per zone, updating at 10 Hz, with spatial resolution under 0.5 meters.

This repository is the full interactive product demo.

---

## Demo

Click any of the breach buttons in the demo controls to simulate a containment failure. Watch the system detect, localize, and quantify the breach in real time across five targeted views.

```
⚡ Zone A — Door Seal        Gasket failure at containment door
⚡ Zone B — Curtain Seam     Strip curtain seam separation
⚡ Zone C — Top Panel        Blanking panel misalignment at top
⚡ Zone D — End Cap          End-of-row cap missing or damaged
✓ Clear All                  Resolve all active breaches
```

Breaches self-expire after 55–80 seconds to simulate repair.

---

## Five Views. Five Audiences.

The demo is structured so every stakeholder walks away with what they need.

### ◈ Overview — *Executive / CTO*
The 30-second view. BARI score, live energy waste in dollars per hour, ASHRAE thermal compliance status, and integration health across DCIM, BMS, PagerDuty, and Modbus. No technical background required.

### ⬡ 3D View — *Facilities / Operations*
Isometric spatial rendering of the containment zone. Thermal color map overlaid on the fiber run. Breach plumes rendered at the exact detection point. Airflow vectors show cold aisle / hot aisle separation in real time.

### ◎ Engineering — *Data Center Engineer*
Full 120-point distributed fiber temperature profile. Zone heatmap with ΔT overlay from baseline. Four differential pressure sensors with real-time bypass modeling. Scrollable alert log with acknowledge workflow. Detection algorithm specs on sidebar.

### ✦ Commissioning — *CX / Solutions Engineer*
Guided 7-step validation wizard from pre-check through certificate generation. Steps automatically advance through fiber continuity verification, breach detection test (induces live breach at step 3), localization accuracy test, and false positive validation. Outputs a signed digital commissioning certificate.

### ◇ ROI & Savings — *CFO / Procurement*
Adjustable sliders for IT load (500–20,000 kW) and energy rate ($0.04–$0.18/kWh). Real-time calculation of annual savings, payback period, CO₂ avoided, and subscription cost. Competitive positioning against DCIM point sensors, manual inspection, and CFD modeling.

---

## Guided Demo Flow

The demo walks itself. After inducing a breach:

1. A **contextual hint bar** appears and suggests the logical next view
2. Each view updates live — no manual refresh, no page transitions
3. The guided path is: **Detect → Visualize → Quantify → Validate**

```
Overview (breach detected)
    └─► 3D View (breach localized spatially)
            └─► ROI Calculator (cost of this breach annualized)
                    └─► Commissioning Wizard (ready to certify)
```

---

## Architecture

### Simulation Engine

The demo runs a physics-inspired simulation with no backend. All data is generated client-side and updates every 500ms.

```
Breach induced
    │
    ├─ Thermal model: Gaussian heat plume propagates along fiber array
    │      ΔT = intensity × exp(-0.5 × (distance / σ)²)
    │
    ├─ Pressure model: DP sensors drop proportional to bypass proximity
    │      ΔP_drop = max(0, 1 - dist/(N/3)) × (intensity/14) × 9
    │
    └─ Alert engine: Z-score detection on 30-second rolling window
           threshold = σ × 2.5, sustained for 15 seconds
```

### BARI Score

The Bypass Airflow Risk Index is a 0–100 composite score:

```
BARI = 0.50 × Thermal Score
     + 0.30 × Differential Pressure Score
     + 0.20 × Rack Inlet Score
```

| Score | Status | Action |
|-------|--------|--------|
| 0–29 | `ALL CLEAR` | Containment nominal |
| 30–54 | `ELEVATED` | Inspect within 24 hours |
| 55–79 | `HIGH RISK` | Dispatch now |
| 80–100 | `CRITICAL` | Immediate response required |

### Tech Stack

The entire demo is a single React component. No chart libraries. No CSS frameworks. No backend.

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | React 18 | Hooks-based, zero class components |
| Build | Vite 5 | Sub-second HMR, simple config |
| Visualization | Pure SVG | Full control, no bundle weight |
| Styling | Inline styles | Zero flash, scoped, portable |
| Fonts | Google Fonts | Syne · IBM Plex Mono · Inter |
| State | React hooks only | No Redux, no Zustand, no context |

---

## Sensor Specs

| Parameter | Value |
|-----------|-------|
| Fiber type | SMF-28e · ITU-T G.652.D |
| Interrogator | Luna ODiSI-6104 |
| Sensor count | 120 per containment zone |
| Sensor pitch | ~6 cm |
| Spatial resolution | < 0.5 m |
| Temperature accuracy | ±0.18°C (inferred air) |
| Detection latency | 8.2 s (measured) |
| Localization accuracy | ±11 cm (measured) |
| Update rate | 10 Hz |
| ASHRAE compliance | TC 9.9 Class A1 |
| Certifications | NFPA 75, UL 2043, ISO 14001 |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Run Locally

```bash
git clone https://github.com/Tarrucks/exi-airflow-demo.git
cd exi-airflow-demo
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Build

```bash
npm run build
# Static output in /dist — deploy anywhere
```

### Deploy to Vercel

```bash
npx vercel
```

Or import the GitHub repo directly at [vercel.com](https://vercel.com) for auto-deploy on push.

---

## Project Structure

```
exi-airflow-demo/
├── public/
│   └── favicon.svg        # EXI target-reticle icon (SVG)
├── src/
│   ├── App.jsx            # Entire demo — single component, ~1,400 lines
│   └── main.jsx           # React DOM entry point
├── index.html
├── vite.config.js
├── package.json
└── .gitignore
```

---

## Customization

To adapt the demo for a specific customer site, edit the constants at the top of `src/App.jsx`:

```js
const N_SENSORS   = 120;      // Fiber measurement points per zone
const N_RACKS     = 8;        // Rack count in containment zone
const T_BASE      = 19.2;     // Baseline cold aisle supply temp (°C)
const DP_BASE     = 28.4;     // Baseline differential pressure (Pa)
const CO2_FACTOR  = 0.000410; // kg CO₂ per kWh (US avg — update by region)
const ENERGY_RATE = 0.078;    // $/kWh — update for customer utility rate
```

The ROI sliders in the demo UI let prospects adjust IT load and energy rate live without touching code.

---

## Why EXI Wins

**vs. DCIM point sensors** — 4 to 12 sensors per row can tell you a rack is hot. They cannot tell you which six inches of curtain caused it. EXI can, to within 11 cm.

**vs. Manual inspection** — 8-second automated detection versus minutes-to-never for a human to notice, report, and walk the floor. EXI catches breaches before GPU throttle, not after the SLA call.

**vs. CFD digital twins** — CFD models capture design-intent behavior under ideal conditions. EXI measures actual structural reality as it changes — seals degrade, panels shift, doors get propped open.

---

## Contact

**EXI Technologies**

For pilot inquiries, technical questions, or to schedule a live demo with real interrogator data, contact your EXI account team.

---

<div align="center">

*Built with distributed fiber optic sensing and a deep belief that data center operators deserve better than a blinking red light.*

</div>
