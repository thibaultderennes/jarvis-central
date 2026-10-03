// Sentient Dash identity pieces (see components/icons.tsx for the shared lane language). Subtle by design: the amber
// "now" dot appears once per header, the vectors are faint and hide on narrow screens.
import { Icon, type IconName } from "./icons";

/** Small tile with the page's icon, placed inside an h1.page. */
export function Glyph({ n }: { n: IconName }) {
  return <span className="glyph" aria-hidden="true"><Icon n={n} size={18} /></span>;
}

// 212x56 line drawings: what each page is about, in lanes. "h" = hairline, "dot" = the amber now dot.
const VEC: Record<string, string> = {
  home: '<path d="M20 14h70M20 28h120M20 42h50" class="h"/><path d="M150 28h30"/><circle cx="192" cy="28" r="5" class="dot"/>',
  today: '<path d="M8 28h150M30 20v16M60 22v12M90 22v12M120 22v12M150 22v12" class="h"/><path d="M8 28h96"/><circle cx="112" cy="28" r="5" class="dot"/><path d="M112 10v36" class="now"/>',
  week: '<path d="M14 22v18M42 14v26M70 28v12M98 10v30M126 18v22M154 32v8M182 34v6"/><path d="M8 44h196" class="h"/><circle cx="98" cy="4" r="4" class="dot"/>',
  timeline: '<path d="M60 12h120M20 28h150M20 44h96"/><path d="M60 12H32a12 12 0 0 0-12 12v4M170 28v4a12 12 0 0 1-12 12h-42" class="h"/><circle cx="190" cy="12" r="5" class="dot"/>',
  inbox: '<path d="M20 14h120M40 28h140M20 42h90"/><path d="M150 14h14M190 28h10" class="h"/><circle cx="122" cy="42" r="4.5" class="dot"/>',
  stats: '<path d="M12 6v44" class="h"/><path d="M22 14h70M22 28h150M22 42h110"/><circle cx="186" cy="28" r="5" class="dot"/>',
  finance: '<path d="M8 48h200" class="h"/><path d="M14 40l40-12 34 8 46-20 40 4"/><circle cx="186" cy="20" r="5" class="dot"/>',
  reviews: '<path d="M20 12h110M20 26h150M20 40h70"/><path d="M100 40h28" class="h"/><circle cx="142" cy="40" r="4.5" class="dot"/>',
  admin: '<path d="M12 14h100M136 14h68M12 28h40M76 28h128M12 42h150M186 42h18" class="h"/><circle cx="124" cy="14" r="7"/><circle cx="64" cy="28" r="7"/><circle cx="174" cy="42" r="7" class="dot"/>',
};

/** Faint header drawing, right side of a page header (hidden under 900px). */
export function HeaderVec({ n }: { n: keyof typeof VEC }) {
  return <svg className="hvec" viewBox="0 0 212 56" width="212" height="56" fill="none" strokeLinecap="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: VEC[n] }} />;
}

const EMPTY: Record<string, string> = {
  clear: '<path d="M20 14h60M20 28h44M20 42h28" class="h"/><path d="M92 26l6 6 12-14"/>',
  inbox: '<path d="M20 14h90M20 28h90M20 42h90" class="h"/><circle cx="118" cy="28" r="6" class="dot"/>',
  numbers: '<path d="M14 8v40M24 18h20M24 32h40M24 46h12" class="h"/><circle cx="76" cy="32" r="5" class="dot"/>',
};

/** Small drawing above an empty state's text. */
export function EmptyArt({ kind }: { kind: keyof typeof EMPTY }) {
  return <svg className="empty-art" viewBox="0 0 132 56" width="132" height="56" fill="none" strokeLinecap="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: EMPTY[kind] }} />;
}
