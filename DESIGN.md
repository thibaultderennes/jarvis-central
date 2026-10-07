# Sentient Dash design rules

The site's look, written down so every change keeps it. Tokens live in `app/app/globals.css` (`:root`, then the dark
block under `prefers-color-scheme` and `[data-theme="dark"]`). Change a value there, never inline. Before shipping UI,
run the **VibeCoded Screening** on this project (Reviews → Screenings): it checks the tells these rules exist to avoid.

## Character
A working tool for one person, read many times a day. Quiet surfaces, dense but calm information, one warm signal.
It should look like a well-kept instrument, not a landing page: no decoration that doesn't carry information.

## Colour
| Role | Token | Light | Dark | Use |
|---|---|---|---|---|
| Page | `--ground` | `#ECEEF1` | `#0D1015` | the background behind panels |
| Panel | `--surface` / `--surface-2` | `#FFFFFF` / `#F5F6F8` | `#151920` / `#1B2029` | cards, tables / hover and inset fills |
| Text | `--ink` / `--ink-2` / `--ink-3` | `#12151B` / `#464D5A` / `#5F6674` | `#E8EBF0` / `#AEB5C2` / `#828A9A` | primary / secondary / muted |
| Lines | `--line` / `--line-2` | `#D5D9E0` / `#E7EAEE` | `#29303B` / `#1F242D` | borders / row dividers |
| Signal | `--signal`, `--signal-ink`, `--signal-soft` | amber `#E9A100` | `#F5B82E` | **"now" only**: today line, the next thing, the active nav dot |
| Status | `--doing`, `--done`, `--bad` (+ `-soft`) | | | in progress, done, late/critical. Always with a word or icon, never colour alone |
| Owners | `--own-you` / `--own-both` / `--own-claude` | slate `#2A3248` / `#59637B` / `#A0ABC5` | `#D3DEFA` / `#9AA4BE` / `#59637B` | "Who it's waiting on": one slate ramp (ordinal check in the dataviz validator), strongest on you, always with the legend |
| Projects | `--p1` … `--p7` | blue `#2B5FC7`, rust `#C2551B`, teal `#00968A`, plum `#8E44AD`, olive `#7A8A00`, magenta `#C23F78`, sky `#2E9BD6` | `#5A84E2`, `#CF6A39`, `#14A091`, `#A468C2`, `#8C9B18`, `#D45E8A`, `#3C9BD0` | a project's identity |

- Every text colour is at least **4.5:1** on `--ground`, `--surface` and `--surface-2` (muted `--ink-3` is 4.96:1 on the
  light ground). Check new pairs before using them.
- Amber, red and green are reserved (signal and status), so the project palette avoids them.
- The project palette passes the dataviz validator for **adjacent** slots in light and dark (lightness band, chroma,
  colour-blind separation ≥ 8, normal vision ≥ 15, 3:1 against the surface). Seven hues can't all be told apart in
  every pairing without red, green or amber, so **a project colour is always shown next to the project's name**
  (sidebar, legends, cards, timeline lanes); never identify a project by colour alone. Slots are given in order.
- No gradients on surfaces or text, no glows, no glass, no grain. Shadows only on floating layers (menus, drawer,
  palette), neutral and soft.

## Type
| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Page title | Archivo (`--display`) | `clamp(24px, 3.4vw, 32px)` / 800 | sentence case, `text-wrap: balance` |
| Panel title (`h2.ph-t`) | Archivo | 14px / 700 | sentence case, no letter-spacing |
| Body | Public Sans (`--body`) | 14.5px / 400, 600 for emphasis | |
| Labels (`.lbl`, sidebar groups, key/value keys) | Public Sans | 11–12px / 400–600 in `--ink-3` | **sentence case** |
| Numbers, dates, item codes, money | IBM Plex Mono (`--mono`) | 10.5–12px | `font-variant-numeric: tabular-nums` |
| Pills, verdicts, table headers | IBM Plex Mono | 10.5px, caps with light tracking | the only places caps are allowed |

No other fonts. No serif, no italic display accents, no emoji in headings or labels (a ✓ inside a control is fine).

## Spacing and shape
- **Spacing scale (4px base):** 4, 8, 12, 16, 20, 24, 32, 40. New code uses only these; the odd 7/9/11/13px paddings
  are migrated over time (checklist item `spacing-scale-tokens-and`).
- **Radius:** 4 (pills, inputs), 6 (buttons), 8 (cards, panels), 10 (floating layers). Nothing rounder except fully
  round dots and pills.
- Panels are bordered (`1px --line`), not shadowed.

## Illustrations
- The Map box (Home) is the one illustration exception to "tokens only": its world is drawn from Kenney's CC0 pixel
  tiles (`app/public/map`, see the README there). Everything on top of the tiles (labels, cards, flags, lights, focus)
  still uses the tokens.

## Icons and marks
- Icons come from `components/icons.tsx` (the Lane set): stroke icons drawn for this product, one weight. No icon
  library.
- Page titles show the bare glyph before the title, with no tile around it. Header drawings (`HeaderVec`) stay faint.
- The mark (lanes + amber dot) is the favicon, the app icon and the sidebar logo; `.word` is the only wordmark in caps.

## Motion
- Motion explains a change (a row moving, a panel opening, a drag ghost). Nothing fades in on scroll; nothing loops
  except the "worker online" dot.
- Durations 60–200ms. Every transition is switched off under `prefers-reduced-motion`.
- Buttons have designed states: hover (ink buttons step to `--ink-2`; ghost buttons and chips take `--surface-2`),
  pressed (settles 1px), focus (`:focus-visible` outline), disabled (45% opacity).

## Copy
- Plain, specific, second person ("you"). Say what happens and when: "Claude builds this on a branch and opens a PR".
- No hype or filler: no "seamless", "supercharge", "unlock", "effortless", "revolutionize", no "It's not X, it's Y",
  no reflexive groups of three, no exclamation marks.
- Em dashes are not used for rhythm. Use a colon, a comma or a full stop; "—" only as an empty-value placeholder.
- Never invent numbers, users, testimonials or logos. Every number on screen comes from the database.
- Sentence case everywhere; title case only for proper names.

## Before you ship UI
1. Use tokens only: colours, the spacing scale, the radii above.
2. Check light and dark, at phone width (≤ 600px) and desktop.
3. Keyboard: every action reachable, focus visible, no browser dialogs.
4. Run the VibeCoded Screening and fix anything it marks fail.
