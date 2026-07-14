# Abacus — Executable Plan

**Name:** Abacus *("The analyst's toolkit — six calculators, computed live in your browser.")*
**Author:** Debjit Mukherjee
**Origin:** Fourth tool in the zero-cost GitHub-hosted finance suite, alongside Meridian, MarketPulse and Ledger — same visual identity, styled as a matching set. Also the suite's designated **merge target**: future small calculator ideas ship as new tabs here instead of new standalone repos.
**Status:** Working scaffold (this repo)

---

## 0. Cost & tokens (read first)

- **$0/day to run — literally $0, not "close to it."** Hosting is GitHub Pages. There is no daily job, no cron, no `GitHub Actions` workflow, because there is no data to fetch and nothing to refresh.
- **Zero Claude/Anthropic tokens in operation. Zero API calls of any kind, to anything, ever.** Every formula — Black-Scholes-Merton, bond pricing, DCF, CAPM, SIP — is plain JavaScript that runs in the visitor's own browser. There is no server for a request to hit and no LLM in the loop at any point. Claude was only used to build it.
- This is the simplest tool in the suite by design: no `pipeline/`, no `data/`, no secrets to configure, ever.

---

## 1. What it is

Six calculators sharing one page and one theme:

1. **DCF builder** — base revenue, a growth path (Year-1 → Year-N, linear fade), operating margin (same fade), tax rate, reinvestment rate (% of NOPAT), WACC, terminal growth → enterprise value, equity value, value per share. A live **WACC × terminal-growth sensitivity heatmap** and a **football-field bar** (bear/base/bull range from that same grid). Every DCF input is encoded in the URL query string, so any scenario is a shareable link.
2. **Comps builder** — 3–8 peers with P/E, EV/EBITDA and P/B multiples → median/quartile implied value per share for each, a football-field chart across all three methods plus the blend, and a slider blending the comps-implied value against an intrinsic (e.g. DCF) estimate, default 70% intrinsic / 30% comps.
3. **Options pricer** — Black-Scholes-Merton with a continuous dividend yield (q = 0 recovers the plain non-dividend case), full greeks, a payoff diagram (value-today vs. payoff-at-expiry across a spot range), and a bisection implied-volatility solver.
4. **Bond math** — price ↔ yield (either direction, both by closed-form/bisection), Macaulay and modified duration, convexity, accrued interest, and a price-yield curve chart.
5. **WACC / CAPM** — cost of equity via CAPM, after-tax cost of debt, market-value capital weights → WACC, with a **"Send to DCF"** button that writes the result straight into the DCF tab's WACC field.
6. **Compounding & SIP** — lump-sum and monthly-SIP (annuity-due) growth in ₹ or $, a nominal/real (Fisher-equation) toggle, a growth-curve chart, and goal-seek: "what monthly SIP reaches ₹X by year Y."

---

## 2. Why it stays free (the numbers)

| Component | Provider | Free limit | Our use |
|---|---|---|---|
| Hosting | GitHub Pages | 100 GB/mo bandwidth, unlimited static | a few hundred KB of HTML/CSS/JS, no data files at all |
| Compute | The visitor's browser | N/A | every calculation, every visit |

There is no third row. No API, no database, no function-as-a-service, no
cron. Marginal cost per visitor is $0, and marginal cost of adding a
thousand more visitors is also $0, because nothing scales with traffic
except static-file bandwidth GitHub already gives away for free.

---

## 3. Architecture

```
        ┌───────────────────────────────────────────┐
        │  js/finmath.js                             │
        │  pure functions, no DOM: DCF, comps,        │
        │  BSM + greeks, bond math, CAPM/WACC, SIP    │
        └───────────────────┬─────────────┬──────────┘
                             │             │
                  imported by │             │ imported by
                             ▼             ▼
        ┌────────────────────────┐  ┌──────────────────────────┐
        │  js/app.js               │  │  tests/finmath.test.mjs  │
        │  DOM wiring, Chart.js,   │  │  node:test benchmarks     │
        │  URL-param state (DCF)  │  │  vs. known textbook values│
        └────────────────────────┘  └──────────────────────────┘
                             │
                             ▼
        ┌───────────────────────────────────────────┐
        │  GitHub Pages (static, free), plain branch │
        │  deploy from main → / — no Actions workflow │
        └───────────────────────────────────────────┘
```

The split matters: `finmath.js` never touches `document` or `window`, so the
exact code path a visitor's browser runs is the same code path the test
suite asserts against — not a re-implementation of it.

The site lives at the **repo root**, not in a `site/` folder like its
siblings: GitHub Pages' plain branch-deploy source only accepts `/` or
`/docs`, never an arbitrary subfolder. Meridian/MarketPulse/Ledger get
around that with an Actions workflow (`upload-pages-artifact` +
`deploy-pages`) that deploys their `site/` folder — but Abacus's whole point
is needing zero Actions, so it takes the plain-branch-deploy path instead,
which means the site has to be at the root.

