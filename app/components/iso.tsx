// Isometric drawing helpers for the colony map: a grid point to screen, boxes, roofs and trees as plain SVG.
import type { PartKey } from "@/lib/villages";

export const TW = 40, TH = 20, ZH = 20, PLOT = 10, GAP = 3;
export type V2 = readonly [number, number];
export const P = (x: number, y: number, z = 0): V2 => [(x - y) * TW / 2, (x + y) * TH / 2 - z * ZH];
export const pts = (...a: V2[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
export const NAME: Record<PartKey, string> = { hall: "Checklist", police: "Security", bank: "Money", shop: "Growth", homes: "Customers", workshop: "Builds" };
export const ORDER: PartKey[] = ["hall", "workshop", "police", "bank", "shop", "homes"];

export function Box({ x, y, w, d, h, z = 0, c }: { x: number; y: number; w: number; d: number; h: number; z?: number; c: string }) {
  const t = z + h;
  return (
    <g className={c}>
      <polygon className="f-r" points={pts(P(x + w, y, t), P(x + w, y + d, t), P(x + w, y + d, z), P(x + w, y, z))} />
      <polygon className="f-l" points={pts(P(x, y + d, t), P(x + w, y + d, t), P(x + w, y + d, z), P(x, y + d, z))} />
      <polygon className="f-t" points={pts(P(x, y, t), P(x + w, y, t), P(x + w, y + d, t), P(x, y + d, t))} />
    </g>
  );
}
export function Roof({ x, y, w, d, z, h, c }: { x: number; y: number; w: number; d: number; z: number; h: number; c: string }) {
  const a = P(x + w / 2, y + d / 2, z + h), o = 0.15;
  return (
    <g className={c}>
      <polygon className="f-r" points={pts(P(x + w + o, y - o, z), P(x + w + o, y + d + o, z), a)} />
      <polygon className="f-t" points={pts(P(x - o, y + d + o, z), P(x + w + o, y + d + o, z), a)} />
    </g>
  );
}
export function Tree({ x, y, s = 1, v = 0 }: { x: number; y: number; s?: number; v?: number }) {
  const [sx, sy] = P(x, y);
  return (
    <g className={`c-tree tv${v % 3}`}>
      <rect className="trunk" x={sx - 1.5} y={sy - 6 * s} width={3} height={6 * s} />
      <polygon className="f-t" points={`${sx - 9 * s},${sy - 5 * s} ${sx},${sy - 34 * s} ${sx},${sy - 3 * s}`} />
      <polygon className="f-r" points={`${sx + 9 * s},${sy - 5 * s} ${sx},${sy - 34 * s} ${sx},${sy - 3 * s}`} />
      <polygon className="snowcap" points={`${sx - 4 * s},${sy - 21 * s} ${sx},${sy - 34 * s} ${sx + 4 * s},${sy - 21 * s}`} />
    </g>
  );
}
