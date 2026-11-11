# The Map: plan

The Map draws every project as a settlement on one isometric colony map (`app/components/Colony.tsx`,
`ColonyStage.tsx`, `MapView.tsx`; rules in `app/lib/villages.ts` and `app/lib/map.ts`). This file is the living plan:
what the map is for, what is built, what comes next, and the evidence behind the choices. Update it with every round.

## Status
Beta. The map ships as its own tab under Home with a "Beta" pill, and is not a Home box, so Home stays fast while
the map is tried out on real data. It leaves beta when the review loop below finds nothing slow or unclear for two
rounds in a row, the screen-reader pass is done and the VibeCoded Screening has no fails.

## What it is for
One look answers three questions: which project needs me, why, and what do I do about it. The map is a second way
into the same data as the checklists. It is never the only way: the card list under it says the same things in text.

## Rules the map keeps
1. **Every mark is data.** A building, a crate, a wagon or a cloud stands for something in the database. Decoration
   that could be mistaken for a signal is not added.
2. **Words carry the facts.** The picture draws the eye; banners, the panel, hover labels and the list say it.
3. **Nothing earned is taken away.** Overdue work never shrinks a settlement. The town hall, the landmark and the
   shipments only grow. The loud marks (fire, storms) can be turned off with "Calm map".
4. **Missing data is an empty lot,** never a ruin or a failure.
5. **You can act where you look.** If the map shows a problem, the fix is one click from there.
6. **Motion is optional.** "Pause" and the system's reduced-motion setting stop it all.

## Built
| Area | What |
|---|---|
| Scene | Terrain (mountains, river, lake, forest), walled settlements, six buildings per project, crates for open items, fields, villagers, landmarks, seasons, weather, day and night |
| Read | Banners, hover labels, the command panel, a minimap, lenses (deadlines, activity, money, security, growth), villager thoughts, a chronicle of the last 7 days |
| Act | Click a crate: mark done, move the date, give to Claude. Record numbers for the market and homes. Free land opens Admin. The courier opens the inbox |
| Navigate | Drag, zoom, double-click, "Whole map", "Next that needs you" (N), number keys, arrow keys |
| Time | A slider and replay over the last 8 weeks, rebuilt from item dates; a trend chart per settlement |
| Claude | At the anvil while a build runs, at the gate with a note when a pull request waits, puzzled when a build stopped |
| Yours | Shipments: weeks with on-time work unlock a landmark, a square and banners per settlement. Pin up to three settlements side by side. Settings: calm map, chime, hemisphere, light |
| Access | Keyboard order (settlements first, then the selected one's buildings), spoken selection, visible focus, the list twin, detail culling when zoomed out |

## Next
| # | What | Why |
|---|---|---|
| 1 | **You on the map**: your figure stands in the settlement today's plan has you working on now, and walks when the block changes | Ties the map to Today and the calendar: "where am I supposed to be" at a glance |
| 2 | **First-run tour**: three steps the first time (select, lens, act), skippable | The map has many controls and no introduction |
| 3 | **The weekly gazette**: the Monday recap as a one-page newspaper opened from the map, with the week's wagons, storms and shipments | Reviews are the strongest "why"; today only a scroll icon points at them |
| 4 | **Sprints as scaffolding**: a sprint in progress shows as a building site with its end date | Sprints exist in the data and are invisible here |
| 5 | **Costs as caravans**: recurring costs leave by the road each month; revenue arrives | Makes the Money lens readable without numbers |
| 6 | **A bottom sheet on phones**: the panel slides over the map instead of sitting under it | On a narrow screen the panel is a long scroll away |
| 7 | **A snapshot to share**: export the colony as an image, with a demo mode that swaps private names | Feeds the weekly recap and the public demo |
| 8 | **Screen-reader pass with a real reader**, and a contrast check of the scene palette in all four seasons, day and night | Keyboard and announcements are built but untested with assistive tech |

## Later
- More than nine projects: a second ring of land, or continents per group, and a canvas renderer if the scene grows
  past about fifteen settlements (it is about 3,200 drawing elements and 120 animations at seven).
- Connected metric sources per project, so the market and homes fill without typing.
- Per-install settings for hemisphere and working hours in `jarvis.config.json` (today they are per browser).
- Visual regression: a stored screenshot per season and light, compared in CI.
- Ambient sound, off by default.

## The review loop
Every round of map work ends with the same pass, and its findings go into "Next":
1. Look at the whole map, then one settlement close up, in day and night, on a wide and a narrow screen.
2. Use it for a real task: find what needs you, act on one item, check one lens, go back two weeks.
3. Write down the three things that were slowest or least clear. Fix those first next round.
4. Check the rules above still hold for everything added.
5. Count drawing elements and animations; note them here if they moved by more than a fifth.

## Evidence
- A city view can beat tables for understanding a system: in a controlled experiment with 41 participants, a
  city-metaphor view of software made people faster and more accurate (Wettel, Lanza, Robbes, ICSE 2011).
- Gamified engagement dips after about four weeks and can recover; a 275-day gym study found it kept working, more so
  when personalised. That is why shipments are earned choices, not points.
- Penalties backfire: a two-study paper on a gamified task manager found its reward and penalty design often had the
  reverse effect (Diefenbach and Müssig, 2019). That is rule 3.
- City builders fail when the player cannot see why something happens; overlays and short history charts are the
  usual fix. That is the lenses, the villager thoughts and the trend chart.
- Accessible maps need every action on the keyboard, changes announced after the movement ends, and a non-map
  alternative. That is the keyboard order, the spoken selection and the list twin.
- Feedback should land within about 100 ms and motion should ease. That is the crate lifting off before the server
  answers.
- Rough guidance puts the comfortable limit for animated SVG between 200 and 1,000 elements. That is why detail is
  culled when zoomed out and why a canvas renderer is in "Later".
