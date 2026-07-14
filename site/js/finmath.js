// Abacus — finmath.js
// Pure finance math. No DOM, no I/O, no globals — every function takes plain
// numbers/arrays/objects and returns plain numbers/arrays/objects, so it can
// be imported by both the browser UI (js/app.js) and the Node test suite
// (tests/finmath.test.mjs) unchanged.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Standard normal PDF. */
export function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
 *  (max error ~1.5e-7 — more than enough precision for BSM/greeks). */
export function normCDF(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Ascending-sorted copy of an array of numbers. */
function sortedNums(arr) {
  return [...arr].sort((a, b) => a - b);
}

/** Linear-interpolated percentile (0..1) of an array, e.g. quartile(arr, 0.25). */
export function percentile(arr, p) {
  const s = sortedNums(arr);
  if (s.length === 0) return NaN;
  if (s.length === 1) return s[0];
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** min/q1/median/q3/max/mean of a numeric array. */
export function fiveNumberSummary(arr) {
  return {
    min: percentile(arr, 0),
    q1: percentile(arr, 0.25),
    median: percentile(arr, 0.5),
    q3: percentile(arr, 0.75),
    max: percentile(arr, 1),
    mean: arr.reduce((a, b) => a + b, 0) / arr.length,
  };
}

/** Generic bisection root-finder on a monotonic function f over [lo, hi]. */
export function bisect(f, lo, hi, opts = {}) {
  const tol = opts.tol ?? 1e-8;
  const maxIter = opts.maxIter ?? 200;
  let flo = f(lo), fhi = f(hi);
  if (Number.isNaN(flo) || Number.isNaN(fhi)) return NaN;
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return NaN; // no sign change in bracket
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < tol || (hi - lo) / 2 < tol) return mid;
    if (flo * fmid < 0) { hi = mid; fhi = fmid; } else { lo = mid; flo = fmid; }
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// DCF
// ---------------------------------------------------------------------------

/**
 * Project revenue for each forecast year from a base year and an array of
 * per-year growth rates (fractions, e.g. 0.10 for 10%).
 * @returns {number[]} revenue for years 1..N (length = growthRates.length)
 */
export function projectRevenue(revenue0, growthRates) {
  const out = [];
  let rev = revenue0;
  for (const g of growthRates) {
    rev = rev * (1 + g);
    out.push(rev);
  }
  return out;
}

/**
 * Project unlevered free cash flow for each year:
 *   EBIT = revenue * operatingMargin
 *   NOPAT = EBIT * (1 - taxRate)
 *   FCF = NOPAT * (1 - reinvestmentRate)
 * operatingMargin and reinvestmentRate may each be a single number (applied
 * to every year) or an array matched to revenues by index.
 */
export function projectFCF(revenues, operatingMargin, taxRate, reinvestmentRate) {
  const at = (v, i) => Array.isArray(v) ? v[i] : v;
  return revenues.map((rev, i) => {
    const ebit = rev * at(operatingMargin, i);
    const nopat = ebit * (1 - taxRate);
    return nopat * (1 - at(reinvestmentRate, i));
  });
}

/** Gordon-growth terminal value as of the end of the final forecast year. */
export function terminalValue(finalYearFCF, wacc, terminalGrowth) {
  return (finalYearFCF * (1 + terminalGrowth)) / (wacc - terminalGrowth);
}

/** Discount an array of cash flows (year 1..N) back to present value at `rate`. */
export function discountCashFlows(cashFlows, rate) {
  return cashFlows.map((cf, i) => cf / Math.pow(1 + rate, i + 1));
}

/**
 * Full DCF: revenue → FCF → PV of explicit FCFs + PV of terminal value →
 * enterprise value → equity value → value per share.
 *
 * @param {object} p
 * @param {number} p.revenue0 - trailing/base-year revenue
 * @param {number[]} p.growthRates - one fraction per forecast year
 * @param {number|number[]} p.operatingMargin - EBIT margin, constant or per-year
 * @param {number} p.taxRate
 * @param {number|number[]} p.reinvestmentRate - fraction of NOPAT reinvested
 * @param {number} p.wacc
 * @param {number} p.terminalGrowth
 * @param {number} p.netDebt - debt minus cash (subtracted from EV)
 * @param {number} p.sharesOutstanding
 */
export function runDCF(p) {
  const revenues = projectRevenue(p.revenue0, p.growthRates);
  const fcfs = projectFCF(revenues, p.operatingMargin, p.taxRate, p.reinvestmentRate);
  const pvFcfs = discountCashFlows(fcfs, p.wacc);
  const n = fcfs.length;
  const tv = terminalValue(fcfs[n - 1], p.wacc, p.terminalGrowth);
  const pvTerminalValue = tv / Math.pow(1 + p.wacc, n);
  const sumPvFcfs = pvFcfs.reduce((a, b) => a + b, 0);
  const enterpriseValue = sumPvFcfs + pvTerminalValue;
  const equityValue = enterpriseValue - p.netDebt;
  const valuePerShare = equityValue / p.sharesOutstanding;
  return {
    revenues, fcfs, pvFcfs,
    terminalValue: tv, pvTerminalValue,
    sumPvFcfs, enterpriseValue, equityValue, valuePerShare,
  };
}

/**
 * WACC × terminal-growth sensitivity grid of value-per-share.
 * @returns {{waccs:number[], tgs:number[], grid:number[][]}} grid[i][j] = value per share at waccs[i], tgs[j]
 */
export function dcfSensitivity(baseParams, waccs, tgs) {
  const grid = waccs.map(w =>
    tgs.map(tg => {
      if (tg >= w) return NaN; // terminal growth must stay below WACC
      return runDCF({ ...baseParams, wacc: w, terminalGrowth: tg }).valuePerShare;
    })
  );
  return { waccs, tgs, grid };
}

// ---------------------------------------------------------------------------
// Comps
// ---------------------------------------------------------------------------

/**
 * Implied value-per-share from a peer multiple and the target's own metric,
 * summarized across the peer set (min/q1/median/q3/max).
 * @param {number[]} peerMultiples
 * @param {number} targetMetric - e.g. target EPS, EBITDA, or book value per share
 * @param {object} [opts]
 * @param {number} [opts.netDebt] - if supplied, metric is EV-based (e.g. EBITDA):
 *   implied EV = multiple * metric, implied equity = EV - netDebt, price = equity / shares
 * @param {number} [opts.sharesOutstanding] - required when opts.netDebt is supplied
 */
export function impliedValueFromMultiple(peerMultiples, targetMetric, opts = {}) {
  const stats = fiveNumberSummary(peerMultiples);
  const toValue = (multiple) => {
    if (opts.netDebt !== undefined) {
      const ev = multiple * targetMetric;
      const equity = ev - opts.netDebt;
      return equity / opts.sharesOutstanding;
    }
    return multiple * targetMetric;
  };
  return {
    multipleStats: stats,
    min: toValue(stats.min),
    q1: toValue(stats.q1),
    median: toValue(stats.median),
    q3: toValue(stats.q3),
    max: toValue(stats.max),
  };
}

/**
 * Blend a comps-implied value with an intrinsic (e.g. DCF) value-per-share.
 * @param {number} compsValue
 * @param {number} intrinsicValue
 * @param {number} intrinsicWeight - fraction [0,1] applied to the intrinsic value; default 0.70
 */
export function blendValuation(compsValue, intrinsicValue, intrinsicWeight = 0.70) {
  return intrinsicWeight * intrinsicValue + (1 - intrinsicWeight) * compsValue;
}

// ---------------------------------------------------------------------------
// Options — Black-Scholes-Merton (with continuous dividend yield q; q=0 for
// the plain non-dividend BSM case). European exercise only.
// ---------------------------------------------------------------------------

function bsmD1D2(S, K, r, q, sigma, T) {
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

/** BSM call price. */
export function bsmCall(S, K, r, q, sigma, T) {
  const { d1, d2 } = bsmD1D2(S, K, r, q, sigma, T);
  return S * Math.exp(-q * T) * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
}

/** BSM put price (via the same d1/d2; not put-call parity shortcutting). */
export function bsmPut(S, K, r, q, sigma, T) {
  const { d1, d2 } = bsmD1D2(S, K, r, q, sigma, T);
  return K * Math.exp(-r * T) * normCDF(-d2) - S * Math.exp(-q * T) * normCDF(-d1);
}

/** Price + full greeks for a call or put. Greeks are per 1.00 (not %) of the
 *  underlying input units; theta is per year, vega/rho are per 1.00 (100%) move. */
export function bsmPriceAndGreeks(S, K, r, q, sigma, T, type = "call") {
  const { d1, d2 } = bsmD1D2(S, K, r, q, sigma, T);
  const isCall = type === "call";
  const price = isCall ? bsmCall(S, K, r, q, sigma, T) : bsmPut(S, K, r, q, sigma, T);
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const pdf1 = normPDF(d1);

  const delta = isCall ? eqT * normCDF(d1) : -eqT * normCDF(-d1);
  const gamma = (eqT * pdf1) / (S * sigma * Math.sqrt(T));
  const vega = S * eqT * pdf1 * Math.sqrt(T); // per 1.00 (100 vol points) change in sigma
  const theta = isCall
    ? (-(S * eqT * pdf1 * sigma) / (2 * Math.sqrt(T))) - r * K * erT * normCDF(d2) + q * S * eqT * normCDF(d1)
    : (-(S * eqT * pdf1 * sigma) / (2 * Math.sqrt(T))) + r * K * erT * normCDF(-d2) - q * S * eqT * normCDF(-d1);
  const rho = isCall
    ? K * T * erT * normCDF(d2)
    : -K * T * erT * normCDF(-d2);

  return { price, delta, gamma, vega, theta, rho, d1, d2 };
}

/** Payoff at expiry per contract share (no premium netted out). */
export function optionPayoffAtExpiry(spot, strike, type) {
  return type === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/**
 * Implied volatility via bisection on BSM price.
 * @returns {number} sigma, or NaN if not solvable in the bracket.
 */
export function impliedVolatility(targetPrice, S, K, r, q, T, type = "call", opts = {}) {
  const f = (sigma) => (type === "call" ? bsmCall(S, K, r, q, sigma, T) : bsmPut(S, K, r, q, sigma, T)) - targetPrice;
  return bisect(f, opts.lo ?? 1e-4, opts.hi ?? 5, opts);
}

// ---------------------------------------------------------------------------
// Bonds
// ---------------------------------------------------------------------------

/**
 * Clean price of a bond as a % of face value (or in face-value currency units
 * if faceValue is e.g. 100 or 1000), given a periodic yield.
 * @param {number} faceValue
 * @param {number} couponRate - annual coupon rate (fraction)
 * @param {number} yieldRate - annual yield to maturity (fraction), compounded `freq` times/yr
 * @param {number} freq - coupon payments per year (1 = annual, 2 = semiannual)
 * @param {number} years - years to maturity
 */
export function bondPrice(faceValue, couponRate, yieldRate, freq, years) {
  const n = Math.round(freq * years);
  const c = (couponRate * faceValue) / freq;
  const y = yieldRate / freq;
  let pv = 0;
  for (let t = 1; t <= n; t++) {
    pv += c / Math.pow(1 + y, t);
  }
  pv += faceValue / Math.pow(1 + y, n);
  return pv;
}

/** Solve for the yield that reproduces a given price (bisection; yield in (−0.9999, 10)). */
export function bondYield(price, faceValue, couponRate, freq, years, opts = {}) {
  const f = (y) => bondPrice(faceValue, couponRate, y, freq, years) - price;
  return bisect(f, opts.lo ?? -0.5, opts.hi ?? 5, opts);
}

/** Macaulay duration (in years): PV-weighted average time to each cash flow. */
export function macaulayDuration(faceValue, couponRate, yieldRate, freq, years) {
  const n = Math.round(freq * years);
  const c = (couponRate * faceValue) / freq;
  const y = yieldRate / freq;
  let weightedSum = 0, pvSum = 0;
  for (let t = 1; t <= n; t++) {
    const cf = t === n ? c + faceValue : c;
    const pv = cf / Math.pow(1 + y, t);
    weightedSum += (t / freq) * pv;
    pvSum += pv;
  }
  return weightedSum / pvSum;
}

/** Modified duration = Macaulay duration / (1 + y/freq). */
export function modifiedDuration(faceValue, couponRate, yieldRate, freq, years) {
  const mac = macaulayDuration(faceValue, couponRate, yieldRate, freq, years);
  return mac / (1 + yieldRate / freq);
}

/** Convexity (annualized) of a bond's price-yield relationship. */
export function bondConvexity(faceValue, couponRate, yieldRate, freq, years) {
  const n = Math.round(freq * years);
  const c = (couponRate * faceValue) / freq;
  const y = yieldRate / freq;
  let sum = 0;
  for (let t = 1; t <= n; t++) {
    const cf = t === n ? c + faceValue : c;
    sum += cf / Math.pow(1 + y, t + 2) * t * (t + 1);
  }
  const price = bondPrice(faceValue, couponRate, yieldRate, freq, years);
  return sum / (price * freq * freq);
}

/**
 * Accrued interest since the last coupon, given a fraction of the coupon
 * period elapsed (e.g. daysSinceLastCoupon / daysInPeriod, actual/actual or
 * 30/360 — caller supplies the fraction already computed for the convention
 * they want).
 */
export function accruedInterest(faceValue, couponRate, freq, fractionOfPeriodElapsed) {
  const c = (couponRate * faceValue) / freq;
  return c * fractionOfPeriodElapsed;
}

// ---------------------------------------------------------------------------
// WACC / CAPM
// ---------------------------------------------------------------------------

/** Cost of equity via CAPM: rf + beta * equity risk premium. */
export function capmCostOfEquity(riskFreeRate, beta, equityRiskPremium) {
  return riskFreeRate + beta * equityRiskPremium;
}

/** After-tax cost of debt. */
export function afterTaxCostOfDebt(preTaxCostOfDebt, taxRate) {
  return preTaxCostOfDebt * (1 - taxRate);
}

/**
 * WACC from market-value weights.
 * @param {object} p
 * @param {number} p.equityValue
 * @param {number} p.debtValue
 * @param {number} p.costOfEquity
 * @param {number} p.preTaxCostOfDebt
 * @param {number} p.taxRate
 */
export function wacc(p) {
  const total = p.equityValue + p.debtValue;
  const we = p.equityValue / total;
  const wd = p.debtValue / total;
  const kd = afterTaxCostOfDebt(p.preTaxCostOfDebt, p.taxRate);
  return {
    weightEquity: we,
    weightDebt: wd,
    afterTaxCostOfDebt: kd,
    wacc: we * p.costOfEquity + wd * kd,
  };
}

// ---------------------------------------------------------------------------
// Compounding & SIP
// ---------------------------------------------------------------------------

/** Future value of a lump sum with discrete compounding `n` times/year. */
export function futureValueLumpSum(principal, annualRate, years, compoundingPerYear = 1) {
  return principal * Math.pow(1 + annualRate / compoundingPerYear, compoundingPerYear * years);
}

/**
 * Future value of a monthly SIP (systematic investment plan): a fixed
 * contribution invested at the start of each month (annuity-due), growing at
 * a constant monthly rate derived from the annual nominal rate.
 * @param {number} monthlyContribution
 * @param {number} annualRate - nominal annual rate, compounded monthly
 * @param {number} months - number of contributions
 */
export function futureValueSIP(monthlyContribution, annualRate, months) {
  const i = annualRate / 12;
  if (i === 0) return monthlyContribution * months;
  return monthlyContribution * ((Math.pow(1 + i, months) - 1) / i) * (1 + i);
}

/** Fisher equation: real rate implied by a nominal rate and an inflation rate. */
export function realRate(nominalRate, inflationRate) {
  return (1 + nominalRate) / (1 + inflationRate) - 1;
}

/**
 * Goal-seek: the monthly SIP contribution required to reach `targetFV` in
 * `months` months at `annualRate`. Closed-form inverse of futureValueSIP.
 */
export function requiredMonthlySIP(targetFV, annualRate, months) {
  const i = annualRate / 12;
  if (i === 0) return targetFV / months;
  return targetFV / (((Math.pow(1 + i, months) - 1) / i) * (1 + i));
}

/** Future value of a lump sum plus a monthly SIP running in parallel. */
export function futureValueCombined(lumpSum, annualRate, years, monthlyContribution) {
  return futureValueLumpSum(lumpSum, annualRate, years, 12) + futureValueSIP(monthlyContribution, annualRate, years * 12);
}
