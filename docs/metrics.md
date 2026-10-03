# Project stats: product metrics and delivery

The project page's **Stats** view has two parts.

- **Product**: users, active users, visitors, revenue, expenses and cost per user, each with its change against a
  week earlier and a sparkline, plus users and visitors over time. The numbers come from *snapshots* you record by
  hand or that the Mac agent fetches from a source you declare. Expenses come from the project's recurring costs
  (Finances); when the project has a unit-economics model ([`unit-economics.md`](unit-economics.md)), the model's
  monthly cost at the current user count is shown beside them.
- **Delivery**: flow metrics computed from the checklist (nothing to set up), described at the end.

The Monday project review gets the last snapshot of each of the last 8 weeks and the recurring costs, so advice can
cite numbers.

## Why these numbers

A solo product needs one primary number and a handful of secondary ones, read week over week (YC's Startup School
asks for weekly growth of the primary metric; 5–7 % a week is good early on). The set below covers the funnel
(visitors → signups → activated → active → paying) and the money (revenue against costs):

- **Active users / users** tells whether people come back (a16z/Andrew Chen look at active over registered and
  DAU/MAU-style stickiness; flat, low engagement is the red flag, not a small total).
- **Signups / visitors** is the landing page's conversion; **activated / signups** is onboarding.
- **MRR, paying users and ARPU** (MRR ÷ paying), the SaaS basics (Baremetrics, ProfitWell); **revenue** over 7 days
  for one-time sales.
- **Cost per active user** and **net per month** (MRR − expenses) say whether growth makes the product cheaper or
  dearer to run.

## Metric keys

A snapshot is one JSON object of numbers per project per day. Use these keys when the number exists; any other
lowercase key (`a-z`, `0-9`, `_`, up to 40 characters) is kept and listed under "Other numbers".

| Key | Kind | Meaning |
|---|---|---|
| `users` | level | Accounts (or customers) in total on the day |
| `active_users` | level | Users active in the last 7 days (WAU) |
| `paying_users` | level | Customers paying on the day |
| `mrr` | level | Monthly recurring revenue on the day (in your Finance currency) |
| `signups` | 7-day total | New accounts in the 7 days up to the day |
| `activated` | 7-day total | Of those, how many reached your activation step (first call, first project…) |
| `visits` | 7-day total | Unique visitors in the 7 days up to the day |
| `revenue` | 7-day total | Money collected in the 7 days up to the day (one-time sales) |
| `churned` | 7-day total | Paying users lost in the 7 days up to the day |

Levels are read on the day; totals always cover the trailing 7 days, so a daily and a weekly snapshot compare the
same thing. The arrows on the page compare the latest snapshot with the newest one at least 7 days older.

## Recording numbers by hand

```
node agent/jarvis.mjs metrics my-app --set users=120 --set active_users=45 --set visits=900
node agent/jarvis.mjs metrics my-app --set mrr=380 --date 2026-09-28    # an earlier day
node agent/jarvis.mjs metrics my-app --set mrr=                         # remove a key from today's snapshot
node agent/jarvis.mjs metrics my-app [--days 90] [--json]                # list snapshots
```

Several calls on the same day merge into one snapshot. Once a week is enough for trends.

## Connecting a source

Add the project under `metrics.sources` in `jarvis.config.json` (never in git). The worker runs every source once a
day (`metrics.sync_minutes`, default 1440) and posts the result as today's snapshot; `node agent/metrics.mjs sync
[--project id] [--dry-run]` runs it now.

```json
"metrics": {
  "sources": {
    "my-app": { "url": "https://my-app.example/api/metrics", "token_env": "MY_APP_METRICS_TOKEN" },
    "my-site": {
      "url": "https://plausible.io/api/v1/stats/aggregate?site_id=my-site.example&period=7d&metrics=visitors",
      "token_env": "PLAUSIBLE_API_KEY", "map": { "visits": "results.visitors.value" }
    },
    "my-channel": { "command": "python3 scripts/metrics.py", "map": { "visits": "views_7d" } }
  }
}
```

- **`url`**: fetched with GET. With `token_env`, the token is read from that environment variable (your shell or
  `~/.config/jarvis/env`) and sent as `Authorization: Bearer <token>`; set `header` to send it raw under another
  header name (e.g. `"X-Api-Key"`). Only env var *names* go in the config.
- **`command`**: run with the shell in the project folder (time limit `metrics.timeout_seconds`); it must print a
  JSON object. It gets your environment and `~/.config/jarvis/env`, minus the Jarvis agent token.
- **`map`** (optional): metric key → dotted path into the JSON (`"results.visitors.value"`, `"items.0.count"`).
  Without it every top-level number is taken (or every number under `metrics` when the object has one); a
  `{"value": n}` object counts as `n`.

The easiest source is an endpoint in your own app that returns the standard keys directly, e.g.
`{"users": 312, "active_users": 95, "signups": 31, "paying_users": 17, "mrr": 323}`. Keep it behind a secret token.

## Delivery

Computed from the checklist on every visit; the choice follows Kanban flow metrics (throughput, cycle time, work-item
age, Monte Carlo forecasting) and Linear's project graph (scope added vs completed).

| Number | What it is |
|---|---|
| Throughput | Items finished per week, average of the last 4 full weeks, against the 4 before; sparkline of 12 weeks |
| Lead time | Median days from adding an item to finishing it (items finished in the last 8 weeks), and the 85th percentile |
| Age of open work | Median days since open items were added, and how many are older than 30 days |
| Overdue | Open items past their due date, and how late the oldest is |
| Scope · 4 weeks | Items added minus items finished over the last 4 weeks and this one (positive = the list is growing) |
| Forecast | For the next milestone in PRD.md: the open items due by it (all open items when none is dated before it), simulated 2,000 times by drawing weekly throughput from the last 8 weeks. 50 % and 85 % dates; on track when the 85 % date is on or before the milestone, at risk when only the 50 % date is, off track otherwise |

Below them: the oldest open items (work that ages is usually stuck) and added vs finished per week for 12 weeks.
Day-by-day detail stays on the Stats page (`/stats?proj=<id>`).
