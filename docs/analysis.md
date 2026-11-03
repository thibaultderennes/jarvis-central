# Analysis reports

Many projects already run their own analysis job: a stats digest posted to a chat channel, a weekly growth review, an
ads report. Product metrics ([`metrics.md`](metrics.md)) hold the numbers; an **analysis report** holds what the job
*concluded* from them, so it can sit on the project page instead of only in a chat channel.

- The newest report from each job shows at the top of the project's **Stats** view: its headline, headline numbers,
  charts (with dated markers) and a link to the full text.
- **Connected tools** lists every tool the reports read from or post to (YouTube Analytics, Stripe, Discord…), with
  the status and date of the last report that named it, plus the product-metrics feed when there is one.
- Every report is under **Docs and reviews → Analyses**, with Mark as read like any other report.

Nothing is project-specific: a new project needs a report file, not code.

## Posting a report

```
node agent/jarvis.mjs analysis my-channel --file report.json   # post (same source + date updates it)
node agent/jarvis.mjs analysis my-channel [--json]             # list
```

Or `POST /api/agent/reviews` with `{type: "doc", project_id, title, headline, body_md, meta: {kind: "analysis", …}}`.
Post it from the job itself, right after it writes its chat message, so the page and the channel say the same thing.

## The format

```json
{
  "title": "Biweekly stats digest",
  "headline": "One or two sentences: the conclusion.",
  "body_md": "The full report, in Markdown.",
  "source": "stats-digest",
  "date": "2026-10-21",
  "period": { "from": "2026-09-23", "to": "2026-10-21" },
  "numbers": { "views_28d": 8267, "avg_view_pct": 44.5 },
  "series": [
    { "key": "a_retention", "label": "Channel A", "chart": "Retention by publish week", "unit": "pct",
      "points": [{ "x": "2026-09-07", "v": 57.5, "n": 980 }, { "x": "2026-09-14", "v": 44.5, "n": 1430 }] }
  ],
  "markers": [{ "x": "2026-09-14", "label": "Voice change first airs" }],
  "tools": [
    { "name": "YouTube Analytics", "role": "source", "detail": "28-day window", "status": "ok" },
    { "name": "Discord", "role": "destination", "detail": "#monthly-review" }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Shown as the report's name |
| `source` | yes | The job's name (`a-z`, `0-9`, `-`, `_`). Reports from one source form a history; the Stats view shows the newest |
| `date` | no | The report's own date (default: the day it's posted). Same source and date = the same report |
| `headline`, `body_md` | no | The conclusion, and the full text |
| `period` | no | The window the numbers cover |
| `numbers` | no | Up to 24 headline figures, keys like `views_28d` |
| `series` | no | Up to 12 dated series of up to 400 points. Series with the same `chart` share one chart. `unit`: `n` (default), `pct`, `days`, `money`. `n` on a point is its size (how many videos, users…) |
| `markers` | no | Dated events drawn on every chart |
| `tools` | no | What the job read from (`role: "source"`, the default) and posted to (`"destination"`). `status`: `ok`, `degraded`, `failed`; `note` says why |

Anything invalid is dropped (a point without a date, a duplicate key), and the rest is kept.

## Cohorts, not blended windows

When a change reaches people some time after it ships (content queued for days, a release that rolls out slowly), a
trailing 28-day average mixes work from before and after the change and can point the wrong way. Post the series by
cohort instead: x is the cohort's start (the publish week, the signup week), v its value, n its size. Add a marker for
the day the change first reached people, so the chart shows which cohorts it applies to.

See `agent/fixtures/analysis-channel.json` (a video channel's digest) and `agent/fixtures/analysis-saas.json` (a
SaaS growth review): two different projects, the same page.
