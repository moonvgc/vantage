// Brand mark + in-app line icons, all inline SVG (no asset files needed).

export function BrandMark({ size = 18 }) {
  return (
    <svg className="vlr-mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {/* Same geometry as scripts/make-icon.mjs, without the tile. */}
      <defs>
        <linearGradient id="vantage-mark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF7A59" />
          <stop offset="1" stopColor="#FF4655" />
        </linearGradient>
      </defs>
      <polygon points="2.6,3.6 6.6,3.6 11.4,16.4 8.6,16.4" fill="url(#vantage-mark)" />
      <polygon points="17.4,3.6 13.4,3.6 10.9,10.2 12.9,13.2" fill="#F5F5FA" />
    </svg>
  );
}

const PATHS = {
  swap: <><path d="M2.5 4.5h8.2M8.4 2.2l2.3 2.3-2.3 2.3" /><path d="M11.5 9.5H3.3M5.6 7.2 3.3 9.5l2.3 2.3" /></>,
  refresh: <><path d="M12.2 7A5.2 5.2 0 1 1 10.6 3.2" /><path d="M12.2 1.6v2.8H9.4" /></>,
  refreshall: <><path d="M7 2.2a4.8 4.8 0 0 1 4.8 4.8" /><path d="M11.8 4.4v2.6H9.2" /><path d="M7 11.8a4.8 4.8 0 0 1-4.8-4.8" /><path d="M2.2 9.6V7h2.6" /></>,
  market: <><path d="M1.8 2.2h1.9l1.6 7.2h6.8l1.4-4.9H4.4" /><circle cx="6" cy="12.1" r="1" /><circle cx="10.9" cy="12.1" r="1" /></>,
  eye: <><path d="M1.8 7q5.2-5.1 10.4 0Q7.2 12.1 1.8 7Z" /><circle cx="7" cy="7" r="1.6" /></>,
  import: <><path d="M7 1.8v6.4M4.4 6l2.6 2.6L9.6 6" /><path d="M1.8 12.2h10.4" /></>,
  clock: <><circle cx="7" cy="7" r="5.4" /><path d="M7 3.9V7l2.2 1.4" /></>,
  cart: <><path d="M1.4 1.8h1.8l1.5 6.4h6.1l1.3-4.3H3.6" /><circle cx="5.6" cy="11.4" r="1" /><circle cx="10" cy="11.4" r="1" /></>,
  box: <><path d="M7 1.6 12.4 4.6v5L7 12.4 1.6 9.6v-5Z" /><path d="M1.6 4.6 7 7.6l5.4-3" /><path d="M7 7.6v4.8" /></>,
  trash: <><path d="M2.5 3.8h9M5.5 3.8V2.2h3v1.6M3.5 3.8l.6 8.4h5.8l.6-8.4" /><path d="M5.6 6v4M8.4 6v4" /></>,
  back: <><path d="M8.5 2.5 4 7l4.5 4.5" /><path d="M4 7h8.5" /></>,
  close: <><path d="M3 3l8 8M11 3l-8 8" /></>,
  palette: <><path d="M7 12.8A5.8 5.8 0 1 1 12.8 7c0 1.6-1.3 2-2.4 2H9.6c-.9 0-1.6.7-1.6 1.6 0 .5.2.9.2 1.4 0 .5-.5.8-1.2.8Z" /><circle cx="4.6" cy="8" r="0.9" fill="currentColor" stroke="none" /><circle cx="6.8" cy="4.6" r="0.9" fill="currentColor" stroke="none" /><circle cx="10.4" cy="4.6" r="0.9" fill="currentColor" stroke="none" /></>,
  sound: <><path d="M2 5.2h2.2L7.4 2.4v9.2L4.2 8.8H2Z" /><path d="M9.2 4.6q1.4 1.2 1.4 2.4T9.2 9.4" /><path d="M10.8 3q2.2 1.9 2.2 4T10.8 11" /></>,
  soundoff: <><path d="M2 5.2h2.2L7.4 2.4v9.2L4.2 8.8H2Z" /><path d="M9.4 5.4l3.2 3.2M12.6 5.4 9.4 8.6" /></>,
  search: <><circle cx="6.2" cy="6.2" r="4.2" /><path d="M9.4 9.4l3.4 3.4" /></>,
  sort: <><path d="M4.6 11.4V3.1M2.9 4.8 4.6 3.1l1.7 1.7" /><path d="M9.4 2.6v8.3M7.7 9.2l1.7 1.7 1.7-1.7" /></>,
  settings: <><path d="M2 4.2h10M2 9.8h10" /><circle cx="5.2" cy="4.2" r="1.6" /><circle cx="8.8" cy="9.8" r="1.6" /></>,
  play: <path d="M4.7 2.5 11.3 7l-6.6 4.5Z" fill="currentColor" stroke="none" />,
  plus: <><path d="M7 2.5v9M2.5 7h9" /></>,
  link: <><path d="M5.8 8.2 8.2 5.8" /><path d="M6.6 3.9 7.9 2.6a2.5 2.5 0 0 1 3.5 3.5L10.1 7.4" /><path d="M7.4 10.1 6.1 11.4a2.5 2.5 0 0 1-3.5-3.5L3.9 6.6" /></>,
  external: <><path d="M8.2 2h3.8v3.8" /><path d="M12 2 6.6 7.4" /><path d="M10.4 8.4v3.6H2V3.6h3.6" /></>,
  locker: <><rect x="2.2" y="1.8" width="9.6" height="10.4" rx="1.4" /><path d="M7 1.8v10.4" /><path d="M5.2 6v1.6M8.8 6v1.6" /></>,
  chart: <><path d="M2 12h10" /><path d="M3.6 9.6V7M6.2 9.6V4.2M8.8 9.6V6M11.4 9.6V2.6" /></>,
  valorant: <><path d="M1.6 2.6 7.8 10.4H4.6L1.6 6.6Z" fill="currentColor" stroke="none" /><path d="M12.4 2.6 8.4 7.6H5.6L12.4 2.6Z" fill="currentColor" stroke="none" /></>,
  league: <><path d="M3.2 1.8v9.6h6.6" /><path d="M3.2 11.4 5.4 9.2V1.8" /><circle cx="8.6" cy="6.4" r="3.6" opacity=".55" /></>,
  warn: <><path d="M7 1.8 12.8 12H1.2Z" /><path d="M7 5.4v3" /><circle cx="7" cy="10.2" r="0.7" /></>
};

export function Icon({ name, size = 13 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name] ?? null}
    </svg>
  );
}
