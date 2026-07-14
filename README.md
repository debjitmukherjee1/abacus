# Abacus — The Analyst's Toolkit

*Six professional finance calculators, computed live in your browser.*

DCF builder with a WACC × terminal-growth sensitivity heatmap and a
football-field summary, a comps builder with quartile ranges and an
intrinsic/comps blend, a Black-Scholes-Merton options pricer with full
greeks and a payoff diagram, bond math (price ↔ yield, duration, convexity),
a WACC/CAPM calculator, and a compounding & SIP planner with goal-seek. No
data, no pipeline, no API keys — every number is arithmetic that runs
entirely on your own device.

> Fourth tool in the zero-cost GitHub-hosted finance suite, alongside
> **Meridian**, **MarketPulse** and **Ledger** — same architecture, same
> visual identity, styled to match them as a set. Abacus is also the suite's
> designated merge target: future small calculator ideas become new tabs
> here instead of new repos.

**→ Full plan & methodology:** [`docs/EXECUTABLE_PLAN.md`](docs/EXECUTABLE_PLAN.md)

## Cost: $0/day, zero Claude tokens, zero API calls at all
Abacus is simpler than its siblings: there's no daily job and no GitHub
Actions workflow, because there's no data to fetch. **Every formula runs as
plain JavaScript in the visitor's own browser** — Black-Scholes, bond
pricing, DCF, all of it. Nothing calls any external API or any LLM at
runtime, and nothing ever will, because there's nothing here for an API to
serve. Claude was only used to build it.

## How it stays free
- **Hosting:** GitHub Pages (static) — that's the entire stack
- **Compute:** the visitor's own browser
- **Data:** none. No fetch calls, no keys, no secrets, no cron

## Run it locally
```bash
cd site
python -m http.server 8000
# open http://localhost:8000
```
That's it — no build step, no `npm install`. `js/finmath.js` is a plain ES
module loaded directly by the browser.

## Run the tests
```bash
node --test tests/*.test.mjs
```
Node's built-in test runner, no dependencies to install. Asserts
`finmath.js` against known benchmark values — e.g. Black-Scholes-Merton
(S=100, K=100, r=5%, σ=20%, T=1 → call ≈ 10.4506), a 10-year 5% annual-coupon
bond priced at par (modified duration ≈ 7.72), and a hand-computed DCF case.

## Go live
1. Push this repo to GitHub (public). **No secrets to configure — there are
   none.**
2. Settings → Pages → deploy from `main` → `/site`.

That's the whole deployment. No workflow file, because there's nothing to
automate.

## Structure
```
docs/    → the executable plan
site/    → GitHub Pages root
  ├── index.html      ← six tabs: DCF, Comps, Options, Bonds, WACC/CAPM, SIP
  ├── css/styles.css  ← warm old-money theme (matches Meridian/MarketPulse/Ledger)
  ├── js/finmath.js   ← every formula, as pure functions — no DOM, fully testable
  ├── js/app.js       ← UI wiring, charts, URL-param state for the DCF tab
  └── favicon.svg
tests/   → node:test suite asserting finmath.js against known benchmarks
```

## Adding a new calculator
This is the suite's merge target: a new small calculator idea becomes a new
tab here, not a new repo. Add the formulas as pure functions to
`site/js/finmath.js`, benchmark-test them in `tests/`, then add a tab panel
and wire it up in `app.js`.

⚠️ Personal, educational tool — not investment advice, not a solicitation,
not SEBI-registered research. Every calculator states its own simplifying
assumptions inline (e.g. European exercise only for options, unlevered FCF
only for the DCF, a single flat discount rate for bonds). Read them before
trusting a number.
