# Map tiles

The Map box on Home (`components/Villages.tsx`) draws its pixel world from these tilemaps, all by Kenney
(www.kenney.nl), released under Creative Commons Zero (CC0 1.0, public domain). Each folder keeps the pack's own
`License.txt`. Only each pack's spaced tilemap (`tilemap.png`: 16 × 16 px tiles with a 1 px gap) is kept here, unmodified.

| Folder | Pack | Source | Used for |
|---|---|---|---|
| `tiny-town/` | Tiny Town 1.1 | https://kenney.nl/assets/tiny-town | grass, forest, trees, buildings, fences, paths, signs |
| `tiny-battle/` | Tiny Battle | https://kenney.nl/assets/tiny-battle | the river (same style family, Tiny Town has no water) |
| `tiny-dungeon/` | Tiny Dungeon | https://kenney.nl/assets/tiny-dungeon | the bridge planks and the "you" character |

Tile indexes count from 0, left to right, top to bottom. Colours drawn on top of the tiles (flags, lights, fire,
labels, cards) come from the design tokens in `app/globals.css`.