---

## 4. The math (methodology, condensed — full detail lives inline in the UI)

- **DCF** — revenue and operating margin each move in a straight line from a Year-1 to a Year-N value across the forecast window; free cash flow is `NOPAT × (1 − reinvestment rate)`, the standard simplified FCFF form; terminal value is Gordon growth off the final forecast year, discounted back at WACC. Unlevered FCF only — no explicit working-capital or D&A/capex build, no probability weighting of scenarios.
- **Comps** — quartiles (linear-interpolation method) of each peer multiple, applied to the target's own metric; EV/EBITDA implied values subtract the target's net debt to reach an equity value before dividing by shares, P/E and P/B multiply straight through to a price.
- **Options** — full Black-Scholes-Merton with a continuous dividend yield `q`; European exercise only, no early-exercise premium, no discrete dividends, no smile/skew — one flat `σ` for the option's life. Greeks follow the standard Hull formulas (delta, gamma, vega, theta, rho), displayed per-day (theta) and per-1-point (vega, rho) for readability. Implied volatility is solved by bisection.
- **Bonds** — a single flat discount rate applied to every cash flow (no credit-spread curve, no OAS, no embedded options); Macaulay duration is the PV-weighted average time to each cash flow, modified duration is `Macaulay / (1 + y/frequency)`, convexity follows the standard second-derivative-of-price formula. Accrued interest is `(coupon / frequency) × elapsed-period fraction`, so it works under either Actual/Actual or 30/360 depending on how that fraction was computed.
- **WACC / CAPM** — cost of equity is `Rf + β × ERP`; after-tax cost of debt is `pre-tax kd × (1 − tax rate)`; WACC blends both by market-value weights of equity and debt. One flat cost of debt — no tranche-by-tranche schedule.
- **Compounding & SIP** — lump sum compounds annually at the entered rate; the SIP assumes a fixed contribution at the **start** of each month (annuity-due FV formula). "Real" mode substitutes the Fisher-equation real rate for the nominal rate before compounding — a simplification (it implicitly assumes contributions rise with prices too), stated inline in the UI.

**Honest limits (stated inline on every tab, not buried in one methodology
page):** these are calculators, not forecasts. A DCF's terminal value is
usually most of its output. Comps quartiles are only as good as the peer set
you type in. Options greeks assume constant volatility and no jumps. Bond
math here ignores credit risk entirely. None of this is investment advice.

---

## 5. Build phases

- **Phase 0 — scaffold:** `js/finmath.js` (every formula, pure) + `tests/finmath.test.mjs` (benchmarks vs. known values). All tests pass before anything else is built.
- **Phase 1 — UI:** `index.html` + `css/styles.css` (matched to the sibling theme) + `js/app.js` (six tab panels, Chart.js visuals, URL-param state for DCF).
- **Phase 2 — self-review:** re-derive each formula against a standard reference (Hull for BSM, Fabozzi for bond convexity, Damodaran for the FCFF reinvestment-rate form), verify the URL round-trips a full scenario, and check the theme against MarketPulse side by side.
- **Phase 3 — ship:** public repo, GitHub Pages from `main` → `/` (root). No workflow file — there is nothing to automate.
- **Phase 4 — grow:** new calculator ideas become new tabs here (formulas in `finmath.js`, benchmark tests in `tests/`, a panel in `index.html`, wiring in `app.js`) instead of new repos.

---

## 6. What's in this scaffold

```
abacus/
├── docs/EXECUTABLE_PLAN.md      ← this file (planning doc, not the website)
├── index.html                   ← 6 tabs: DCF, Comps, Options, Bonds, WACC/CAPM, SIP
├── css/styles.css               ← warm old-money theme (matches Meridian/MarketPulse/Ledger)
├── js/finmath.js                ← every formula, pure functions, no DOM
├── js/app.js                    ← DOM wiring, Chart.js, URL-param state for the DCF tab
├── favicon.svg
├── tests/finmath.test.mjs       ← node:test benchmarks vs. known values (29 assertions)
├── package.json                 ← test-runner metadata only, zero dependencies
├── LICENSE                      ← MIT
└── README.md
```

No `pipeline/`, no `.github/workflows/`, no `data/`. Nothing to run before
serving the site — open `index.html` directly (or `python -m http.server`
from the repo root) and every calculator works immediately.

---

## 7. Sources (verified July 2026)

- Hull, *Options, Futures, and Other Derivatives* — Black-Scholes-Merton with continuous dividend yield, and the standard greek formulas.
- Fabozzi, *Bond Markets, Analysis, and Strategies* — Macaulay/modified duration and convexity formulas.
- Damodaran — the simplified FCFF reinvestment-rate DCF form (`FCFF = NOPAT × (1 − reinvestment rate)`) and the standard two-stage Gordon-growth terminal value.
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
