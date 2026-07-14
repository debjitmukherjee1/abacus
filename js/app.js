/* Abacus — 100% static. All math runs client-side via finmath.js.
   No API keys, no live server, no per-visitor cost, no data pipeline. */
import * as fm from "./finmath.js";

// Mirrors the CSS custom properties in css/styles.css — Chart.js draws on a
// canvas, so it can't read var(--accent) etc. directly; these are kept in
// sync by hand.
const COLORS = {
  ink: "#2b241a",
  inkDim: "#6b6153",
  accent: "#9c6b2e",
  accentSoft: "#c99a4f",
  accentWash: "rgba(156,107,46,.18)",
  bull: "#266b43",
  bear: "#963527",
  line: "#ddd0b3",
  lineSoft: "#e7dcc2",
  surface: "#faf6ec",
};

if (window.Chart) {
  Chart.defaults.font.family = "'EB Garamond', Georgia, serif";
  Chart.defaults.color = COLORS.inkDim;
  Chart.defaults.borderColor = COLORS.lineSoft;
}

const charts = {}; // canvasId -> Chart instance, so re-renders destroy+recreate cleanly

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fmt(n, decimals = 2) {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(fraction, decimals = 1) {
  if (fraction == null || Number.isNaN(fraction) || !Number.isFinite(fraction)) return "—";
  return (fraction * 100).toFixed(decimals) + "%";
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function renderStatRow(containerId, stats) {
  document.getElementById(containerId).innerHTML = stats
    .map((s) => `<div class="stat"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`)
    .join("");
}
function linearPath(start, end, n) {
  if (n <= 1) return [end];
  const out = [];
  for (let i = 0; i < n; i++) out.push(start + (end - start) * (i / (n - 1)));
  return out;
}

/** Horizontal "football field" range bar with a marker tick, built from two
 *  overlapping bar datasets on a shared category axis (avoids the
 *  linear/category scale mismatch that a mixed bar+scatter chart runs into). */
function drawFootballField(canvasId, rows) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();
  const eps = rows.map((r) => Math.max((r.high - r.low) * 0.015, (Math.abs(r.mark) || 1) * 0.004));
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.label),
      datasets: [
        {
          label: "Range",
          data: rows.map((r) => [r.low, r.high]),
          backgroundColor: COLORS.accentWash,
          borderColor: COLORS.accentSoft,
          borderWidth: 1.5,
          borderRadius: 5,
          barPercentage: 0.55,
        },
        {
          label: "Estimate",
          data: rows.map((r, i) => [r.mark - eps[i], r.mark + eps[i]]),
          backgroundColor: COLORS.ink,
          borderWidth: 0,
          barPercentage: 0.55,
          borderRadius: 2,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const r = rows[c.dataIndex];
              return c.datasetIndex === 0 ? `Range: ${fmt(r.low, 1)} – ${fmt(r.high, 1)}` : `Estimate: ${fmt(r.mark, 1)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: COLORS.lineSoft } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tabs (desktop nav + mobile select), shared across all six calculators
// ---------------------------------------------------------------------------

const state = { activeTab: "dcf" };
const indicator = document.getElementById("tab-indicator");

function moveIndicator(tab) {
  indicator.style.left = tab.offsetLeft + "px";
  indicator.style.width = tab.offsetWidth + "px";
}
function positionIndicatorToActive() {
  const a = document.querySelector(".tab.active");
  if (a) moveIndicator(a);
}
function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".tab").forEach((x) => {
    const isActive = x.dataset.tab === tabName;
    x.classList.toggle("active", isActive);
    x.setAttribute("aria-selected", String(isActive));
    if (isActive) moveIndicator(x);
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === tabName));
  document.getElementById("tab-select").value = tabName;
  // Chart.js can't size a canvas correctly while its parent is display:none,
  // so nudge every chart belonging to the panel that just became visible.
  Object.entries(charts).forEach(([id, chart]) => {
    const canvas = document.getElementById(id);
    if (canvas && canvas.closest(".panel")?.id === tabName) chart.resize();
  });
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
document.getElementById("tab-select").addEventListener("change", (e) => switchTab(e.target.value));
window.addEventListener("resize", positionIndicatorToActive);

// ---------------------------------------------------------------------------
// DCF
// ---------------------------------------------------------------------------

let lastDCFValuePerShare = null;
const dcfEl = (id) => document.getElementById(`dcf-${id}`);
const WACC_OFFSETS = [-2, -1, -0.5, 0, 0.5, 1, 2]; // percentage points, around current WACC
const TG_OFFSETS = [-1, -0.5, 0, 0.5, 1]; // percentage points, around current terminal growth

function readDCFInputs() {
  return {
    revenue0: Number(dcfEl("revenue0").value),
    years: Math.max(3, Math.min(10, Math.round(Number(dcfEl("years").value)))),
    g0: Number(dcfEl("g0").value) / 100,
    gn: Number(dcfEl("gn").value) / 100,
    m0: Number(dcfEl("m0").value) / 100,
    mn: Number(dcfEl("mn").value) / 100,
    tax: Number(dcfEl("tax").value) / 100,
    reinvest: Number(dcfEl("reinvest").value) / 100,
    wacc: Number(dcfEl("wacc").value) / 100,
    tg: Number(dcfEl("tg").value) / 100,
    netdebt: Number(dcfEl("netdebt").value),
    shares: Number(dcfEl("shares").value),
  };
}
function dcfParamsFromInputs(inp) {
  return {
    revenue0: inp.revenue0,
    growthRates: linearPath(inp.g0, inp.gn, inp.years),
    operatingMargin: linearPath(inp.m0, inp.mn, inp.years),
    taxRate: inp.tax,
    reinvestmentRate: inp.reinvest,
    wacc: inp.wacc,
    terminalGrowth: inp.tg,
    netDebt: inp.netdebt,
    sharesOutstanding: inp.shares,
  };
}
function computeDCFSensitivity(params, inp) {
  const waccs = WACC_OFFSETS.map((o) => Math.max(0.001, inp.wacc + o / 100));
  const tgs = TG_OFFSETS.map((o) => inp.tg + o / 100);
  return fm.dcfSensitivity(params, waccs, tgs);
}
function renderDCFHeatmap(sensitivity) {
  const { waccs, tgs, grid } = sensitivity;
  const flat = grid.flat().filter((v) => !Number.isNaN(v));
  const min = Math.min(...flat), max = Math.max(...flat);
  let html = "<thead><tr><th>WACC \\ Term. growth</th>" + tgs.map((tg) => `<th>${fmtPct(tg, 1)}</th>`).join("") + "</tr></thead><tbody>";
  waccs.forEach((w, i) => {
    html += `<tr><th>${fmtPct(w, 1)}</th>`;
    tgs.forEach((tg, j) => {
      const v = grid[i][j];
      const isBase = WACC_OFFSETS[i] === 0 && TG_OFFSETS[j] === 0;
      if (Number.isNaN(v)) {
        html += `<td class="na${isBase ? " base-case" : ""}">—</td>`;
      } else {
        const t = max > min ? (v - min) / (max - min) : 0.5;
        const alpha = (0.06 + t * 0.55).toFixed(2);
        html += `<td class="${isBase ? "base-case" : ""}" style="background:rgba(156,107,46,${alpha})">${fmt(v, 1)}</td>`;
      }
    });
    html += "</tr>";
  });
  document.getElementById("dcf-heatmap").innerHTML = html + "</tbody>";
}
function renderDCFCashFlowTable(params, result) {
  const n = params.growthRates.length;
  let html = "<thead><tr><th>Year</th><th>Growth</th><th>Revenue</th><th>Op. margin</th><th>EBIT</th><th>NOPAT</th><th>FCF</th><th>PV(FCF)</th></tr></thead><tbody>";
  for (let i = 0; i < n; i++) {
    const margin = params.operatingMargin[i];
    const ebit = result.revenues[i] * margin;
    const nopat = ebit * (1 - params.taxRate);
    html += `<tr><td>${i + 1}</td><td>${fmtPct(params.growthRates[i], 1)}</td><td>${fmt(result.revenues[i], 1)}</td><td>${fmtPct(margin, 1)}</td><td>${fmt(ebit, 1)}</td><td>${fmt(nopat, 1)}</td><td>${fmt(result.fcfs[i], 1)}</td><td>${fmt(result.pvFcfs[i], 1)}</td></tr>`;
  }
  html += `<tr><td colspan="7" style="text-align:right;font-weight:600">PV(terminal value)</td><td style="font-weight:600">${fmt(result.pvTerminalValue, 1)}</td></tr>`;
  document.getElementById("dcf-cf-table").innerHTML = html + "</tbody>";
}

const DCF_URL_MAP = { rev: "revenue0", yrs: "years", g0: "g0", gn: "gn", m0: "m0", mn: "mn", tax: "tax", reinv: "reinvest", wacc: "wacc", tg: "tg", nd: "netdebt", sh: "shares" };
const DCF_PCT_KEYS = new Set(["g0", "gn", "m0", "mn", "tax", "reinv", "wacc", "tg"]);

function loadDCFFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let any = false;
  for (const [short, key] of Object.entries(DCF_URL_MAP)) {
    if (params.has(short)) {
      any = true;
      dcfEl(key).value = params.get(short);
    }
  }
  return any;
}
function syncDCFUrl(inp) {
  const params = new URLSearchParams();
  for (const [short, key] of Object.entries(DCF_URL_MAP)) {
    const raw = inp[key];
    params.set(short, DCF_PCT_KEYS.has(short) ? +(raw * 100).toFixed(4) : raw);
  }
  params.set("tab", state.activeTab);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function runDCFAndRender() {
  const inp = readDCFInputs();
  const params = dcfParamsFromInputs(inp);
  const result = fm.runDCF(params);
  lastDCFValuePerShare = result.valuePerShare;

  document.getElementById("dcf-value-per-share").textContent = fmt(result.valuePerShare, 2);
  renderStatRow("dcf-stats", [
    { label: "Enterprise value", value: fmt(result.enterpriseValue, 1) },
    { label: "Equity value", value: fmt(result.equityValue, 1) },
    { label: "PV(terminal value)", value: fmt(result.pvTerminalValue, 1) },
    { label: "TV % of EV", value: fmtPct(result.pvTerminalValue / result.enterpriseValue, 0) },
  ]);
  renderDCFCashFlowTable(params, result);

  const sensitivity = computeDCFSensitivity(params, inp);
  renderDCFHeatmap(sensitivity);
  const flat = sensitivity.grid.flat().filter((v) => !Number.isNaN(v));
  drawFootballField("dcf-football-chart", [{ label: "DCF", low: Math.min(...flat), high: Math.max(...flat), mark: result.valuePerShare }]);

  syncDCFUrl(inp);
}
document.querySelectorAll('#dcf input').forEach((el) => el.addEventListener("input", debounce(runDCFAndRender, 200)));
document.getElementById("dcf-copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
  } catch {
    /* clipboard permission denied — link is still correct in the address bar */
  }
  const el = document.getElementById("dcf-copy-confirm");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
});

// ---------------------------------------------------------------------------
// Comps
// ---------------------------------------------------------------------------

let peers = [
  { name: "Peer A", pe: 18, evEbitda: 10.0, pb: 3.2 },
  { name: "Peer B", pe: 21, evEbitda: 11.5, pb: 3.8 },
  { name: "Peer C", pe: 16, evEbitda: 9.2, pb: 2.9 },
  { name: "Peer D", pe: 24, evEbitda: 13.0, pb: 4.5 },
  { name: "Peer E", pe: 19, evEbitda: 10.8, pb: 3.4 },
];

function renderPeerTable() {
  const table = document.getElementById("comps-peer-table");
  let html = "<thead><tr><th>Peer</th><th>P/E</th><th>EV/EBITDA</th><th>P/B</th><th></th></tr></thead><tbody>";
  peers.forEach((p, i) => {
    html += `<tr>
      <td><input type="text" data-field="name" data-i="${i}" value="${escapeHtml(p.name)}"></td>
      <td><input type="number" data-field="pe" data-i="${i}" value="${p.pe}" step="0.1"></td>
      <td><input type="number" data-field="evEbitda" data-i="${i}" value="${p.evEbitda}" step="0.1"></td>
      <td><input type="number" data-field="pb" data-i="${i}" value="${p.pb}" step="0.1"></td>
      <td>${peers.length > 3 ? `<button class="peer-remove" data-i="${i}" type="button" aria-label="Remove peer">×</button>` : ""}</td>
    </tr>`;
  });
  table.innerHTML = html + "</tbody>";
  table.querySelectorAll("input").forEach((inp) =>
    inp.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i), field = e.target.dataset.field;
      peers[i][field] = field === "name" ? e.target.value : Number(e.target.value);
      runCompsAndRender();
    })
  );
  table.querySelectorAll(".peer-remove").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      peers.splice(Number(e.target.dataset.i), 1);
      renderPeerTable();
      runCompsAndRender();
    })
  );
  document.getElementById("comps-add-peer").disabled = peers.length >= 8;
}
document.getElementById("comps-add-peer").addEventListener("click", () => {
  if (peers.length >= 8) return;
  peers.push({ name: `Peer ${String.fromCharCode(65 + peers.length)}`, pe: 18, evEbitda: 10, pb: 3 });
  renderPeerTable();
  runCompsAndRender();
});

function readCompsTargetInputs() {
  return {
    eps: Number(document.getElementById("comps-eps").value),
    ebitda: Number(document.getElementById("comps-ebitda").value),
    bvps: Number(document.getElementById("comps-bvps").value),
    netDebt: Number(document.getElementById("comps-netdebt").value),
    shares: Number(document.getElementById("comps-shares").value),
    intrinsic: Number(document.getElementById("comps-intrinsic").value),
  };
}
function runCompsAndRender() {
  if (peers.length < 3) return;
  const t = readCompsTargetInputs();
  const peResult = fm.impliedValueFromMultiple(peers.map((p) => p.pe), t.eps);
  const evResult = fm.impliedValueFromMultiple(peers.map((p) => p.evEbitda), t.ebitda, { netDebt: t.netDebt, sharesOutstanding: t.shares });
  const pbResult = fm.impliedValueFromMultiple(peers.map((p) => p.pb), t.bvps);
  const compsMedian = (peResult.median + evResult.median + pbResult.median) / 3;
  const intrinsicWeight = Number(document.getElementById("comps-blend").value) / 100;
  const blended = fm.blendValuation(compsMedian, t.intrinsic, intrinsicWeight);

  document.getElementById("comps-blended-value").textContent = fmt(blended, 2);
  renderStatRow("comps-stats", [
    { label: "P/E median", value: fmt(peResult.median, 2) },
    { label: "EV/EBITDA median", value: fmt(evResult.median, 2) },
    { label: "P/B median", value: fmt(pbResult.median, 2) },
    { label: "Comps blended-in", value: fmt(compsMedian, 2) },
  ]);
  drawFootballField("comps-football-chart", [
    { label: "P/E", low: peResult.q1, high: peResult.q3, mark: peResult.median },
    { label: "EV/EBITDA", low: evResult.q1, high: evResult.q3, mark: evResult.median },
    { label: "P/B", low: pbResult.q1, high: pbResult.q3, mark: pbResult.median },
    { label: "Blended", low: Math.min(compsMedian, t.intrinsic), high: Math.max(compsMedian, t.intrinsic), mark: blended },
  ]);
}
document.getElementById("comps-blend").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  document.getElementById("comps-blend-label").textContent = `${v}% intrinsic / ${100 - v}% comps`;
  runCompsAndRender();
});
document.getElementById("comps-use-dcf").addEventListener("click", () => {
  if (lastDCFValuePerShare == null) return;
  document.getElementById("comps-intrinsic").value = fmt(lastDCFValuePerShare, 2).replace(/,/g, "");
  runCompsAndRender();
});
["comps-eps", "comps-ebitda", "comps-bvps", "comps-netdebt", "comps-shares", "comps-intrinsic"].forEach((id) =>
  document.getElementById(id).addEventListener("input", runCompsAndRender)
);

// ---------------------------------------------------------------------------
// Options (BSM)
// ---------------------------------------------------------------------------

let optType = "call";
document.querySelectorAll("#opt-type-toggle button").forEach((btn) =>
  btn.addEventListener("click", () => {
    optType = btn.dataset.value;
    document.querySelectorAll("#opt-type-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
    runOptionsAndRender();
  })
);
function readOptInputs() {
  return {
    S: Number(document.getElementById("opt-s").value),
    K: Number(document.getElementById("opt-k").value),
    r: Number(document.getElementById("opt-r").value) / 100,
    q: Number(document.getElementById("opt-q").value) / 100,
    sigma: Number(document.getElementById("opt-sigma").value) / 100,
    T: Number(document.getElementById("opt-t").value),
  };
}
function drawPayoffChart(p) {
  const lo = p.S * 0.5, hi = p.S * 1.5, steps = 60;
  const valueToday = [], payoffExpiry = [];
  for (let i = 0; i <= steps; i++) {
    const spot = lo + (hi - lo) * (i / steps);
    valueToday.push({ x: spot, y: optType === "call" ? fm.bsmCall(spot, p.K, p.r, p.q, p.sigma, p.T) : fm.bsmPut(spot, p.K, p.r, p.q, p.sigma, p.T) });
    payoffExpiry.push({ x: spot, y: fm.optionPayoffAtExpiry(spot, p.K, optType) });
  }
  const ctx = document.getElementById("opt-payoff-chart");
  if (charts["opt-payoff-chart"]) charts["opt-payoff-chart"].destroy();
  charts["opt-payoff-chart"] = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        { label: "Value today", data: valueToday, borderColor: COLORS.accent, backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.15, parsing: false },
        { label: "Payoff at expiry", data: payoffExpiry, borderColor: COLORS.bear, backgroundColor: "transparent", borderWidth: 2, borderDash: [5, 3], pointRadius: 0, tension: 0, parsing: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: "linear", title: { display: true, text: "Spot price" }, grid: { color: COLORS.lineSoft } },
        y: { title: { display: true, text: "Value" }, grid: { color: COLORS.lineSoft } },
      },
    },
  });
}
function runOptionsAndRender() {
  const p = readOptInputs();
  if (!(p.T > 0) || !(p.sigma > 0) || !(p.S > 0) || !(p.K > 0)) return;
  const g = fm.bsmPriceAndGreeks(p.S, p.K, p.r, p.q, p.sigma, p.T, optType);
  document.getElementById("opt-price").textContent = fmt(g.price, 4);
  renderStatRow("opt-greeks", [
    { label: "Delta", value: fmt(g.delta, 4) },
    { label: "Gamma", value: fmt(g.gamma, 5) },
    { label: "Vega / 1 vol pt", value: fmt(g.vega / 100, 4) },
    { label: "Theta / day", value: fmt(g.theta / 365, 4) },
    { label: "Rho / 1% rate", value: fmt(g.rho / 100, 4) },
  ]);
  drawPayoffChart(p);
}
document.getElementById("opt-solve-iv").addEventListener("click", () => {
  const p = readOptInputs();
  const target = Number(document.getElementById("opt-iv-price").value);
  const el = document.getElementById("opt-iv-result");
  if (!(target > 0)) { el.textContent = "Enter a market price first."; return; }
  const iv = fm.impliedVolatility(target, p.S, p.K, p.r, p.q, p.T, optType);
  el.textContent = Number.isNaN(iv) ? "No solution in [0.01%, 500%] vol — check the price is between intrinsic value and spot." : `Implied vol ≈ ${fmtPct(iv, 2)}`;
});
["opt-s", "opt-k", "opt-r", "opt-q", "opt-sigma", "opt-t"].forEach((id) => document.getElementById(id).addEventListener("input", runOptionsAndRender));

// ---------------------------------------------------------------------------
// Bonds
// ---------------------------------------------------------------------------

let bondSolveMode = "price";
document.querySelectorAll("#bond-solve-toggle button").forEach((btn) =>
  btn.addEventListener("click", () => {
    bondSolveMode = btn.dataset.value;
    document.querySelectorAll("#bond-solve-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("bond-yield-field").style.display = bondSolveMode === "price" ? "" : "none";
    document.getElementById("bond-price-field").style.display = bondSolveMode === "yield" ? "" : "none";
    runBondsAndRender();
  })
);
function readBondInputs() {
  return {
    face: Number(document.getElementById("bond-face").value),
    coupon: Number(document.getElementById("bond-coupon").value) / 100,
    freq: Number(document.getElementById("bond-freq").value),
    years: Number(document.getElementById("bond-years").value),
    yieldPct: Number(document.getElementById("bond-yield").value) / 100,
    price: Number(document.getElementById("bond-price").value),
    elapsedPct: Number(document.getElementById("bond-elapsed").value) / 100,
  };
}
function drawBondPYC(b, currentYield, currentPrice) {
  const lo = Math.max(0.0005, currentYield - 0.04), hi = currentYield + 0.04, steps = 40;
  const linePoints = [];
  for (let i = 0; i <= steps; i++) {
    const y = lo + (hi - lo) * (i / steps);
    linePoints.push({ x: y * 100, y: fm.bondPrice(b.face, b.coupon, y, b.freq, b.years) });
  }
  const ctx = document.getElementById("bond-pyc-chart");
  if (charts["bond-pyc-chart"]) charts["bond-pyc-chart"].destroy();
  charts["bond-pyc-chart"] = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        { label: "Price-yield curve", data: linePoints, borderColor: COLORS.accent, backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.05, parsing: false },
        { type: "scatter", label: "Current", data: [{ x: currentYield * 100, y: currentPrice }], backgroundColor: COLORS.ink, pointRadius: 6, pointHoverRadius: 7 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: "linear", title: { display: true, text: "Yield (%)" }, grid: { color: COLORS.lineSoft } },
        y: { title: { display: true, text: "Price" }, grid: { color: COLORS.lineSoft } },
      },
    },
  });
}
function runBondsAndRender() {
  const b = readBondInputs();
  let price, yld;
  if (bondSolveMode === "price") {
    yld = b.yieldPct;
    price = fm.bondPrice(b.face, b.coupon, yld, b.freq, b.years);
    document.getElementById("bond-headline-label").textContent = "Clean price";
    document.getElementById("bond-headline").textContent = fmt(price, 3);
  } else {
    price = b.price;
    yld = fm.bondYield(price, b.face, b.coupon, b.freq, b.years);
    document.getElementById("bond-headline-label").textContent = "Yield to maturity";
    document.getElementById("bond-headline").textContent = Number.isNaN(yld) ? "No solution" : fmtPct(yld, 3);
  }
  if (Number.isNaN(yld) || Number.isNaN(price)) return;

  const mac = fm.macaulayDuration(b.face, b.coupon, yld, b.freq, b.years);
  const mod = fm.modifiedDuration(b.face, b.coupon, yld, b.freq, b.years);
  const cvx = fm.bondConvexity(b.face, b.coupon, yld, b.freq, b.years);
  const ai = fm.accruedInterest(b.face, b.coupon, b.freq, b.elapsedPct);
  const stats = bondSolveMode === "yield" ? [] : [{ label: "Yield to maturity", value: fmtPct(yld, 3) }];
  stats.push(
    { label: "Macaulay duration", value: fmt(mac, 2) + " yrs" },
    { label: "Modified duration", value: fmt(mod, 2) },
    { label: "Convexity", value: fmt(cvx, 2) },
    { label: "Accrued interest", value: fmt(ai, 3) },
    { label: "Dirty price", value: fmt(price + ai, 3) }
  );
  renderStatRow("bond-stats", stats);
  drawBondPYC(b, yld, price);
}
["bond-face", "bond-coupon", "bond-freq", "bond-years", "bond-yield", "bond-price", "bond-elapsed"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("input", runBondsAndRender);
  el.addEventListener("change", runBondsAndRender);
});

// ---------------------------------------------------------------------------
// WACC / CAPM
// ---------------------------------------------------------------------------

let lastWACC = null;
function readWaccInputs() {
  return {
    rf: Number(document.getElementById("wacc-rf").value) / 100,
    beta: Number(document.getElementById("wacc-beta").value),
    erp: Number(document.getElementById("wacc-erp").value) / 100,
    kd: Number(document.getElementById("wacc-kd").value) / 100,
    tax: Number(document.getElementById("wacc-tax").value) / 100,
    equity: Number(document.getElementById("wacc-equity").value),
    debt: Number(document.getElementById("wacc-debt").value),
  };
}
function runWaccAndRender() {
  const w = readWaccInputs();
  const ke = fm.capmCostOfEquity(w.rf, w.beta, w.erp);
  const r = fm.wacc({ equityValue: w.equity, debtValue: w.debt, costOfEquity: ke, preTaxCostOfDebt: w.kd, taxRate: w.tax });
  lastWACC = r.wacc;
  document.getElementById("wacc-result").textContent = fmtPct(r.wacc, 2);
  renderStatRow("wacc-stats", [
    { label: "Cost of equity", value: fmtPct(ke, 2) },
    { label: "After-tax cost of debt", value: fmtPct(r.afterTaxCostOfDebt, 2) },
    { label: "Weight of equity", value: fmtPct(r.weightEquity, 1) },
    { label: "Weight of debt", value: fmtPct(r.weightDebt, 1) },
  ]);
}
["wacc-rf", "wacc-beta", "wacc-erp", "wacc-kd", "wacc-tax", "wacc-equity", "wacc-debt"].forEach((id) =>
  document.getElementById(id).addEventListener("input", runWaccAndRender)
);
document.getElementById("wacc-send-dcf").addEventListener("click", () => {
  if (lastWACC == null) return;
  document.getElementById("dcf-wacc").value = (lastWACC * 100).toFixed(2);
  state.activeTab = "dcf"; // set before runDCFAndRender() so its URL sync stamps tab=dcf, not the tab we're leaving
  runDCFAndRender();
  switchTab("dcf");
  const el = document.getElementById("wacc-send-confirm");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
});

// ---------------------------------------------------------------------------
// Compounding & SIP
// ---------------------------------------------------------------------------

let sipMode = "nominal";
document.querySelectorAll("#sip-real-toggle button").forEach((btn) =>
  btn.addEventListener("click", () => {
    sipMode = btn.dataset.value;
    document.querySelectorAll("#sip-real-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("sip-fv-label").textContent = sipMode === "real" ? "Real value at year N (today's money)" : "Nominal value at year N";
    runSIPAndRender();
  })
);
function readSIPInputs() {
  return {
    currency: document.getElementById("sip-currency").value,
    lump: Number(document.getElementById("sip-lump").value),
    monthly: Number(document.getElementById("sip-monthly").value),
    rate: Number(document.getElementById("sip-rate").value) / 100,
    years: Number(document.getElementById("sip-years").value),
    inflation: Number(document.getElementById("sip-inflation").value) / 100,
  };
}
function effectiveRate(nominalRate, inflation, mode) {
  return mode === "real" ? fm.realRate(nominalRate, inflation) : nominalRate;
}
function drawSIPGrowthChart(s, rate) {
  const points = [];
  for (let y = 0; y <= s.years; y++) {
    points.push({ x: y, y: fm.futureValueLumpSum(s.lump, rate, y, 1) + fm.futureValueSIP(s.monthly, rate, y * 12) });
  }
  const ctx = document.getElementById("sip-growth-chart");
  if (charts["sip-growth-chart"]) charts["sip-growth-chart"].destroy();
  charts["sip-growth-chart"] = new Chart(ctx, {
    type: "line",
    data: { datasets: [{ label: "Portfolio value", data: points, borderColor: COLORS.bull, backgroundColor: "rgba(38,107,67,.10)", fill: true, borderWidth: 2, pointRadius: 0, tension: 0.15, parsing: false }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: "linear", title: { display: true, text: "Year" }, grid: { color: COLORS.lineSoft } },
        y: { title: { display: true, text: `Value (${s.currency})` }, grid: { color: COLORS.lineSoft } },
      },
    },
  });
}
function runSIPGoalSeek(s, rate) {
  const target = Number(document.getElementById("sip-goal-target").value);
  const years = Number(document.getElementById("sip-goal-years").value);
  const required = fm.requiredMonthlySIP(target, rate, years * 12);
  document.getElementById("sip-goal-result").textContent = `${s.currency}${fmt(required, 0)} / month`;
}
function runSIPAndRender() {
  const s = readSIPInputs();
  const rate = effectiveRate(s.rate, s.inflation, sipMode);
  const fvLump = fm.futureValueLumpSum(s.lump, rate, s.years, 1);
  const fvSip = fm.futureValueSIP(s.monthly, rate, s.years * 12);
  const total = fvLump + fvSip;
  const totalContributed = s.lump + s.monthly * s.years * 12;

  document.getElementById("sip-fv").textContent = `${s.currency}${fmt(total, 0)}`;
  renderStatRow("sip-stats", [
    { label: "From lump sum", value: `${s.currency}${fmt(fvLump, 0)}` },
    { label: "From SIP", value: `${s.currency}${fmt(fvSip, 0)}` },
    { label: "Total contributed", value: `${s.currency}${fmt(totalContributed, 0)}` },
    { label: "Growth (gain)", value: `${s.currency}${fmt(total - totalContributed, 0)}` },
  ]);
  drawSIPGrowthChart(s, rate);
  runSIPGoalSeek(s, rate);
}
["sip-currency", "sip-lump", "sip-monthly", "sip-rate", "sip-years", "sip-inflation", "sip-goal-target", "sip-goal-years"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("input", runSIPAndRender);
  el.addEventListener("change", runSIPAndRender);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  // Read ?tab= and set state.activeTab *before* any render pass — runDCFAndRender()
  // rewrites the URL via syncDCFUrl(), which stamps state.activeTab back into the
  // query string, so it must already hold the real tab or a deep link like
  // ?tab=wacc gets silently overwritten back to tab=dcf.
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get("tab");
  const validTabs = ["dcf", "comps", "options", "bonds", "wacc", "sip"];
  state.activeTab = validTabs.includes(tabParam) ? tabParam : "dcf";

  loadDCFFromUrl();
  renderPeerTable();

  runDCFAndRender();
  runCompsAndRender();
  runOptionsAndRender();
  runBondsAndRender();
  runWaccAndRender();
  runSIPAndRender();

  switchTab(state.activeTab);
  positionIndicatorToActive();
}
boot();
