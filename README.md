# Advisor Fee Calculator

A small calculator for the Prof of Wall Street website. A visitor enters their
account value, all-in fee and a number of years, and picks a benchmark. It shows
what their fees cost over time against a low-cost option in that benchmark, in
future dollars and in today's dollars.

- **Runs in the visitor's browser.** Nothing they type is sent or stored.
- **No server, no database, no dependencies.** One JavaScript file.
- **Built for Webflow**, but works on any web page.

It measures **fee drag only**. Whether the advisor's investing beat its
benchmark needs the client's actual returns. That is the paid Full Review, or a
later "Level 2" version of this calculator.

## What's in the repo

| Path | What it is |
|---|---|
| `src/fee-calculator.js` | The calculator: the math, plus the code that connects it to the page |
| `src/fee-calculator.css` | Optional starter styles (for the quick embed and the demo) |
| `embed/calculator-markup.html` | The calculator's HTML, ready to paste into a Webflow Code Embed |
| `demo/index.html` | A test page. Open it in a browser to try the calculator locally |
| `test/calculate.test.js` | Checks the math against known answers |

## The math

For each year: grow the balance at the benchmark's return before fees, then
subtract the fee. No further deposits or withdrawals.

- Value at your cost = balance × ((1 + return) × (1 − your fee))^years
- Value at low cost = balance × ((1 + return) × (1 − low-cost fee))^years
- Cost of your fees = the difference between the two
- In today's dollars = that difference ÷ (1 + 2%)^years

## Assumptions (illustrative, review before launch)

| Benchmark | Return before fees | Low-cost fee |
|---|---|---|
| S&P 500 (`sp`) | 7.0% | 0.09% |
| NASDAQ-100, QQQ (`qqq`) | 8.0% | 0.20% |
| 60/40 portfolio (`bal`) | 5.5% | 0.22% |
| Cash (`cash`) | 3.0% | 0.11% |

Inflation for "today's dollars": 2%.

These are long-run estimates set for illustration, not forecasts. Change them
in `DEFAULTS` at the top of `src/fee-calculator.js`, or on Webflow through the
CMS (below) without touching code.

## Putting it on Webflow

Custom code needs a paid Webflow Site plan. Custom code does not run in the
Designer; check it on the published staging site (yoursite.webflow.io).

### Step 1: put this repo on GitHub (public)

jsDelivr, a free file service, can only serve files from a **public** repo.

### Step 2: add the script to the page

Page settings → Custom code → **Before `</body>` tag**:

```html
<script src="https://cdn.jsdelivr.net/gh/CognizantlyInc/advisor-fee-calculator@v0.1.0/src/fee-calculator.js"></script>
```

Use a version tag (`@v0.1.0`) rather than `@main`, so the live site only
changes when you publish a new version on purpose (see Releasing a change).

### Step 3, Option A: quick test with a Code Embed

1. Add a **Code Embed** element where the calculator should go.
2. Paste in `embed/calculator-markup.html`.
3. Also add this line to the page's custom code, **inside `<head>`**:
   ```html
   <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/CognizantlyInc/advisor-fee-calculator@v0.1.0/src/fee-calculator.css">
   ```

### Step 3, Option B: build it with Webflow elements (recommended)

Design the calculator in the Designer like any other section. Then give
elements these **custom attributes** (Element settings → Custom attributes):

| Element | Attribute name | Value |
|---|---|---|
| The section or div that wraps the whole calculator | `data-calc-root` | *(leave empty)* |
| Account value input | `data-calc` | `balance` |
| All-in fee input (in %) | `data-calc` | `fee` |
| Years input | `data-calc` | `years` |
| Each benchmark button | `data-calc-benchmark` | `sp`, `qqq`, `bal` or `cash` |
| Any text to fill in | `data-calc-out` | one of the output names below |

Output names for `data-calc-out`:

| Value | Shows |
|---|---|
| `fee-this-year` | Fees in dollars this year |
| `value-at-fee` | Projected value at the visitor's fee |
| `value-at-low-cost` | Projected value at the low-cost fee |
| `gap` | Cost of their fees (future dollars) |
| `gap-today` | Cost of their fees in today's dollars |
| `fees-paid` | Total fees paid over the period |
| `years` | Years used |
| `benchmark-name`, `benchmark-label`, `benchmark-fee`, `benchmark-return`, `benchmark-note` | Details of the chosen benchmark |

Optional attributes on the wrapper:

- `data-calc-default` = `sp` (the benchmark selected on load)
- `data-calc-inflation` = `0.02` (the inflation rate for today's dollars)

**Styling the selected button:** the script adds the class `is-selected` to the
chosen benchmark button. In the Designer, create a combo class `is-selected` on
your button class and style it (for example, navy background, white text).

**Webflow forms:** Webflow only allows input fields inside a Form block. That is
fine: the script stops the form from submitting when someone presses Enter. Use
a *separate* Webflow form for the email sign-up.

### Step 4 (optional): edit assumptions in the Webflow CMS

1. Create a CMS Collection **Benchmarks** with fields: Key (text: `sp`, `qqq`,
   `bal`, `cash`), Name, Label, Return % (number, e.g. `7`), Low-cost fee %
   (number, e.g. `0.09`), Note.
2. Show them with a Collection List, using a button for each item.
3. On the button, add custom attributes bound to the CMS fields:
   `data-calc-benchmark` → Key, `data-return` → Return %, `data-fee` →
   Low-cost fee %, `data-name` → Name, `data-label` → Label, `data-note` → Note.

Percentages are entered as percent numbers: `7` means 7%, `0.09` means 0.09%.
Anything left blank falls back to the defaults in the script.

### Step 5: track use (optional)

Every recalculation fires a `feecalc:update` browser event with the results,
so analytics can count how many visitors used the calculator.

## Releasing a change

1. Edit the code and run `npm test` (needs Node 18 or later).
2. Commit, then tag a new version: `git tag v0.1.1 && git push --tags`.
3. In Webflow, change `@v0.1.0` to `@v0.1.1` in the script line and publish.

## Testing

```
npm test
```

The tests check the math against independent calculations, including the
20-year projection on the sample report ($1.92M at 2.2% against 0.09%: $2.54M
in future dollars, $1.71M in today's dollars).

To try the page: open `demo/index.html` in a browser.

## Disclaimer

For education only. Not investment advice. Results are estimates based on the
assumptions above.
