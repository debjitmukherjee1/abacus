// Abacus — finmath.js benchmark tests.
// Run with: node --test tests/   (no npm install needed — Node's built-in
// test runner + assert module only).
import test from "node:test";
import assert from "node:assert/strict";
import * as fm from "../js/finmath.js";

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg}: expected ${expected} ± ${tol}, got ${actual}`);

// ---------------------------------------------------------------------------
// Black-Scholes-Merton — textbook benchmark
// S=100 K=100 r=5% sigma=20% T=1 q=0 -> call ~= 10.4506, put ~= 5.5735
// ---------------------------------------------------------------------------
test("BSM call price matches textbook benchmark", () => {
  const call = fm.bsmCall(100, 100, 0.05, 0, 0.20, 1);
  close(call, 10.4506, 0.01, "BSM call");
});

test("BSM put price matches textbook benchmark (and put-call parity)", () => {
  const put = fm.bsmPut(100, 100, 0.05, 0, 0.20, 1);
  close(put, 5.5735, 0.01, "BSM put");
  const call = fm.bsmCall(100, 100, 0.05, 0, 0.20, 1);
  // put-call parity: C - P = S - K e^{-rT}
  close(call - put, 100 - 100 * Math.exp(-0.05), 1e-8, "put-call parity");
});

test("BSM greeks: call delta in (0,1), put delta in (-1,0), gamma/vega positive", () => {
  const g = fm.bsmPriceAndGreeks(100, 100, 0.05, 0, 0.20, 1, "call");
  assert.ok(g.delta > 0 && g.delta < 1);
  assert.ok(g.gamma > 0);
  assert.ok(g.vega > 0);
  close(g.price, 10.4506, 0.01, "greeks call price");

  const gp = fm.bsmPriceAndGreeks(100, 100, 0.05, 0, 0.20, 1, "put");
  assert.ok(gp.delta < 0 && gp.delta > -1);
  close(gp.price, 5.5735, 0.01, "greeks put price");
});

test("BSM with dividend yield reduces call value vs q=0", () => {
  const noDiv = fm.bsmCall(100, 100, 0.05, 0, 0.20, 1);
  const withDiv = fm.bsmCall(100, 100, 0.05, 0.03, 0.20, 1);
  assert.ok(withDiv < noDiv, "dividend-paying underlying should have a cheaper call");
});

test("implied volatility solver recovers the input sigma", () => {
  const trueSigma = 0.25;
  const price = fm.bsmCall(100, 105, 0.04, 0.01, trueSigma, 0.75);
  const iv = fm.impliedVolatility(price, 100, 105, 0.04, 0.01, 0.75, "call");
  close(iv, trueSigma, 1e-4, "IV solver");
});

test("option payoff at expiry", () => {
  assert.equal(fm.optionPayoffAtExpiry(120, 100, "call"), 20);
  assert.equal(fm.optionPayoffAtExpiry(80, 100, "call"), 0);
  assert.equal(fm.optionPayoffAtExpiry(80, 100, "put"), 20);
  assert.equal(fm.optionPayoffAtExpiry(120, 100, "put"), 0);
});

// ---------------------------------------------------------------------------
// Bonds — 10Y 5% annual coupon bond at 5% yield: price = 100 (par),
// modified duration ~= 7.72
// ---------------------------------------------------------------------------
test("par bond prices at 100 when coupon == yield", () => {
  const price = fm.bondPrice(100, 0.05, 0.05, 1, 10);
  close(price, 100, 1e-6, "par bond price");
});

test("modified duration of a 10Y 5% par bond ~= 7.72", () => {
  const modDur = fm.modifiedDuration(100, 0.05, 0.05, 1, 10);
  close(modDur, 7.72, 0.01, "modified duration");
});

test("macaulay duration = modified duration * (1 + y/freq)", () => {
  const mac = fm.macaulayDuration(100, 0.05, 0.05, 1, 10);
  const mod = fm.modifiedDuration(100, 0.05, 0.05, 1, 10);
  close(mac, mod * 1.05, 1e-9, "macaulay-modified relation");
  close(mac, 8.107, 0.01, "macaulay duration value");
});

test("bond price falls as yield rises (inverse relationship)", () => {
  const p1 = fm.bondPrice(100, 0.05, 0.04, 2, 10);
  const p2 = fm.bondPrice(100, 0.05, 0.06, 2, 10);
  assert.ok(p1 > 100 && p2 < 100, "5% coupon bond should trade above par at 4% yield, below at 6%");
});

test("bondYield inverts bondPrice", () => {
  const price = fm.bondPrice(1000, 0.06, 0.045, 2, 7);
  const y = fm.bondYield(price, 1000, 0.06, 2, 7);
  close(y, 0.045, 1e-6, "bondYield round-trip");
});

test("convexity is positive for a plain vanilla bond", () => {
  const cvx = fm.bondConvexity(100, 0.05, 0.05, 1, 10);
  assert.ok(cvx > 0);
});

test("accrued interest is proportional to elapsed fraction of the period", () => {
  const ai = fm.accruedInterest(1000, 0.06, 2, 0.5); // half a semiannual period
  close(ai, 15, 1e-9, "accrued interest"); // coupon = 30/period, half elapsed = 15
});

// ---------------------------------------------------------------------------
// DCF — hand-computed 2-year case
// revenue0=1000, growth=[10%,10%], margin=20%, tax=25%, reinvest=30%,
// wacc=9%, terminal growth=2.5%, netDebt=200, shares=100
// ---------------------------------------------------------------------------
test("DCF matches a hand-computed 2-year case", () => {
  const params = {
    revenue0: 1000,
    growthRates: [0.10, 0.10],
    operatingMargin: 0.20,
    taxRate: 0.25,
    reinvestmentRate: 0.30,
    wacc: 0.09,
    terminalGrowth: 0.025,
    netDebt: 200,
    sharesOutstanding: 100,
  };
  const r = fm.runDCF(params);

  // revenue: 1000*1.1=1100, 1100*1.1=1210
  close(r.revenues[0], 1100, 1e-9, "rev y1");
  close(r.revenues[1], 1210, 1e-9, "rev y2");

  // FCF: EBIT=rev*0.20, NOPAT=EBIT*0.75, FCF=NOPAT*0.70
  const fcf1 = 1100 * 0.20 * 0.75 * 0.70; // = 115.5
  const fcf2 = 1210 * 0.20 * 0.75 * 0.70; // = 127.05
  close(r.fcfs[0], fcf1, 1e-9, "fcf y1");
  close(r.fcfs[1], fcf2, 1e-9, "fcf y2");

  const pv1 = fcf1 / 1.09;
  const pv2 = fcf2 / Math.pow(1.09, 2);
  close(r.pvFcfs[0], pv1, 1e-9, "pv fcf y1");
  close(r.pvFcfs[1], pv2, 1e-9, "pv fcf y2");

  const tv = (fcf2 * 1.025) / (0.09 - 0.025);
  close(r.terminalValue, tv, 1e-6, "terminal value");
  const pvTv = tv / Math.pow(1.09, 2);
  close(r.pvTerminalValue, pvTv, 1e-6, "pv terminal value");

  const ev = pv1 + pv2 + pvTv;
  close(r.enterpriseValue, ev, 1e-6, "enterprise value");
  close(r.equityValue, ev - 200, 1e-6, "equity value");
  close(r.valuePerShare, (ev - 200) / 100, 1e-6, "value per share");
});

test("dcfSensitivity grid is monotonic: value falls as WACC rises, rises as terminal growth rises", () => {
  const base = {
    revenue0: 1000, growthRates: [0.08, 0.08, 0.06],
    operatingMargin: 0.18, taxRate: 0.25, reinvestmentRate: 0.35,
    netDebt: 100, sharesOutstanding: 50,
  };
  const { grid } = fm.dcfSensitivity(base, [0.08, 0.09, 0.10], [0.02, 0.025]);
  // across rows (increasing WACC), value should decrease for a fixed column
  assert.ok(grid[0][0] > grid[1][0] && grid[1][0] > grid[2][0], "value falls as WACC rises");
  // across columns (increasing terminal growth), value should increase for a fixed row
  assert.ok(grid[0][1] > grid[0][0], "value rises as terminal growth rises");
});

test("terminal growth at/above WACC is flagged NaN in the sensitivity grid, not a bogus negative value", () => {
  const base = {
    revenue0: 1000, growthRates: [0.05], operatingMargin: 0.15,
    taxRate: 0.25, reinvestmentRate: 0.3, netDebt: 0, sharesOutstanding: 10,
  };
  const { grid } = fm.dcfSensitivity(base, [0.08], [0.08, 0.09]);
  assert.ok(Number.isNaN(grid[0][0]));
  assert.ok(Number.isNaN(grid[0][1]));
});

// ---------------------------------------------------------------------------
// Comps
// ---------------------------------------------------------------------------
test("impliedValueFromMultiple: simple P/E case (no netDebt) multiplies EPS directly", () => {
  const peerPEs = [12, 14, 15, 18, 20];
  const eps = 5;
  const r = fm.impliedValueFromMultiple(peerPEs, eps);
  close(r.median, 15 * 5, 1e-9, "median implied price");
  close(r.min, 12 * 5, 1e-9, "min implied price");
  close(r.max, 20 * 5, 1e-9, "max implied price");
});

test("impliedValueFromMultiple: EV/EBITDA case nets out debt to get equity value per share", () => {
  const peerMultiples = [8, 9, 10, 11];
  const ebitda = 200;
  const r = fm.impliedValueFromMultiple(peerMultiples, ebitda, { netDebt: 300, sharesOutstanding: 50 });
  // median multiple 9.5 -> EV = 1900, equity = 1600, per share = 32
  close(r.median, (9.5 * 200 - 300) / 50, 1e-9, "median implied EV/EBITDA price");
});

test("blendValuation defaults to 70% intrinsic / 30% comps", () => {
  const blended = fm.blendValuation(100, 200); // comps=100, intrinsic=200
  close(blended, 0.7 * 200 + 0.3 * 100, 1e-9, "default blend weight");
});

test("fiveNumberSummary quartiles on a known array", () => {
  const s = fm.fiveNumberSummary([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  close(s.median, 5, 1e-9, "median");
  close(s.min, 1, 1e-9, "min");
  close(s.max, 9, 1e-9, "max");
});

// ---------------------------------------------------------------------------
// WACC / CAPM
// ---------------------------------------------------------------------------
test("CAPM cost of equity", () => {
  const ke = fm.capmCostOfEquity(0.045, 1.2, 0.055);
  close(ke, 0.045 + 1.2 * 0.055, 1e-9, "CAPM");
});

test("WACC matches a hand-computed case", () => {
  // E=800, D=200, ke=11%, pre-tax kd=6%, tax=25%
  const r = fm.wacc({ equityValue: 800, debtValue: 200, costOfEquity: 0.11, preTaxCostOfDebt: 0.06, taxRate: 0.25 });
  close(r.weightEquity, 0.8, 1e-9, "weight equity");
  close(r.weightDebt, 0.2, 1e-9, "weight debt");
  close(r.afterTaxCostOfDebt, 0.045, 1e-9, "after-tax kd");
  close(r.wacc, 0.8 * 0.11 + 0.2 * 0.045, 1e-9, "wacc");
});

// ---------------------------------------------------------------------------
// Compounding & SIP
// ---------------------------------------------------------------------------
test("future value lump sum: annual compounding matches (1+r)^n", () => {
  const fv = fm.futureValueLumpSum(100000, 0.10, 10, 1);
  close(fv, 100000 * Math.pow(1.10, 10), 1e-6, "lump sum FV");
});

test("future value SIP matches a hand-computed 3-month case", () => {
  // 12% annual -> 1% monthly, ₹1000/mo for 3 months, annuity-due
  const fv = fm.futureValueSIP(1000, 0.12, 3);
  // month1 grows 3 periods, month2 grows 2, month3 grows 1 (invested at start of month)
  const expected = 1000 * 1.01 ** 3 + 1000 * 1.01 ** 2 + 1000 * 1.01 ** 1;
  close(fv, expected, 1e-6, "SIP FV 3-month hand calc");
});

test("requiredMonthlySIP inverts futureValueSIP", () => {
  const target = 5_000_000;
  const months = 180; // 15 years
  const rate = 0.11;
  const monthly = fm.requiredMonthlySIP(target, rate, months);
  const fv = fm.futureValueSIP(monthly, rate, months);
  close(fv, target, 1e-3, "goal-seek round-trip");
});

test("real rate via Fisher equation", () => {
  const real = fm.realRate(0.08, 0.05);
  close(real, (1.08 / 1.05) - 1, 1e-9, "Fisher equation");
});

test("futureValueSIP with zero rate is a simple sum", () => {
  close(fm.futureValueSIP(1000, 0, 12), 12000, 1e-9, "zero-rate SIP");
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
test("normCDF matches known standard-normal values", () => {
  close(fm.normCDF(0), 0.5, 1e-6, "normCDF(0)");
  close(fm.normCDF(1.959964), 0.975, 1e-4, "normCDF(1.96)");
  close(fm.normCDF(-1.959964), 0.025, 1e-4, "normCDF(-1.96)");
});

test("bisect finds the root of a simple monotonic function", () => {
  const root = fm.bisect((x) => x * x * x - 8, 0, 10);
  close(root, 2, 1e-6, "cube root of 8");
});
