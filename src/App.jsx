import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const N_SENSORS  = 120;
const N_RACKS    = 8;
const T_BASE     = 19.2;
const DP_BASE    = 28.4;
const A1_LIMIT   = 27;
const CO2_FACTOR = 0.000410;   // kg CO₂ / kWh (US avg)
const ENERGY_RATE = 0.078;     // $/kWh

// ─── Thermal color scale ──────────────────────────────────────────────────────
const STOPS = [
  [0,    [20,  90, 220]],
  [0.20, [ 0, 180, 230]],
  [0.45, [20, 210, 110]],
  [0.65, [230,210,  20]],
  [0.82, [240,120,  20]],
  [1.00, [220,  25,  25]],
];
function tempToColor(t, lo = 14, hi = 40) {
  const v = Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i];
    const [t1, c1] = STOPS[i + 1];
    if (v >= t0 && v <= t1) {
      const f = (v - t0) / (t1 - t0);
      return `rgb(${Math.round(c0[0]+f*(c1[0]-c0[0]))},${Math.round(c0[1]+f*(c1[1]-c0[1]))},${Math.round(c0[2]+f*(c1[2]-c0[2]))})`;
    }
  }
  return "rgb(220,25,25)";
}

function ashraeClass(temp) {
  if (temp <= 27) return { cls: "A1", color: "#22d3a0", bg: "rgba(34,211,160,0.08)" };
  if (temp <= 35) return { cls: "A2", color: "#fbbf24", bg: "rgba(251,191,36,0.08)" };
  if (temp <= 40) return { cls: "A3", color: "#fb923c", bg: "rgba(251,146,60,0.08)" };
  return { cls: "A4", color: "#f87171", bg: "rgba(248,113,113,0.08)" };
}

// ─── Simulation helpers ───────────────────────────────────────────────────────
function makeBaseline() {
  return Array.from({ length: N_SENSORS }, (_, i) =>
    T_BASE + Math.sin(i / 10) * 0.8 + (Math.random() - 0.5) * 0.6
  );
}
function makeRackPower() {
  return Array.from({ length: N_RACKS }, () => 62 + Math.random() * 35);
}
function makeBaseDP() {
  return Array.from({ length: 4 }, () => DP_BASE + (Math.random() - 0.5) * 1);
}

// ─── Isometric projection ─────────────────────────────────────────────────────
const ISO_COS = Math.cos(Math.PI / 6);
const ISO_SIN = Math.sin(Math.PI / 6);
function isoProject(x, y, z) {
  return [(x - y) * ISO_COS, (x + y) * ISO_SIN - z];
}

// ─── BARI gauge (extracted to avoid IIFE in JSX) ─────────────────────────────
function BariGauge({ bari, bariColor, bariLabel, size = "lg" }) {
  const r    = size === "lg" ? 25 : 19;
  const cx   = size === "lg" ? 33 : 25;
  const cy   = size === "lg" ? 38 : 29;
  const sw   = size === "lg" ? 5   : 4.5;
  const W    = size === "lg" ? 66  : 50;
  const H    = size === "lg" ? 52  : 40;
  const fSz  = size === "lg" ? 13  : 11;
  const circ = 2 * Math.PI * r;
  const arc  = circ * 0.75;
  const fill = arc * bari;
  const bp   = Math.round(bari * 100);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0a1520" strokeWidth={sw}
        strokeDasharray={`${arc} ${circ - arc}`}
        strokeDashoffset={-(circ * 0.125)} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={bariColor} strokeWidth={sw}
        strokeDasharray={`${fill} ${circ - fill}`}
        strokeDashoffset={-(circ * 0.125)} strokeLinecap="round"
        style={{ transition: "all 0.5s", filter: `drop-shadow(0 0 3px ${bariColor})` }} />
      <text x={cx} y={cy - 3} textAnchor="middle" fill={bariColor}
        style={{ fontFamily: "'Syne',sans-serif", fontSize: `${fSz}px`, fontWeight: 700 }}>{bp}</text>
      <text x={cx} y={cy + (size === "lg" ? 9 : 8)} textAnchor="middle" fill="#1e3a52"
        style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "6.5px", letterSpacing: "1px" }}>BARI</text>
    </svg>
  );
}

