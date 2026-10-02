# Unit-economics models

A project's **Finances** tab can show its unit economics, not only its recurring costs: monthly profit by number of
users (one line per vendor option, with decision thresholds marked), a profit grid of users × usage, the margin per
subscriber on each plan (monthly and yearly billing), and the cost lines split into fixed and growing with users.
Controls on the page pick the vendor option, plan mix, usage, plan, users and one project-specific driver.

The numbers come from a **model file in the project's own folder**. The website runs on Vercel and can't read
project folders, so the Mac agent (`agent/economics.mjs`) evaluates the model over its whole grid and uploads the
results; the page only picks among those precomputed points. Nothing about a particular project lives in Jarvis.

## Opting a project in
Add a model file to the project folder. The first of `economics.files` that exists is used (default
`jarvis.economics.mjs`, `jarvis.economics.cjs`, `jarvis.economics.js`, at the project root). To keep it elsewhere, map
the project id to a path in `jarvis.config.json`:

```json
"economics": { "models": { "my-app": "docs/finance/jarvis.economics.cjs" } }
```

The worker evaluates every model once an hour (`economics.sync_minutes`) and uploads it only when the result
changed. To see it at once: `node agent/economics.mjs sync --project my-app` (`--dry-run` evaluates without
uploading), or `node agent/economics.mjs eval path/to/model` to print what the site would receive. Each model runs in
its own Node process with a time limit (`economics.timeout_seconds`); if it throws, the Finances tab keeps the last
good result and shows the error.

Use `.cjs` when the model `require()`s CommonJS files, `.mjs` for ES modules. A plain `.js` file follows the
project's `package.json` `"type"`.

## What the file exports
One object (as `module.exports`, `export default`, or named exports). Only `scenario` is required.

| Export | Type | Meaning |
|---|---|---|
| `scenario(point)` | function, may be async | **Required.** Prices one month at one grid point. `point = {option, users, usage, mix, driver}`. Returns `{revenue, lines: {lineId: monthlyCost, …}, total?}`; `total` defaults to the sum of `lines`. |
| `plan(point)` | function, may be async | Margin of **one subscriber** on one plan. `point = {option, plan, usage, driver, yearly}`. Returns `{revenue, cost}` per month (for `yearly: true`, the yearly price ÷ 12). Needed for the margin table. |
| `options` | `[{id, label}]` | Vendor or stack options compared as lines (e.g. two telephony providers). Default: one option. |
| `plans` | `[{id, label, price, yearly?}]` | Paid plans: monthly price, and yearly price when there is one. |
| `mixes` | `[{id, label}]` | Plan mixes the page can switch between (e.g. "all on the cheapest plan", "70% free"). Default: one. |
| `users` | `number[]` | User counts on the x axis and grid rows. Default `[0, 10, 25, 50, 100, 250, 500]`. |
| `usage` | `number[]` | Share of the plan allowance used, `0.5` = 50%. Grid columns. Default `[1]`. |
| `driver` | `{id, label, unit?, values: number[], default?}` | One extra input specific to the project (e.g. messages per session). Optional. |
| `thresholds` | `[{users, label}]` | Vertical markers on the profit chart (e.g. the user count where you switch vendor). `threshold` (one object) also works. |
| `defaults` | `{option, mix, usage, driver, plan, users}` | What the controls show first. |
| `fixed` | `string[]` | Line ids that are fixed costs. When absent, a line that doesn't change between the smallest and largest non-zero user count counts as fixed. |
| `lineLabels` | `{lineId: label}` | Readable names for cost lines. |
| `title`, `currency`, `note` | strings | Section title (default "Unit economics"), ISO currency (default `USD`), one line under the controls. |

The grid is `options × mixes × usage × driver values × users`, at most 50,000 `scenario` calls. Keep it to the
points you'd actually compare; a few hundred is typical.

## If your model has a different shape
Don't reshape the model: add a small adapter that `require`s or `import`s it and maps it onto the exports above.

```js
// jarvis.economics.cjs — adapter for an existing cost model
const model = require('./docs/finance/cost-model.js'); // your own functions, unchanged

module.exports = {
  currency: 'USD',
  options: [{ id: 'a', label: 'Vendor A' }, { id: 'b', label: 'Vendor B' }],
  plans: [{ id: 'basic', label: 'Basic', price: 9, yearly: 90 }, { id: 'pro', label: 'Pro', price: 29, yearly: 290 }],
  mixes: [{ id: 'all-basic', label: 'All Basic' }, { id: 'blend', label: '70% free · 30% paid' }],
  users: [0, 25, 50, 75, 100, 200, 500],
  usage: [0.5, 0.75, 1],
  driver: { id: 'sessions', label: 'Sessions per user per day', values: [1, 2, 4], default: 2 },
  thresholds: [{ users: 75, label: 'Switch to vendor B' }],
  fixed: ['hosting', 'domains'],
  scenario: ({ option, users, usage, mix, driver }) => {
    const r = model.monthly(option, users, { usage, mix, sessions: driver });
    return { revenue: r.revenue, lines: r.costLines };
  },
  plan: ({ option, plan, usage, driver, yearly }) => {
    const r = model.perSubscriber(option, plan, { usage, sessions: driver, yearly });
    return { revenue: r.revenue, cost: r.cost };
  },
};
```

## What the site receives
`PUT /api/agent/economics {project_id, file, sha, data}` stores it in `kv` under `economics.<project id>` (a failed
run sends `{project_id, file, error}` and keeps the last good `data`). `data`:

```
{ v: 1, title, currency, note, options, mixes, plans, users, usage, driver, thresholds, defaults,
  lines: [{id, label, fixed}],
  grid:     { "<option>.<mix>.<usage>.<driver>": [[revenue, total, ...one cost per line] per users value] },
  planGrid: { "<option>.<usage>.<driver>":       [[monthly revenue, monthly cost, yearly revenue/12, yearly cost/12] per plan] } }
```

Keys are indexes into the lists (`driver` index 0 when there is no driver); money is rounded to cents.

Later, actual spend from connected accounts can stand in for modelled spend; the model stays the source for what-ifs.
