// Sentient Dash icons. One language with the Lane S mark: rounded lanes (1.6 stroke, round caps), hairline connectors,
// and an optional "now" dot that turns amber when the item is active (.ico .ac, see globals.css).
// The object below is plain JSON on purpose: the brand board renders the same definitions.
export const ICONS = {
  "mark": { "d": "M8.2 4.8h6.6M5.2 10h9.8M5.2 15.2h6.6M8.2 4.8H6.8a1.6 1.6 0 0 0-1.6 1.6V10M15 10v3.6a1.6 1.6 0 0 1-1.6 1.6h-1.6", "dot": [15.4, 4.8, 1.9] },
  "home": { "d": "M3.8 9.2 10 4.2l6.2 5M6.4 12.4h7.2M6.4 15.6h4.2", "dot": [14.4, 15.6, 1.5] },
  "today": { "d": "M4 5.6h12M4 14.4h12M4 10h8", "dot": [15.2, 10, 1.9] },
  "week": { "d": "M4.6 4.2h10.8a1.4 1.4 0 0 1 1.4 1.4v9.8a1.4 1.4 0 0 1-1.4 1.4H4.6a1.4 1.4 0 0 1-1.4-1.4V5.6a1.4 1.4 0 0 1 1.4-1.4zM3.2 7.8h13.6M9.4 11h4.2M6.2 14h4.2", "dot": [6.4, 11, 1.25] },
  "timeline": { "d": "M8.2 4.8h6.6M5.2 10h9.8M5.2 15.2h6.6M8.2 4.8H6.8a1.6 1.6 0 0 0-1.6 1.6V10M15 10v3.6a1.6 1.6 0 0 1-1.6 1.6h-1.6", "dot": [15.4, 4.8, 1.6] },
  "inbox": { "d": "M3.6 11.2 5.5 5h9l1.9 6.2v4a1.2 1.2 0 0 1-1.2 1.2H4.8a1.2 1.2 0 0 1-1.2-1.2zM3.6 11.2h3.6l1.1 2h3.4l1.1-2h3.6M7.6 8.2h4.8" },
  "stats": { "d": "M3.6 3.4v13.2M6.4 6h5M6.4 10h8.6M6.4 14h6.2", "dot": [15.6, 14, 1.4] },
  "finance": { "d": "M3.8 16h12.4M4.4 12.8l3.6-3.2 3 2.2 4-4.6", "dot": [15.6, 6.6, 1.6] },
  "reviews": { "d": "M5.4 3.4h6.4l3 3v10.2H5.4zM11.6 3.4v3.2h3.2M7.6 10h5M7.6 13.2h2.8", "dot": [12.6, 13.2, 1.2] },
  "admin": { "d": "M3.8 6h6.4M13.8 6h2.4M3.8 10h1.4M8.8 10h7.4M3.8 14h4.9M12.3 14h3.9M13.8 6a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 1 1 3.6 0zM8.8 10a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 1 1 3.6 0zM12.3 14a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 1 1 3.6 0z" },
  "checklist": { "d": "M8.6 5.6h7.6M8.6 10h7.6M8.6 14.4h5M3.8 5.6l1.1 1.1 2-2.2M3.8 10l1.1 1.1 2-2.2", "dot": [5.2, 14.4, 1.3] },
  "docs": { "d": "M5.4 3.4h9.2v13.2H5.4zM7.8 7h4.4M7.8 10h4.4M7.8 13h2.6" },
  "search": { "d": "M8.8 3.8a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM12.4 12.4l4.1 4.1" },
  "rail": { "d": "M4.6 4h10.8a1.1 1.1 0 0 1 1.1 1.1v9.8a1.1 1.1 0 0 1-1.1 1.1H4.6a1.1 1.1 0 0 1-1.1-1.1V5.1A1.1 1.1 0 0 1 4.6 4zM8 4v12M13.2 8.2 11.4 10l1.8 1.8" },
  "expand": { "d": "M4.6 4h10.8a1.1 1.1 0 0 1 1.1 1.1v9.8a1.1 1.1 0 0 1-1.1 1.1H4.6a1.1 1.1 0 0 1-1.1-1.1V5.1A1.1 1.1 0 0 1 4.6 4zM8 4v12M11.4 8.2l1.8 1.8-1.8 1.8" },
  "menu": { "d": "M7 5.6h9.2M3.8 10h12.4M3.8 14.4h8" },
  "out": { "d": "M8 3.5H4.3v13H8M12 6.5 15.5 10 12 13.5M15.5 10H7.5" },
  "close": { "d": "M5 5l10 10M15 5 5 15" },
  "start": { "d": "M4 10h7.6M9 6.6l3.4 3.4L9 13.4", "dot": [15.6, 10, 1.7] },
  "plus": { "d": "M10 4.4v11.2M4.4 10h11.2" },
  "map": { "d": "M3.6 5.4 7.6 3.8l4.8 1.6 4-1.6v10.8l-4 1.6-4.8-1.6-4 1.6zM7.6 3.8v10.8M12.4 5.4v10.8" },
  "drag": { "d": "M6.2 6.8h7.6M6.2 10h7.6M6.2 13.2h7.6" }
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ n, size = 18, className = "" }: { n: IconName | string; size?: number; className?: string }) {
  const ic = (ICONS as Record<string, { d: string; dot?: readonly number[] }>)[n];
  if (!ic) return null;
  return (
    <svg className={`ico ${className}`.trim()} width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ic.d} />
      {ic.dot && <circle className="ac" cx={ic.dot[0]} cy={ic.dot[1]} r={ic.dot[2]} stroke="none" />}
    </svg>
  );
}

/** The Lane S brand mark (filled lanes, amber "now" dot), for the sidebar and the login page. */
export function Mark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`mark ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="22" y="13" width="30" height="8" rx="4" fill="currentColor" />
      <rect x="12" y="28" width="40" height="8" rx="4" fill="currentColor" />
      <rect x="12" y="43" width="30" height="8" rx="4" fill="currentColor" />
      <path d="M22 17H16a4 4 0 0 0-4 4v7M52 36v7a4 4 0 0 1-4 4h-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle className="mark-dot" cx="52" cy="17" r="5.2" />
    </svg>
  );
}