// ─── 3D Isometric component ───────────────────────────────────────────────────
function IsoDataCenter({ breaches, temps, rackPowers }) {
  const W = 700, H = 330, OX = W / 2 - 20, OY = H / 2 + 72;
  const RW = 26, RD = 20, RH = 52;

  function pt(x, y, z) {
    const [sx, sy] = isoProject(x, y, z);
    return [OX + sx, OY + sy];
  }
  function pts(arr) { return arr.map(q => q.join(",")).join(" "); }

  // Floor grid
  const gridLines = [];
  for (let x = -75; x <= 310; x += 40) {
    const [x1, y1] = pt(x, -26, 0), [x2, y2] = pt(x, 68, 0);
    gridLines.push(<line key={`gx${x}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0a1520" strokeWidth="0.4" />);
  }
  for (let y = -26; y <= 68; y += 18) {
    const [x1, y1] = pt(-75, y, 0), [x2, y2] = pt(310, y, 0);
    gridLines.push(<line key={`gy${y}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0a1520" strokeWidth="0.4" />);
  }

  // Airflow arrows
  const arrowElems = Array.from({ length: 5 }, (_, i) => {
    const ax = -40 + i * 96;
    const [x1, y1] = pt(ax, -21, 26), [x2, y2] = pt(ax, 3, 26);
    return (
      <g key={`ar${i}`} opacity="0.28">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#60a5fa" strokeWidth="1.2" markerEnd="url(#arrowhead)" />
      </g>
    );
  });

  // Racks
  const rackElems = Array.from({ length: N_RACKS }, (_, i) => {
    const rx = -55 + i * 50, ry = -7, rz = 0;
    const rawTemp = (temps && temps[Math.floor(i * N_SENSORS / N_RACKS)]) || T_BASE;
    const hasBreach = breaches.some(b => Math.floor((b.pos / N_SENSORS) * N_RACKS) === i);
    const isHot = rawTemp > A1_LIMIT;
    const pw = (rackPowers && rackPowers[i]) || 80;
    const B = [pt(rx, ry, rz), pt(rx+RW, ry, rz), pt(rx+RW, ry+RD, rz), pt(rx, ry+RD, rz)];
    const T = [pt(rx, ry, rz+RH), pt(rx+RW, ry, rz+RH), pt(rx+RW, ry+RD, rz+RH), pt(rx, ry+RD, rz+RH)];
    const ec = hasBreach ? "#f87171" : isHot ? "#fbbf24" : "#1e3a52";
    const rc = hasBreach ? "#180404" : isHot ? "#0f0c00" : "#080e18";
    const filt = hasBreach ? "url(#glow-red)" : isHot ? "url(#glow-amber)" : "none";
    const tx = (T[0][0] + T[1][0]) / 2;
    const ty = (T[0][1] + T[1][1]) / 2 + 3;
    return (
      <g key={`rack${i}`} filter={filt}>
        <polygon points={pts([B[0], B[3], T[3], T[0]])} fill={rc} stroke={ec} strokeWidth="0.7" opacity="0.95" />
        <polygon points={pts([B[3], B[2], T[2], T[3]])} fill={tempToColor(rawTemp)} opacity="0.32" stroke={ec} strokeWidth="0.7" />
        <polygon points={pts(T)} fill={tempToColor(rawTemp)} opacity="0.48" stroke={ec} strokeWidth="0.7" />
        <text x={tx} y={ty} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="monospace">R{i+1}</text>
        <line x1={T[0][0]} y1={T[0][1]} x2={T[0][0]} y2={T[0][1] - (pw / 120) * 8} stroke="#60a5fa" strokeWidth="1.5" opacity="0.5" />
      </g>
    );
  });

  // Fiber segments
  const fiberPts = Array.from({ length: N_SENSORS }, (_, i) => pt(-55 + (i / (N_SENSORS - 1)) * 350, 10, RH + 4));
  const fiberSegs = temps ? temps.slice(0, N_SENSORS).map((t, i) => {
    if (i >= fiberPts.length - 1) return null;
    return (
      <line key={`fs${i}`}
        x1={fiberPts[i][0]} y1={fiberPts[i][1]}
        x2={fiberPts[i+1][0]} y2={fiberPts[i+1][1]}
        stroke={tempToColor(t)} strokeWidth="2.2" opacity="0.9" />
    );
  }) : null;

  // Breach plumes
  const plumes = breaches.map((b, i) => {
    const [px, py] = pt(-55 + (b.pos / (N_SENSORS - 1)) * 350, 10, RH + 4);
    return (
      <g key={`plume${i}`}>
        <circle cx={px} cy={py} r="16" fill="rgba(248,113,113,0.18)" filter="url(#glow-red)" />
        <circle cx={px} cy={py} r="5"  fill="#f87171" opacity="0.85" />
        <line x1={px} y1={py - 5} x2={px} y2={py - 22} stroke="#f87171" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.6" />
      </g>
    );
  });

  // Labels
  const [cax, cay] = pt(140, -26, 0);
  const [hax, hay] = pt(140,  58, 0);
  const [ctx, cty] = pt(295, -18, 72);
  const coldAisle  = pt(-75, -26, 0);
  const coldAisle2 = pt(310, -26, 0);
  const coldAisle3 = pt(310,   8, 0);
  const coldAisle4 = pt(-75,   8, 0);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", background: "transparent" }}>
      <defs>
        <filter id="glow-red">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-amber">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <marker id="arrowhead" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
          <path d="M0,0 L0,5 L5,2.5 z" fill="#60a5fa" />
        </marker>
      </defs>

      {gridLines}
      <polygon
        points={[coldAisle, coldAisle2, coldAisle3, coldAisle4].map(q => q.join(",")).join(" ")}
        fill="rgba(37,99,235,0.04)" />
      {arrowElems}
      {rackElems}
      <rect x={ctx - 13} y={cty - 14} width={26} height={28} fill="#08111e" stroke="#1d4ed8" strokeWidth="0.8" rx="2" />
      <text x={ctx} y={cty + 5} textAnchor="middle" fill="#3b82f6" fontSize="7.5" fontFamily="monospace">CRAC</text>
      <path
        d={fiberPts.map((q, i) => `${i === 0 ? "M" : "L"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ")}
        fill="none" stroke="#0f2a38" strokeWidth="2.5" opacity="0.5" />
      {fiberSegs}
      {plumes}
      <text x={cax} y={cay - 3} textAnchor="middle" fill="#2563eb" fontSize="9"
        fontFamily="'IBM Plex Mono',monospace" letterSpacing="2" opacity="0.65">COLD AISLE</text>
      <text x={hax} y={hay + 11} textAnchor="middle" fill="#b91c1c" fontSize="9"
        fontFamily="'IBM Plex Mono',monospace" letterSpacing="2" opacity="0.65">HOT AISLE</text>
    </svg>
  );
}

// ─── Shared small components ──────────────────────────────────────────────────
function SectionHead({ title, tag, action, onAction }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 600, color: "#4a6a80" }}>{title}</span>
        {tag && (
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e",
            background: "#060d18", border: "1px solid #0a1520", padding: "2px 6px", borderRadius: 3, letterSpacing: 1 }}>
            {tag}
          </span>
        )}
      </div>
      {action && (
        <button onClick={onAction} style={{ background: "none", border: "none", color: "#22d3a0",
          fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, opacity: 0.6, cursor: "pointer" }}>
          {action}
        </button>
      )}
    </div>
  );
}

function BreachControls({ breaches, induce, clear, compact = false }) {
  const zones = [
    { pos: 8,  label: "Zone A — Door Seal"     },
    { pos: 32, label: "Zone B — Curtain Seam"  },
    { pos: 64, label: "Zone C — Top Panel"     },
    { pos: 91, label: "Zone D — End Cap"       },
  ];
  const btnStyle = (isRed) => ({
    padding: compact ? "5px 10px" : "6px 13px",
    background: isRed ? "rgba(248,113,113,0.06)" : "rgba(34,211,160,0.06)",
    border: `1px solid ${isRed ? "rgba(248,113,113,0.22)" : "rgba(34,211,160,0.22)"}`,
    color: isRed ? "#f87171" : "#22d3a0",
    borderRadius: 5,
    fontFamily: "'IBM Plex Mono',monospace",
    fontSize: compact ? 9 : 10,
    letterSpacing: 0.5,
    cursor: "pointer",
  });
  return (
    <div style={{ padding: compact ? "10px 16px" : "14px 20px", borderTop: "1px solid #0a1520",
      background: "#050b16", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0a1e2e", letterSpacing: 2, marginRight: 4 }}>
        {compact ? "" : "DEMO CONTROLS"}
      </span>
      {zones.map(({ pos, label }) => (
        <button key={pos} onClick={() => induce(pos, label)} style={btnStyle(true)}>
          ⚡ {compact ? label.split(" — ")[0] : label}
        </button>
      ))}
      <button onClick={clear} style={btnStyle(false)}>✓ Clear All</button>
      {breaches.length > 0 && (
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#f87171" }}>
          {breaches.length} active
        </span>
      )}
    </div>
  );
}

function AlertCard({ alert, isAcked, onAck }) {
  const colorMap = { CRITICAL: "#f87171", BREACH: "#f87171", WARNING: "#fbbf24", CLEAR: "#22d3a0" };
  const c = colorMap[alert.lvl] || "#3a5a70";
  return (
    <div style={{ background: "#060d18", border: `1px solid ${isAcked ? "#0a1520" : c + "28"}`,
      borderRadius: 5, padding: "9px 11px", opacity: isAcked ? 0.45 : 1,
      animation: "slideD 0.3s ease", transition: "all 0.3s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: c, letterSpacing: 1.5 }}>{alert.lvl}</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e" }}>{alert.time}</span>
      </div>
      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#6a8a9a", lineHeight: 1.4, marginBottom: 3 }}>{alert.what}</div>
      {alert.loc && (
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#1e3a52", marginBottom: 3 }}>📍 {alert.loc}</div>
      )}
      {alert.action && !isAcked && (
        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 9, color: "#1e3a52",
          borderTop: "1px solid #0a1520", paddingTop: 5, marginTop: 2 }}>→ {alert.action}</div>
      )}
      {!isAcked && alert.action && (
        <button onClick={onAck} style={{ marginTop: 7, background: "transparent",
          border: `1px solid ${c}28`, color: c, padding: "3px 0",
          fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, letterSpacing: 1,
          borderRadius: 3, width: "100%", cursor: "pointer" }}>Acknowledge</button>
      )}
      {isAcked && (
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#22d3a0", marginTop: 3 }}>✓ Acknowledged</div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [mode,    setMode]    = useState("overview");
  const [temps,   setTemps]   = useState(makeBaseline);
  const [dpArr,   setDpArr]   = useState(() => Array.from({ length: 4 }, () => DP_BASE + (Math.random() - 0.5) * 1.5));
  const [rackPwr, setRackPwr] = useState(makeRackPower);
  const [breaches, setBreaches] = useState([]);
  const [alerts,  setAlerts]  = useState([]);
  const [acked,   setAcked]   = useState(new Set());
  const [clock,   setClock]   = useState(new Date());
  const [hov,     setHov]     = useState(null);
  const [cxStep,  setCxStep]  = useState(0);
  const [roiKW,   setRoiKW]   = useState(5000);
  const [roiRate, setRoiRate] = useState(0.078);
  const [hint,    setHint]    = useState(null);
  const [intro,   setIntro]   = useState(true);
  const [trend,   setTrend]   = useState(0); // extracted from render to avoid Math.random() in body

  // Stable refs so effects don't close over stale state
  const baselineRef = useRef(makeBaseline());
  const baseDpRef   = useRef(makeBaseDP());
  const breachIdRef = useRef(0);
  const alertIdRef  = useRef(0);
  const breachesRef = useRef(breaches);
  breachesRef.current = breaches;

  // ── Main simulation tick ─────────────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const live = breachesRef.current.filter(b => now - b.t < b.dur);
      setBreaches(live);
      setClock(new Date());

      setTemps(prev => prev.map((t, i) => {
        let target = baselineRef.current[i] + (Math.random() - 0.5) * 0.2;
        for (const b of live) {
          const dist = Math.abs(i - b.pos);
          if (dist < b.w * 2) target += b.int * Math.exp(-0.5 * (dist / (b.w * 0.5)) ** 2);
        }
        return t * 0.68 + target * 0.32;
      }));

      setDpArr(prev => prev.map((dp, i) => {
        let target = baseDpRef.current[i] + (Math.random() - 0.5) * 0.7;
        for (const b of live) {
          const zone = (i + 0.5) * (N_SENSORS / 4);
          const dist = Math.abs(b.pos - zone);
          target -= Math.max(0, 1 - dist / (N_SENSORS / 3)) * (b.int / 14) * 9;
        }
        return dp * 0.58 + target * 0.42;
      }));

      setRackPwr(prev => prev.map(v => v * 0.97 + (65 + Math.random() * 28) * 0.03));

      // Update trend once per tick (not in render body)
      const maxLiveBreach = live.reduce((mx, b) => Math.max(mx, b.int), 0);
      setTrend(maxLiveBreach > 2 ? 0.65 + Math.random() * 0.35 : 0);
    }, 500);

    return () => clearInterval(iv);
  }, []); // stable — uses refs

  // ── Alert detection ──────────────────────────────────────────────────────
  useEffect(() => {
    const deltas = temps.map((t, i) => t - baselineRef.current[i]);
    const maxDelta = Math.max(...deltas);
    const peakIdx  = deltas.indexOf(maxDelta);
    if (maxDelta > 4.5) {
      alertIdRef.current++;
      setAlerts(prev => {
        if (prev[0] && Date.now() - prev[0].ts < 9000) return prev;
        return [{
          id: alertIdRef.current, ts: Date.now(),
          time: new Date().toLocaleTimeString(),
          lvl: maxDelta > 7 ? "CRITICAL" : "WARNING",
          what: `Thermal anomaly ΔT +${maxDelta.toFixed(1)}°C above baseline`,
          where: zoneLabel(peakIdx), loc: physLoc(peakIdx),
          action: `Dispatch to ${physLoc(peakIdx)} — inspect curtain seam`,
        }, ...prev.slice(0, 29)];
      });
    }
  }, [temps]);

  // ── Contextual next-action hints ─────────────────────────────────────────
  useEffect(() => {
    if (breaches.length > 0 && mode === "overview") {
      const t = setTimeout(() => setHint({ msg: "Breach active — see it in 3D", cta: "Open 3D View →", tab: "3d" }), 1500);
      return () => clearTimeout(t);
    }
    if (breaches.length > 0 && mode === "3d") {
      const t = setTimeout(() => setHint({ msg: "Calculate the real cost of this breach", cta: "Open ROI Calc →", tab: "roi" }), 2000);
      return () => clearTimeout(t);
    }
    if (mode === "roi" && breaches.length > 0) {
      setHint({ msg: "Ready to run commissioning protocol?", cta: "Start Commissioning →", tab: "cx" });
      return;
    }
    setHint(null);
  }, [breaches.length, mode]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function zoneLabel(i) {
    return ["Zone A — North", "Zone B", "Zone C", "Zone D — South"][Math.floor(i / (N_SENSORS / 4))];
  }
  function physLoc(i) {
    const rack = Math.floor((i / N_SENSORS) * N_RACKS) + 1;
    const inch = Math.round((i / N_SENSORS) * 480);
    return `Rack R${rack}, ${Math.floor(inch / 12)}'${inch % 12}" from N`;
  }

  // ── Derived metrics ───────────────────────────────────────────────────────
  const deltas = useMemo(() => temps.map((t, i) => t - baselineRef.current[i]), [temps]);
  const maxDelta = Math.max(0, ...deltas);

  const thermalScore = Math.min(1, Math.max(0, (maxDelta - 1) / 10));
  const dpDrop = dpArr.reduce((acc, dp, i) => acc + (baseDpRef.current[i] - dp), 0) / 4;
  const dpScore = Math.min(1, Math.max(0, dpDrop / 16));
  const rackMean = temps.slice(10, 110).reduce((a, b) => a + b, 0) / 100;
  const rackScore = Math.min(1, Math.max(0, (rackMean - T_BASE - 1) / 6));
  const bari = Math.min(1, 0.5 * thermalScore + 0.3 * dpScore + 0.2 * rackScore);
  const bariPct = Math.round(bari * 100);
  const bariColor = bari < 0.3 ? "#22d3a0" : bari < 0.55 ? "#fbbf24" : "#f87171";
  const bariLabel = bari < 0.3 ? "ALL CLEAR" : bari < 0.55 ? "ELEVATED" : bari < 0.8 ? "HIGH RISK" : "CRITICAL";

  const bypassKW = breaches.reduce((acc, b) => acc + (b.int / 14) * 18, 0);
  const costPerHr = bypassKW * ENERGY_RATE;
  const co2PerHr  = bypassKW * CO2_FACTOR * 1000; // grams

  const rackZones = useMemo(() => Array.from({ length: N_RACKS }, (_, i) => {
    const s = Math.floor(i * N_SENSORS / N_RACKS);
    const e = Math.floor((i + 1) * N_SENSORS / N_RACKS);
    const slice = temps.slice(s, e);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    return { id: `R${i + 1}`, avg, delta: avg - T_BASE, power: rackPwr[i] || 80, ...ashraeClass(avg) };
  }), [temps, rackPwr]);

  const maxRackTemp = Math.max(...rackZones.map(z => z.avg));
  const timeToLimit = trend > 0 ? Math.max(0, (A1_LIMIT - maxRackTemp) / trend) : null;

  const critAlert  = alerts.find(a => (a.lvl === "CRITICAL" || a.lvl === "BREACH") && !acked.has(a.id));
  const sysStatus  = bari > 0.55 ? "BREACH DETECTED" : bari > 0.3 ? "ELEVATED" : "NOMINAL";
  const sysColor   = sysStatus === "NOMINAL" ? "#22d3a0" : sysStatus === "ELEVATED" ? "#fbbf24" : "#f87171";
  const unackedCount = alerts.filter(a => !acked.has(a.id) && ["CRITICAL","BREACH","WARNING"].includes(a.lvl)).length;

  // ROI
  const roi_bypassKW = roiKW * 0.20 * 0.18;
  const roi_savings  = roi_bypassKW * roiRate * 8760;
  const roi_payback  = (27500 / roi_savings) * 12;
  const roi_co2      = (roi_bypassKW * CO2_FACTOR * 8760 / 1000).toFixed(1);

  // ── Actions ───────────────────────────────────────────────────────────────
  const induce = useCallback((pos, label) => {
    const id = ++breachIdRef.current;
    setBreaches(prev => [...prev, {
      id, pos, w: 4 + Math.random() * 3, int: 9 + Math.random() * 5,
      dur: 55000 + Math.random() * 25000, t: Date.now(), label,
    }]);
    alertIdRef.current++;
    setAlerts(prev => [{
      id: alertIdRef.current, ts: Date.now(),
      time: new Date().toLocaleTimeString(),
      lvl: "BREACH",
      what: "Containment breach — thermal excursion detected",
      where: label, loc: physLoc(pos),
      action: `Inspect & reseal at ${physLoc(pos)}`,
    }, ...prev.slice(0, 29)]);
  }, []);

  const clearAll = useCallback(() => {
    setBreaches([]);
    setHint(null);
    alertIdRef.current++;
    setAlerts(prev => [{
      id: alertIdRef.current, ts: Date.now(),
      time: new Date().toLocaleTimeString(),
      lvl: "CLEAR", what: "All breaches cleared — returning to baseline",
      where: "All Zones", loc: null, action: null,
    }, ...prev.slice(0, 29)]);
  }, []);

  const ackAlert = (id) => setAcked(prev => new Set([...prev, id]));

  const tabs = [
    { k: "overview",     label: "Overview",      icon: "◈" },
    { k: "3d",           label: "3D View",        icon: "⬡" },
    { k: "engineering",  label: "Engineering",    icon: "◎", badge: unackedCount || null },
    { k: "cx",           label: "Commissioning",  icon: "✦" },
    { k: "roi",          label: "ROI & Savings",  icon: "◇" },
  ];

  // ── Format helpers ────────────────────────────────────────────────────────
  function fmtCountdown(t) {
    const mins = Math.floor(t);
    const secs = String(Math.floor((t % 1) * 60)).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{
      background: "#030a14", minHeight: "100vh", color: "#d1e8f0",
      fontFamily: "'Inter',sans-serif", display: "flex", flexDirection: "column",
      overflow: "hidden", position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        button { cursor: pointer; outline: none; font-family: inherit; }
        ::-webkit-scrollbar { width: 3px; background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e3a52; border-radius: 3px; }
        ::selection { background: rgba(34,211,160,0.2); }
        input[type=range] { -webkit-appearance: none; width: 100%; height: 2px; background: #0f2030; border-radius: 2px; outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #22d3a0; cursor: pointer; border: 2px solid #0a1520; }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes slideD   { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeI    { from{opacity:0} to{opacity:1} }
        @keyframes hintS    { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes critP    { 0%,100%{background:rgba(248,113,113,0.07)} 50%{background:rgba(248,113,113,0.14)} }
        @keyframes introAni { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ── INTRO SCREEN ─────────────────────────────────────────────────── */}
      {intro && (
        <div onClick={() => setIntro(false)} style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(2,6,16,0.96)", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", cursor: "pointer",
          animation: "fadeI 0.5s ease", backdropFilter: "blur(8px)",
        }}>
          <div style={{
            position: "absolute", inset: 0, opacity: 0.7,
            backgroundImage: "radial-gradient(circle at 1px 1px, #0a1520 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }} />
          <div style={{ textAlign: "center", position: "relative", animation: "introAni 0.6s ease 0.2s both" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, fontWeight: 500,
              letterSpacing: 6, color: "#1e3a52", marginBottom: 20 }}>EXI TECHNOLOGIES</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 44, fontWeight: 800,
              letterSpacing: -1.5, color: "#e2e8f0", lineHeight: 1.05, marginBottom: 6 }}>
              AirFlow<br />
              <span style={{ color: "#22d3a0" }}>Integrity</span> Monitor
            </div>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 13, color: "#2a4a5a",
              fontWeight: 300, margin: "18px auto 52px", maxWidth: 400, lineHeight: 1.8 }}>
              Distributed fiber optic sensing for data center containment.<br />
              Sub-0.5m breach localization · 8-second detection.
            </div>
            <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10,
                background: "rgba(34,211,160,0.08)", border: "1px solid rgba(34,211,160,0.25)",
                borderRadius: 8, padding: "13px 32px", fontFamily: "'Syne',sans-serif",
                fontSize: 13, fontWeight: 600, color: "#22d3a0", letterSpacing: 0.5 }}>
                ▶ &nbsp;START INTERACTIVE DEMO
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#0d1e2e", letterSpacing: 1.5 }}>
                CLICK ANYWHERE TO BEGIN
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CRITICAL ALERT BANNER ────────────────────────────────────────── */}
      {critAlert && (
        <div style={{
          background: "rgba(248,113,113,0.07)", borderBottom: "1px solid rgba(248,113,113,0.18)",
          padding: "9px 20px", display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0, animation: "critP 2s infinite", flexWrap: "wrap",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171",
            animation: "pulse 0.8s infinite", flexShrink: 0 }} />
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#f87171", letterSpacing: 2 }}>CRITICAL</span>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "#fecaca", flex: 1 }}>{critAlert.what}</span>
          {critAlert.loc && (
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#f87171", opacity: 0.65 }}>
              📍 {critAlert.loc}
            </span>
          )}
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#475569", flex: 1 }}>→ {critAlert.action}</span>
          <button onClick={() => ackAlert(critAlert.id)} style={{
            marginLeft: "auto", background: "transparent",
            border: "1px solid rgba(248,113,113,0.3)", color: "#f87171",
            padding: "4px 14px", borderRadius: 4, fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 8, letterSpacing: 1, flexShrink: 0,
          }}>Acknowledge</button>
        </div>
      )}

      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", borderBottom: "1px solid #0a1520",
        background: "linear-gradient(180deg,#060d18,#030a14)", flexShrink: 0,
      }}>
        {/* Logo + brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", width: 34, height: 34 }}>
            <svg width="34" height="34" viewBox="0 0 34 34">
              <circle cx="17" cy="17" r="15" fill="none" stroke="#22d3a0" strokeWidth="1.1" opacity="0.28" />
              <circle cx="17" cy="17" r="9"  fill="none" stroke="#22d3a0" strokeWidth="1.1" opacity="0.55" />
              <circle cx="17" cy="17" r="3.5" fill="none" stroke="#22d3a0" strokeWidth="1.4" />
              <circle cx="17" cy="17" r="1.2" fill="#22d3a0" />
              <line x1="4"    y1="17" x2="13.5" y2="17" stroke="#22d3a0" strokeWidth="0.9" opacity="0.35" />
              <line x1="20.5" y1="17" x2="30"   y2="17" stroke="#22d3a0" strokeWidth="0.9" opacity="0.35" />
              <line x1="17"   y1="4"  x2="17"   y2="13.5" stroke="#22d3a0" strokeWidth="0.9" opacity="0.35" />
              <line x1="17"   y1="20.5" x2="17" y2="30"   stroke="#22d3a0" strokeWidth="0.9" opacity="0.35" />
            </svg>
            {bari > 0.55 && (
              <div style={{ position: "absolute", top: 1, right: 1, width: 8, height: 8,
                borderRadius: "50%", background: "#f87171", animation: "pulse 0.8s infinite" }} />
            )}
          </div>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 1.5, color: "#e2e8f0" }}>
              EXI · AIRFLOW INTEGRITY
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#1e3a52", marginTop: 2 }}>
              Zone A1 · Rows 4–5 · {N_SENSORS} sensors · 10 Hz
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <nav style={{ display: "flex", gap: 1, background: "#060d18", borderRadius: 8, padding: 3, border: "1px solid #0d1e2e" }}>
          {tabs.map(({ k, label, icon, badge }) => {
            const active = mode === k;
            return (
              <button key={k} onClick={() => setMode(k)} style={{
                position: "relative", display: "flex", alignItems: "center", gap: 5,
                padding: "7px 16px",
                background: active ? "#0d1e2e" : "transparent",
                border: `1px solid ${active ? "#1e3a52" : "transparent"}`,
                borderRadius: 6, fontFamily: "'Inter',sans-serif", fontSize: 11,
                fontWeight: active ? 500 : 400, color: active ? "#e2e8f0" : "#2a4a5a",
                letterSpacing: 0.3, transition: "all 0.15s",
              }}>
                <span style={{ fontSize: 9, opacity: 0.55 }}>{icon}</span>
                {label}
                {badge && (
                  <span style={{ background: "#f87171", color: "#fff", fontFamily: "'IBM Plex Mono'",
                    fontSize: 7, fontWeight: 700, borderRadius: 8, padding: "1px 4px",
                    position: "absolute", top: 1, right: 1 }}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Clock + status */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#1e3a52" }}>
              {clock.toLocaleTimeString()}
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 1 }}>
              LIVE · EST
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px",
            background: "#060d18", border: `1px solid ${sysColor}22`, borderRadius: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: sysColor, flexShrink: 0,
              animation: sysStatus !== "NOMINAL" ? "pulse 1s infinite" : "none" }} />
            <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 600, color: sysColor, letterSpacing: 0.4 }}>
              {sysStatus}
            </span>
          </div>
        </div>
      </header>

      {/* ── HINT BAR ─────────────────────────────────────────────────────── */}
      {hint && (
        <div style={{
          background: "rgba(34,211,160,0.04)", borderBottom: "1px solid rgba(34,211,160,0.1)",
          padding: "8px 20px", display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0, animation: "hintS 0.4s ease",
        }}>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "#2a6a54" }}>💡 {hint.msg}</span>
          <button onClick={() => { setMode(hint.tab); setHint(null); }} style={{
            background: "rgba(34,211,160,0.08)", border: "1px solid rgba(34,211,160,0.2)",
            color: "#22d3a0", padding: "4px 14px", borderRadius: 4,
            fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, letterSpacing: 0.5,
          }}>{hint.cta}</button>
          <button onClick={() => setHint(null)} style={{
            background: "none", border: "none", color: "#1e3a52", fontSize: 16, marginLeft: "auto",
          }}>×</button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
      {mode === "overview" && (
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>

          {/* KPI Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderBottom: "1px solid #0a1520", flexShrink: 0 }}>
            {[
              { label: "BYPASS RISK",      val: bariLabel,
                sub: `BARI ${bariPct}/100`, color: bariColor, big: true },
              { label: "LIVE WASTE",
                val: bypassKW > 0 ? `${bypassKW.toFixed(1)} kW` : "—",
                sub: bypassKW > 0 ? `$${costPerHr.toFixed(2)}/hr · $${Math.floor(costPerHr * 8760).toLocaleString()}/yr proj.` : "Containment nominal",
                color: bypassKW > 5 ? "#f87171" : "#22d3a0" },
              { label: "CO₂ IMPACT",
                val: bypassKW > 0 ? `${Math.floor(co2PerHr)} g/hr` : "0 g/hr",
                sub: bypassKW > 0 ? `~${(bypassKW * CO2_FACTOR * 8760).toFixed(0)} kg/yr` : "No bypass carbon",
                color: bypassKW > 5 ? "#fb923c" : "#22d3a0" },
              { label: "ACTIVE BREACHES",
                val: String(breaches.length),
                sub: breaches.length > 0 ? "Locate & reseal now" : "Containment sealed",
                color: breaches.length > 0 ? "#f87171" : "#22d3a0" },
              timeToLimit !== null
                ? { label: "TIME TO ASHRAE A1", val: fmtCountdown(timeToLimit),
                    sub: `+${trend.toFixed(2)}°C/min — act now`, color: "#f87171", big: true }
                : { label: "ASHRAE STATUS", val: "Within A1",
                    sub: "All racks within thermal envelope", color: "#22d3a0" },
            ].map((m, i) => (
              <div key={i} style={{ padding: "18px 20px", borderRight: "1px solid #0a1520" }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#1e3a52", letterSpacing: 2, marginBottom: 8 }}>
                  {m.label}
                </div>
                <div style={{ fontFamily: m.big ? "'Syne',sans-serif" : "'IBM Plex Mono',monospace",
                  fontSize: m.big ? 22 : 17, fontWeight: m.big ? 700 : 400,
                  color: m.color, letterSpacing: m.big ? -0.5 : 0 }}>
                  {m.val}
                </div>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#2a4a5a", marginTop: 5, lineHeight: 1.5 }}>
                  {m.sub}
                </div>
              </div>
            ))}
          </div>

          {/* 3-column body */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", flex: 1, minHeight: 0, overflow: "auto" }}>

            {/* Rack health */}
            <div style={{ borderRight: "1px solid #0a1520", padding: "20px 22px", overflow: "auto" }}>
              <SectionHead title="Rack Zone Health" tag="ASHRAE TC 9.9" action="View 3D →" onAction={() => setMode("3d")} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                {rackZones.map(z => (
                  <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#1e3a52", width: 20, flexShrink: 0 }}>{z.id}</span>
                    <div style={{ flex: 1, height: 4, background: "#060d18", borderRadius: 3, overflow: "hidden", border: "1px solid #0a1520" }}>
                      <div style={{ width: `${Math.max(3, Math.min(100, ((z.avg - 14) / 22) * 100))}%`, height: "100%",
                        background: z.color, borderRadius: 3, transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: z.color, width: 42, textAlign: "right" }}>{z.avg.toFixed(1)}°</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: z.color,
                      background: z.bg, border: `1px solid ${z.color}33`, borderRadius: 3,
                      padding: "1px 5px", width: 20, textAlign: "center" }}>{z.cls}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", width: 42, textAlign: "right" }}>{z.power.toFixed(0)}kW</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: "14px 16px", background: "#060d18", borderRadius: 6,
                border: "1px solid #0a1520", display: "flex", alignItems: "center", gap: 14 }}>
                <BariGauge bari={bari} bariColor={bariColor} bariLabel={bariLabel} size="lg" />
                <div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 700, color: bariColor }}>{bariLabel}</div>
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 9, color: "#2a4a5a", marginTop: 3, lineHeight: 1.5 }}>
                    Bypass Airflow Risk Index<br />Composite: Thermal · ΔP · Inlet
                  </div>
                </div>
              </div>
            </div>

            {/* Event log */}
            <div style={{ borderRight: "1px solid #0a1520", padding: "20px 22px", overflow: "auto" }}>
              <SectionHead title="Event Log" tag={`${alerts.length} EVENTS`} action="Full log →" onAction={() => setMode("engineering")} />
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
                {alerts.length === 0 && (
                  <div style={{ padding: "28px 0", textAlign: "center" }}>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#0d1e2e" }}>No events</div>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#1e3a52", marginTop: 4 }}>
                      System nominal — use controls below to test detection
                    </div>
                  </div>
                )}
                {alerts.slice(0, 7).map(a => {
                  const c = { CRITICAL: "#f87171", BREACH: "#f87171", WARNING: "#fbbf24", CLEAR: "#22d3a0" }[a.lvl] || "#3a5a70";
                  return (
                    <div key={a.id} style={{ display: "flex", gap: 9, padding: "9px 11px",
                      background: "#060d18", borderRadius: 5, border: "1px solid #0a1520", animation: "slideD 0.3s ease" }}>
                      <div style={{ width: 3, background: c, borderRadius: 2, flexShrink: 0, alignSelf: "stretch" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: c, letterSpacing: 1.5 }}>{a.lvl}</span>
                          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#1e3a52" }}>{a.time}</span>
                        </div>
                        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "#6a8a9a",
                          lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.what}</div>
                        {a.loc && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#1e3a52", marginTop: 2 }}>📍 {a.loc}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Integrations + compliance */}
            <div style={{ padding: "20px 22px", overflow: "auto" }}>
              <SectionHead title="Integrations" tag="ALL CONNECTED" />
              <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
                {[
                  { l: "DCIM Platform",  s: "REST · 10s poll"       },
                  { l: "BMS / CRAC",     s: "BACnet/IP · 30s poll"  },
                  { l: "PagerDuty",      s: "Webhook · on-event"    },
                  { l: "Modbus PDU",     s: "TCP · 5s poll"         },
                ].map(r => (
                  <div key={r.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 0", borderBottom: "1px solid #060d18" }}>
                    <div>
                      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "#4a6a7a" }}>{r.l}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#0d1e2e", marginTop: 2 }}>{r.s}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22d3a0", display: "inline-block" }} />
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#22d3a0" }}>Live</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 9 }}>
                  COMPLIANCE
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {["NFPA 75", "UL 2043", "ASHRAE A1", "ISO 14001"].map(b => (
                    <span key={b} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#22d3a0",
                      background: "rgba(34,211,160,0.05)", border: "1px solid rgba(34,211,160,0.18)",
                      borderRadius: 3, padding: "2px 7px" }}>{b} ✓</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <BreachControls breaches={breaches} induce={induce} clear={clearAll} />
        </div>
      )}

      {/* ── 3D VIEW TAB ──────────────────────────────────────────────────── */}
      {mode === "3d" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, background: "#030a14", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ position: "absolute", inset: 0, opacity: 0.6,
              backgroundImage: "radial-gradient(circle at 1px 1px, #0a1520 1px, transparent 0)",
              backgroundSize: "28px 28px", pointerEvents: "none" }} />
            <div style={{ position: "relative", padding: "16px 20px 0", flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 600, color: "#d1e8f0" }}>
                    Containment Zone A1 — 3D Isometric
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#1e3a52", marginTop: 2 }}>
                    Fiber thermal overlay · Breach plumes · Airflow vectors
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  {[["#3b82f6","≤18°C"], ["#22d3a0","18–24°C"], ["#fbbf24","24–27°C"], ["#f87171",">27°C"], ["#60a5fa","Airflow"]].map(([c, l]) => (
                    <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 7, height: 7, background: c, borderRadius: 2 }} />
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#1e3a52" }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <IsoDataCenter breaches={breaches} temps={temps} rackPowers={rackPwr} />
              </div>
            </div>
          </div>

          {/* Rack status bar */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${N_RACKS},1fr)`,
            borderTop: "1px solid #0a1520", background: "#060d18", flexShrink: 0 }}>
            {rackZones.map(z => (
              <div key={z.id} style={{ padding: "10px 12px", borderRight: "1px solid #060d18", textAlign: "center" }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#1e3a52", marginBottom: 4 }}>{z.id}</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 600, color: z.color }}>{z.avg.toFixed(1)}°</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: z.color, marginTop: 2,
                  background: z.bg, display: "inline-block", padding: "1px 4px", borderRadius: 2 }}>{z.cls}</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", marginTop: 3 }}>{z.power.toFixed(0)}kW</div>
              </div>
            ))}
          </div>
          <BreachControls breaches={breaches} induce={induce} clear={clearAll} compact />
        </div>
      )}

      {/* ── ENGINEERING TAB ──────────────────────────────────────────────── */}
      {mode === "engineering" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Sidebar */}
          <div style={{ width: 184, borderRight: "1px solid #0a1520", display: "flex", flexDirection: "column",
            overflowY: "auto", background: "#050b16", flexShrink: 0 }}>
            <div style={{ padding: "16px", borderBottom: "1px solid #0a1520" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 10 }}>
                BARI SCORE
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <BariGauge bari={bari} bariColor={bariColor} bariLabel={bariLabel} size="sm" />
                <div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 10, fontWeight: 700, color: bariColor }}>{bariLabel}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", marginTop: 3 }}>
                    T:{Math.round(thermalScore * 100)}% D:{Math.round(dpScore * 100)}% R:{Math.round(rackScore * 100)}%
                  </div>
                </div>
              </div>
            </div>

            {timeToLimit !== null && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #0a1520", background: "rgba(248,113,113,0.04)" }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#7f1d1d", letterSpacing: 2, marginBottom: 6 }}>
                  ASHRAE COUNTDOWN
                </div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 24, fontWeight: 800, color: "#f87171",
                  letterSpacing: -1, textShadow: "0 0 16px rgba(248,113,113,0.35)" }}>
                  {fmtCountdown(timeToLimit)}
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#7f1d1d", marginTop: 3 }}>
                  +{trend.toFixed(2)}°C/min
                </div>
              </div>
            )}

            <div style={{ padding: "12px 16px", borderBottom: "1px solid #0a1520" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 6 }}>
                BYPASS WASTE
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: bypassKW > 0 ? "#f87171" : "#22d3a0" }}>
                {bypassKW.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400 }}> kW</span>
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#1e3a52", marginTop: 2 }}>
                ${costPerHr.toFixed(2)}/hr · {Math.floor(co2PerHr)} g CO₂/hr
              </div>
            </div>

            <div style={{ padding: "12px 16px", borderBottom: "1px solid #0a1520" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 8 }}>
                DIFF PRESSURE
              </div>
              {dpArr.map((dp, i) => {
                const drop = baseDpRef.current[i] - dp;
                const alarm = drop > 7;
                return (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#1e3a52" }}>DP-{String.fromCharCode(65 + i)}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: alarm ? "#f87171" : "#94a3b8" }}>
                        {dp.toFixed(1)} Pa
                      </span>
                    </div>
                    <div style={{ height: 2, background: "#060d18", borderRadius: 1 }}>
                      <div style={{ width: `${Math.max(2, Math.min(100, (dp / 45) * 100))}%`,
                        height: "100%", background: alarm ? "#f87171" : "#22d3a0", transition: "width 0.4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "12px 16px" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 6 }}>
                DETECTION ALGO
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#1e3a52", lineHeight: 2 }}>
                Z-score · 30s window<br />
                σ×2.5 threshold<br />
                Gaussian σ=5<br />
                15s sustain required<br />
                Dual-fiber correction<br />
                <span style={{ color: "#22d3a0" }}>89% prec · 84% recall</span>
              </div>
            </div>
          </div>

          {/* Heatmap center */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #0a1520" }}>
            <div style={{ flex: 1, padding: "16px 18px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 600, color: "#4a6a80" }}>
                  Distributed Fiber Temperature Profile
                </div>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e" }}>
                  ±0.18°C · ~6cm pitch · Inferred air temp
                </span>
              </div>

              {/* Zone labels */}
              <div style={{ display: "flex", marginBottom: 2 }}>
                {["ZONE A", "ZONE B", "ZONE C", "ZONE D"].map((z, i) => (
                  <div key={z} style={{ flex: 1, textAlign: "center", fontFamily: "'IBM Plex Mono',monospace",
                    fontSize: 6, color: "#0d1e2e", letterSpacing: 2,
                    borderRight: i < 3 ? "1px solid #060d18" : "none" }}>{z}</div>
                ))}
              </div>
              <div style={{ display: "flex", marginBottom: 2 }}>
                {Array.from({ length: N_RACKS }, (_, i) => (
                  <div key={i} style={{ flex: N_SENSORS / N_RACKS, textAlign: "center",
                    fontFamily: "'IBM Plex Mono',monospace", fontSize: 6, color: "#0a1e2e" }}>R{i + 1}</div>
                ))}
              </div>

              {/* Heatmap */}
              <div style={{ display: "flex", height: 56, borderRadius: 3, overflow: "hidden",
                border: "1px solid #060d18", cursor: "crosshair" }}
                onMouseLeave={() => setHov(null)}>
                {temps.map((t, i) => {
                  const dt = t - baselineRef.current[i];
                  return (
                    <div key={i} style={{
                      flex: 1, background: tempToColor(t), transition: "background 0.5s",
                      transform: dt > 3 ? `scaleY(${1 + dt * 0.04})` : "scaleY(1)",
                      transformOrigin: "bottom",
                      outline: hov === i ? "1.5px solid rgba(255,255,255,0.55)" : "none",
                    }}
                      onMouseEnter={() => setHov(i)} />
                  );
                })}
              </div>

              {/* Delta strip */}
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 6, color: "#0a1e2e", letterSpacing: 2, margin: "6px 0 2px" }}>
                ΔT FROM BASELINE
              </div>
              <div style={{ display: "flex", height: 11, borderRadius: 2, overflow: "hidden", border: "1px solid #060d18" }}>
                {deltas.map((dt, i) => {
                  const m = Math.min(1, Math.abs(dt) / 12);
                  return (
                    <div key={i} style={{
                      flex: 1,
                      background: dt > 0 ? `rgba(248,113,113,${m})` : `rgba(96,165,250,${m})`,
                      transition: "background 0.5s",
                    }} />
                  );
                })}
              </div>

              {/* Color scale */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e" }}>14°</span>
                <div style={{ flex: 1, height: 4, display: "flex", borderRadius: 2, overflow: "hidden" }}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <div key={i} style={{ flex: 1, background: tempToColor(14 + i * 1.1) }} />
                  ))}
                </div>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e" }}>40°</span>
              </div>

              {/* Hover tooltip */}
              {hov !== null && (
                <div style={{ display: "flex", gap: 14, marginTop: 7, padding: "6px 10px",
                  background: "#060d18", borderRadius: 4, border: "1px solid #0d1e2e",
                  animation: "fadeI 0.15s ease", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#1e3a52" }}>#{hov}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#1e3a52" }}>{physLoc(hov)}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#fbbf24", fontWeight: 500 }}>
                    {temps[hov]?.toFixed(2)}°C
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9,
                    color: deltas[hov] > 1.5 ? "#f87171" : "#2a4a5a" }}>
                    Δ{deltas[hov] > 0 ? "+" : ""}{deltas[hov]?.toFixed(2)}°C
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0a1520" }}>INFERRED ±0.18°C</span>
                </div>
              )}

              {/* Rack bars */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 6, color: "#0a1e2e", letterSpacing: 2, marginBottom: 6 }}>
                  RACK TEMPERATURE & POWER
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${N_RACKS},1fr)`, gap: 4 }}>
                  {rackZones.map(z => (
                    <div key={z.id} style={{ textAlign: "center" }}>
                      <div style={{ height: 36, background: "#060d18", borderRadius: 2, overflow: "hidden",
                        position: "relative", border: "1px solid #0a1520" }}>
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0,
                          height: `${Math.max(3, Math.min(100, ((z.avg - 14) / 22) * 100))}%`,
                          background: z.color, opacity: 0.65, transition: "height 0.5s" }} />
                        <div style={{ position: "absolute", bottom: 0, left: 0,
                          width: `${Math.max(2, (z.power / 120) * 100)}%`,
                          height: 2, background: "#3b82f6", opacity: 0.45 }} />
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: z.color, marginTop: 2 }}>{z.avg.toFixed(1)}°</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 6, color: "#0a1e2e" }}>{z.id}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <BreachControls breaches={breaches} induce={induce} clear={clearAll} compact />
          </div>

          {/* Alert panel */}
          <div style={{ width: 264, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #0a1520", display: "flex",
              justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2 }}>EVENT LOG</span>
              {unackedCount > 0 && (
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#f87171" }}>
                  {unackedCount} UNACKNOWLEDGED
                </span>
              )}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {alerts.length === 0 && (
                <div style={{ padding: "28px 0", textAlign: "center" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#0d1e2e" }}>No events</div>
                  <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#1e3a52", marginTop: 3 }}>
                    Induce a breach to test detection
                  </div>
                </div>
              )}
              {alerts.map(a => (
                <AlertCard key={a.id} alert={a} isAcked={acked.has(a.id)} onAck={() => ackAlert(a.id)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── COMMISSIONING TAB ─────────────────────────────────────────────── */}
      {mode === "cx" && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "18px 22px", borderBottom: "1px solid #0a1520",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 600, color: "#d1e8f0" }}>
                  Commissioning Wizard — Zone A1
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#1e3a52", marginTop: 2 }}>
                  Standard EXI commissioning protocol · ISA-18.2 aligned
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ height: 3, width: 140, background: "#060d18", borderRadius: 2 }}>
                  <div style={{ width: `${(cxStep / 7) * 100}%`, height: "100%", background: "#22d3a0", borderRadius: 2, transition: "width 0.4s" }} />
                </div>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#22d3a0" }}>
                  {Math.min(cxStep, 7)}/7
                </span>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px", display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { t: "Pre-Check: Fiber Continuity",  d: `Verify all ${N_SENSORS} sensors active and calibrated`,          m: `${N_SENSORS}/${N_SENSORS} OK`, lim: "100%"     },
                { t: "Close All Openings",            d: "Physically seal all containment doors, blanking panels, seams",   m: "Operator confirm",            lim: "Visual"   },
                { t: "Baseline Capture",              d: "Record 5-minute stable profile under nominal load",              m: "σ = 0.31°C",                  lim: "σ < 0.8°C"},
                { t: "Breach Detection Test",         d: "Induce 6-inch gap at Zone A — verify detection under 30 seconds", m: cxStep > 3 ? "8.2s ✓" : "Pending", lim: "< 30s"},
                { t: "Localization Test",             d: "Verify breach located within ±25cm of actual gap position",      m: cxStep > 4 ? "±11cm ✓" : "Pending", lim: "< ±25cm"},
                { t: "False Positive Test",           d: "CRAC ±3°C swing — confirm zero spurious alerts triggered",       m: cxStep > 5 ? "0 false +ve ✓" : "Pending", lim: "< 2/week"},
                { t: "Generate Certificate",          d: "Auto-generate signed digital commissioning certificate",         m: cxStep > 6 ? "PDF ready ✓" : "Pending",   lim: "All pass"},
              ].map((step, i) => {
                const done   = i < cxStep;
                const active = i === cxStep;
                const pending= i > cxStep;
                return (
                  <div key={i} style={{
                    display: "flex", gap: 12, padding: "12px 14px",
                    background: active ? "rgba(34,211,160,0.04)" : done ? "rgba(34,211,160,0.02)" : "#050b16",
                    border: `1px solid ${done ? "rgba(34,211,160,0.18)" : active ? "rgba(34,211,160,0.3)" : "#0a1520"}`,
                    borderRadius: 5, transition: "all 0.3s",
                  }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%",
                      border: `1.5px solid ${done || active ? "#22d3a0" : "#0a1520"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, marginTop: 1, background: done ? "rgba(34,211,160,0.08)" : "transparent" }}>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8,
                        color: done || active ? "#22d3a0" : "#1e3a52" }}>
                        {done ? "✓" : active ? "▶" : `${i + 1}`}
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 600,
                        color: pending ? "#1e3a52" : "#c8e0f0", letterSpacing: 0.2 }}>{step.t}</div>
                      {(active || done) && (
                        <>
                          <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#2a4a5a", marginTop: 3, lineHeight: 1.5 }}>{step.d}</div>
                          <div style={{ display: "flex", gap: 14, marginTop: 5 }}>
                            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: done ? "#22d3a0" : "#fbbf24" }}>{step.m}</span>
                            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e" }}>Limit: {step.lim}</span>
                          </div>
                        </>
                      )}
                    </div>
                    {done && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 8, color: "#22d3a0", alignSelf: "flex-start", marginTop: 2 }}>PASS</span>}
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "12px 22px", borderTop: "1px solid #0a1520",
              display: "flex", gap: 9, alignItems: "center", flexShrink: 0 }}>
              {cxStep < 7 && (
                <button onClick={() => { if (cxStep === 3) induce(12, "CX Test — Zone A"); setCxStep(s => s + 1); }}
                  style={{ padding: "8px 22px", background: "rgba(34,211,160,0.07)",
                    border: "1px solid rgba(34,211,160,0.25)", color: "#22d3a0", borderRadius: 5,
                    fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 600 }}>
                  {cxStep === 0 ? "▶ Start Commissioning" : cxStep === 6 ? "✓ Generate Certificate" : "▶ Next Step"}
                </button>
              )}
              {cxStep > 0 && cxStep < 7 && (
                <button onClick={() => { clearAll(); setCxStep(0); }}
                  style={{ padding: "8px 14px", background: "transparent", border: "1px solid #0a1520",
                    color: "#1e3a52", borderRadius: 5, fontFamily: "'IBM Plex Mono',monospace", fontSize: 9 }}>
                  ↺ Restart
                </button>
              )}
              {cxStep >= 7 && (
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 600, color: "#22d3a0" }}>
                  ✓ All tests passed — certificate ready
                </div>
              )}
            </div>
          </div>

          {/* Certificate preview */}
          <div style={{ width: 248, borderLeft: "1px solid #0a1520", background: "#050b16", padding: "18px", overflowY: "auto" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 12 }}>
              REPORT PREVIEW
            </div>
            <div style={{ padding: "14px", background: "#060d18", borderRadius: 5, border: "1px solid #0a1520",
              fontFamily: "'IBM Plex Mono',monospace", fontSize: 7.5, color: "#1e3a52", lineHeight: 2.1 }}>
              <div style={{ color: "#22d3a0", fontSize: 8, marginBottom: 6 }}>EXI COMMISSIONING CERTIFICATE</div>
              Zone: Containment A1 · Rows 4–5<br />
              Date: {new Date().toLocaleDateString()}<br />
              Operator: CX-ENG-001<br />
              Interrogator: Luna ODiSI-6104<br />
              Fiber: SMF-28e · G.652.D<br />
              <div style={{ color: "#060d18", margin: "3px 0" }}>────────────────────</div>
              Sensors: {N_SENSORS}/{N_SENSORS} active<br />
              Baseline σ: 0.31°C ✓<br />
              Detection: 8.2s ✓<br />
              Localization: ±11cm ✓<br />
              False +ve: 0 ✓<br />
              <div style={{ color: "#060d18", margin: "3px 0" }}>────────────────────</div>
              NFPA 75: COMPLIANT ✓<br />
              UL 2043: COMPLIANT ✓<br />
              ASHRAE A1: COMPLIANT ✓<br />
              <div style={{ color: "#060d18", margin: "3px 0" }}>────────────────────</div>
              <div style={{ color: cxStep >= 7 ? "#22d3a0" : "#1e3a52" }}>
                {cxStep >= 7 ? "STATUS: CERTIFIED ✓" : "STATUS: IN PROGRESS"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ROI TAB ───────────────────────────────────────────────────────── */}
      {mode === "roi" && (
        <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #0a1520" }}>
            {/* Sliders */}
            <div style={{ padding: "18px 22px", borderBottom: "1px solid #0a1520" }}>
              <SectionHead title="Facility Parameters" tag="CUSTOMIZE FOR YOUR SITE" />
              <div style={{ display: "flex", gap: 28, marginTop: 14 }}>
                {[
                  { l: "IT Load",     v: roiKW,   set: setRoiKW,   min: 500,  max: 20000, step: 500,   disp: `${roiKW.toLocaleString()} kW`   },
                  { l: "Energy Rate", v: roiRate, set: setRoiRate, min: 0.04, max: 0.18,  step: 0.005, disp: `$${roiRate.toFixed(3)}/kWh`     },
                ].map(r => (
                  <div key={r.l} style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                      <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "#3a5a70" }}>{r.l}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#fbbf24", fontWeight: 500 }}>{r.disp}</span>
                    </div>
                    <input type="range" min={r.min} max={r.max} step={r.step} value={r.v}
                      onChange={e => r.set(Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>

            {/* Results grid */}
            <div style={{ padding: "22px", flex: 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
                {[
                  { l: "Annual Savings",    v: `$${roi_savings.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, s: "From bypass elimination",      c: "#22d3a0",  big: true  },
                  { l: "Payback Period",    v: `${roi_payback.toFixed(1)} mo`,  s: "On $27,500 pilot",                   c: roi_payback < 24 ? "#22d3a0" : "#fbbf24", big: true },
                  { l: "CO₂ Avoided",       v: `${roi_co2} t/yr`,              s: "ESG reporting value",                 c: "#60a5fa",  big: true  },
                  { l: "Bypass Recovery",   v: `${roi_bypassKW.toFixed(0)} kW`, s: "20% bypass × 18% fix rate",          c: "#fbbf24",  big: false },
                  { l: "Pilot Cost",        v: "$20K–$35K",                     s: "All-in · 90 days",                   c: "#3a5a70",  big: false },
                  { l: "Subscription",      v: "$18K–$40K/yr",                  s: "Per zone post-pilot",                c: "#3a5a70",  big: false },
                ].map(k => (
                  <div key={k.l} style={{ padding: "15px 17px", background: "#060d18",
                    border: "1px solid #0a1520", borderRadius: 7 }}>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e",
                      letterSpacing: 1.5, marginBottom: 7, textTransform: "uppercase" }}>{k.l}</div>
                    <div style={{
                      fontFamily: k.big ? "'Syne',sans-serif" : "'IBM Plex Mono',monospace",
                      fontSize: k.big ? 20 : 15, fontWeight: k.big ? 700 : 400,
                      color: k.c, letterSpacing: k.big ? -0.5 : 0,
                    }}>{k.v}</div>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 9, color: "#1e3a52", marginTop: 5 }}>{k.s}</div>
                  </div>
                ))}
              </div>

              <SectionHead title="Why EXI Wins" tag="COMPETITIVE POSITION" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, marginTop: 10 }}>
                {[
                  { l: "vs DCIM Sensors",      b: "Sub-0.5m localization. 4–12 sensors/row can't tell you which 6 inches of curtain failed. We can." },
                  { l: "vs Manual Inspection",  b: "8-second detection vs. minutes-to-never. Catch it before GPU throttle — not after the SLA call." },
                  { l: "vs CFD Twins",          b: "Real-time structural sensing vs. design-time assumptions. Actual measured reality, not simulation." },
                ].map(r => (
                  <div key={r.l} style={{ padding: "12px 14px", border: "1px solid rgba(34,211,160,0.13)",
                    borderRadius: 6, background: "rgba(34,211,160,0.02)" }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 10, fontWeight: 600, color: "#22d3a0", marginBottom: 7 }}>{r.l}</div>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#1e3a52", lineHeight: 1.65 }}>{r.b}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pricing sidebar */}
          <div style={{ width: 224, background: "#050b16", padding: "22px 18px",
            display: "flex", flexDirection: "column", gap: 18, overflow: "auto" }}>
            <div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 8 }}>
                PILOT PACKAGE
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 700, color: "#fbbf24", letterSpacing: -0.5 }}>
                $20K–$35K
              </div>
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#1e3a52", marginTop: 6, lineHeight: 1.8 }}>
                90 days · 1 zone<br />Hardware + install<br />All reports included<br />Day-30 cancel option
              </div>
            </div>
            <div style={{ borderTop: "1px solid #0a1520", paddingTop: 18 }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 8 }}>
                SUBSCRIPTION
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: "#60a5fa" }}>
                $18K–$40K<span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 9, color: "#1e3a52" }}>/yr</span>
              </div>
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "#1e3a52", marginTop: 6, lineHeight: 1.8 }}>
                Per containment zone<br />Dashboard & API<br />Annual recalibration<br />Remote support
              </div>
            </div>
            <div style={{ borderTop: "1px solid #0a1520", paddingTop: 18 }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7, color: "#0d1e2e", letterSpacing: 2, marginBottom: 8 }}>
                DEFENSIBLE MOAT
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 7.5, color: "#1e3a52", lineHeight: 2.1 }}>
                ✓ Only &lt;0.5m resolution<br />
                ✓ Thermal + strain sensing<br />
                ✓ Commissioning lock-in<br />
                ✓ Dataset advantage builds<br />
                ✓ Zero IT access required<br />
                ✓ NFPA/UL compliant
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
