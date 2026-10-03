# Today and Week — design notes

Why these two pages look the way they do (0.5.0 rework), what they leave out, and how to tell whether the rework
worked. Instance-neutral: nothing here depends on a particular owner's projects.

## What the pages are for
Today answers "what do I do next, and what do I do about what slipped?". Week answers "does the week fit, and
what is already late before it starts?". Both must let you finish or move an item in one action, without opening
the project page.

## What comparable products do
Short notes from memory, not a survey; used only to pick sensible defaults.

| Product | Grouping / ordering | Overdue | Capacity vs load | One-action complete |
|---|---|---|---|---|
| Todoist (Today / Upcoming) | Overdue section pinned above today's tasks; tasks in manual order, sections per project | Separate "Overdue" block with a "Reschedule all" action | None built in (task count only) | Circle checkbox on every row |
| Things (Today / Upcoming) | Today mixes calendar events and tasks; "This Evening" as a second bucket; Upcoming grouped by day | Overdue tasks simply join Today, flagged red | None | Checkbox; swipe to move to another day |
| Sunsama | One day per column, calendar beside it; drag tasks between days and into time slots | Yesterday's unfinished tasks are rolled over during the morning ritual | Planned minutes per task summed against the day; warns when the day is over | Checkbox; a daily "shutdown" reviews leftovers |
| Linear (My Issues) | Grouped by status, sorted by priority then due date; dense rows | Due date turns red; no separate section | None (cycle capacity lives elsewhere) | Status change from the row |
| Motion | Auto-schedules tasks into calendar gaps by priority and deadline | Re-plans automatically; shows "at risk" deadlines | The schedule itself is the capacity model | Checkbox; the plan re-flows |
| TickTick | Today / Next 7 days; smart lists; sections per priority | Overdue block at the top with reschedule | Pomodoro/time tracking, not planning | Checkbox |

Patterns worth copying: an overdue block pinned above the day (Todoist, TickTick, Sunsama's rollover), critical
first (Linear), a visible load-vs-capacity figure per day (Sunsama, Motion), completion from the row everywhere,
and calendar events in the same column as the work (Things, Sunsama).

## Layouts considered

**Today**
1. *Single column agenda*: calendar events and todos interleaved by time, backlog in a drawer. Rejected: most
   todos have no time, so the interleaving is mostly noise.
2. *Three panels with a decision strip* (0.5.0): Calendar | list with a "Decide now" strip | Backlog. Replaced in
   0.6.0: the owner found it too busy to tell what to do next (three panels open at once, the same item in the
   strip and the backlog, a paragraph of instructions).
3. *One list, an agenda rail, "Later" folded* (0.6.0, built). The page answers "what do I do next, and am I on
   track today?". Header: day, "N of M done", a load meter "~H h of C h focus" (`JARVIS_FOCUS_MINUTES`, default
   360) that turns red when over. One ordered list: the day's todos (drag or Alt+↑/↓ to reorder) followed by
   checklist items due that day that aren't on the list yet; the first open row is "Next up". One click ticks;
   →, a date, ↓ (someday) and × sit on the row (behind ⋯ on a phone); done rows fold into "Done (N)". Quick add:
   Enter saves, "14:00 call the bank" sets the time, time and project also behind "More". The agenda rail shows
   calendar events and timed todos (the Sunday plan's blocks) on an hour grid with a now-line; below 1060 px it
   becomes a one-line strip under the list that opens on tap. Everything else is in a closed "Later" disclosure
   with counts: overdue (✓ Done · + Today · → Tomorrow), what the week's plan couldn't fit (+ Today), coming up
   in two weeks or in progress (project chips, + Today), and Someday todos.

**Week**
1. *Day columns only*, with due items and todos, as before. Rejected: what was already late was invisible unless
   you opened the backlog, and there was no way to see that Wednesday was overloaded.
2. *Overdue strip + day columns with a load bar* (built): an "Overdue (N)" strip above the grid with ✓ Done ·
   → Today · → next Monday; each day shows events, then due items (critical first, done struck, cancelled hidden,
   ✓ on hover), then todos undone first, and a load bar (due items plus todos linked to items, estimates summed,
   60 min when unknown) against the same capacity.

Load counts an item once even when it is both due that day and on the list as a todo. Personal todos without a
linked item count as zero minutes: they have no estimate, and inventing one would make every day look full.

## What each page shows and leaves out

Today shows: the list with its load, the agenda, and (folded) overdue, plan leftovers, the next two weeks and
Someday. It leaves out: dragging backlog items onto the list (use + Today), dragging todos into Someday (use ↓),
habits, and anything without a due date that is not in progress.

Week shows: the Sunday plan summary; the overdue strip; seven days with events, due items, todos and load; the
backlog. It leaves out: multi-week views, and a re-flow of the plan when a day is over capacity (the planner
runs on Sunday; the bar tells you to move something by hand).

Shared with the checklist: "open" means todo or in progress (done and cancelled are closed everywhere), and
finishing an item from a strip is the same status change as ticking it on the project page (its linked todos
follow). The checklist filters (show completed, owner, due range) are not on these pages on purpose: the board
is already filtered to what is due.

## Checking whether it worked
After a week of use, ask the owner one question and record the answer in the Jarvis review: "Can you find and
finish tasks faster on Today and Week than before?" Useful evidence next to the answer: how often the strips
were used (`activity` rows `item_status` from `/today` and `/week`, `item_due` moves), whether overdue counts
fell week over week (`GET /api/agent/stats`), and whether days went over capacity less often. If the answer is
no, the likely next steps are per-project caps in the load line and a rollover prompt in the morning.
