/**
 * Shared primitives for reproducing an approved page composition (any of the ten 2560 x 1440 references) at its exact design geometry. Coordinates are the reference's own
 * (2560 x 1440 stage, header included): `B` places a box by its top-left corner, `T` places text by its left edge and vertical centre,
 * `Ic` places an icon by its centre. The stage starts below the header, at design y = 101.
 */
import type { CSSProperties, ReactNode } from "react";
import styles from "./DesignStage.module.css";

export const Y0 = 101;
export const u = (n: number) => `calc(${n} * var(--u))`;

/**
 * The page body below the header (design y 101..1440). `page`: the page's id for tests and full-bleed detection, e.g. "home".
 * `background`: the reference page's own canvas colour (default #000d18).
 */
export function DesignStage({ page, background, extra = 0, children }: { page: string; background?: string; extra?: number; children: ReactNode }) {
  const bg = background ? { background } : undefined;
  /** `extra`: design pixels added below the reference's 1339 (a page whose content needs more room than the reference gave it); 0 for every approved page */
  const tall = extra > 0 ? { height: `calc(${1339 + extra} * var(--u))` } : undefined;
  return (
    <div className={styles.wrap} style={bg}>
      <div className={styles.stage} data-stage={page} style={{ ...bg, ...tall }}>{children}</div>
    </div>
  );
}

/** `o`: the design coordinates of the positioned parent when nesting inside another element (default: the stage) */
type Origin = [number, number];
const ox = (o?: Origin) => (o ? o[0] : 0);
const oy = (o?: Origin) => (o ? o[1] : Y0);

type BoxProps = { x: number; y: number; w: number; h: number; o?: Origin | undefined; style?: CSSProperties | undefined; className?: string | undefined; children?: ReactNode } & Record<`data-${string}`, string>;

export function B({ x, y, w, h, o, style, className, children, ...rest }: BoxProps) {
  return (
    <div className={`${styles.a} ${className ?? ""}`} style={{ left: u(x - ox(o)), top: u(y - oy(o)), width: u(w), height: u(h), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** the reference's panel (`P`): dark gradient card with a 1.5 px border and 14 px corners */
export function P({ x, y, w, h, o, style, children, ...rest }: Omit<BoxProps, "className">) {
  return <B x={x} y={y} w={w} h={h} o={o} className={styles.pn} style={style} {...rest}>{children}</B>;
}

/** the reference's section accent (`ACC`): a 5 px blue bar left of a section title */
export function ACC({ x, y, h, o }: { x: number; y: number; h: number; o?: Origin }) {
  return <B x={x} y={y} w={5} h={h} o={o} style={{ background: "#1e90ff", borderRadius: u(2) }} />;
}

type TextProps = {
  x: number; y: number; size: number; children: ReactNode; weight?: 400 | 600 | 700 | undefined; color?: string | undefined; ls?: number | undefined;
  o?: Origin | undefined; align?: "left" | "center" | "right" | undefined; style?: CSSProperties | undefined; as?: "div" | "span" | "p" | "h1" | "h2" | "h3" | undefined;
};

export function T({ x, y, size, children, weight = 400, color, ls, o, align = "left", style, as: Tag = "div" }: TextProps) {
  const cls = `${styles.t} ${align === "center" ? styles.tc : align === "right" ? styles.tr : ""}`;
  return (
    <Tag className={cls} style={{ left: u(x - ox(o)), top: u(y - oy(o)), fontSize: u(size), fontWeight: weight, color, letterSpacing: ls === undefined ? undefined : u(ls), margin: 0, ...style }}>
      {children}
    </Tag>
  );
}

/** the reference's drawn icons (24 x 24 strokes) */
const IC: Record<string, ReactNode> = {
  /* Page 08 Player Report's drawn icons */
  pdf: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 15h6M9 18h4" /></>,
  bag: <><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M9 8V5h6v3M4 13h16" /></>,
  run: <><circle cx="14" cy="5" r="2" /><path d="M10 21l2-6-3-3 3-4 3 3h4M7 12l-3 1" /></>,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  pick: <><circle cx="12" cy="8" r="4" /><path d="M5 21c0-4 3-7 7-7s7 3 7 7" /></>,
  burst: <path d="M12 2l2 6 6-2-3 5 5 3-6 1 1 6-5-4-5 4 1-6-6-1 5-3-3-5 6 2z" />,
  dbl: <path d="M4 18l6-12 4 8 3-5 3 9" />,
  /* Page 06 Reel Builder's drawn icons */
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900l2.100 2.100M17 17l2.100 2.100M4.900 19.100L7 17M17 7l2.100-2.100" /></>,
  tri: <path d="M12 3L4 21h16L12 3zM12 3v18" />,
  ring: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  spark: <path d="M12 2l2.200 6.800L21 11l-6.800 2.200L12 20l-2.200-6.800L3 11l6.800-2.200L12 2z" />,
  fwd: <path d="M9 5l7 7-7 7" />,
  star: <path d="M12 3l2.800 5.800 6.200.9-4.500 4.400 1.100 6.200L12 17.300 6.400 20.300l1.100-6.200L3 9.700l6.200-.9L12 3z" />,
  ref: <path d="M20 12a8 8 0 11-2.400-5.700M20 4v5h-5" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  full: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  sq: <rect x="4" y="4" width="16" height="16" rx="2" />,
  ph: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  pl: <path d="M7 4l13 8-13 8V4z" />,
  scr: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  up: <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />,
  link: <path d="M10 14a4 4 0 005 0l4-4a4 4 0 00-5-5M14 10a4 4 0 00-5 0l-4 4a4 4 0 005 5" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  heart: <path d="M12 21s-8-5-8-11a4.500 4.500 0 018-3 4.500 4.500 0 018 3c0 6-8 11-8 11z" />,
  share: <path d="M12 15V3M7 8l5-5 5 5M4 14v7h16v-7" />,
  dots: <><circle cx="12" cy="5" r="1.800" /><circle cx="12" cy="12" r="1.800" /><circle cx="12" cy="19" r="1.800" /></>,
  bm: <path d="M6 3h12v18l-6-4-6 4z" />,
  cam: <><rect x="3" y="6" width="14" height="12" rx="2" /><path d="M17 10l4-2v8l-4-2" /></>,
  ppl: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.500" /><path d="M3 20c1-5 4-6 6-6s5 1 6 6M15 15c3 0 5 2 6 5" /></>,
  reel: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="7" r="1.500" /><circle cx="12" cy="17" r="1.500" /><circle cx="7" cy="12" r="1.500" /><circle cx="17" cy="12" r="1.500" /></>,
  doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M9 12h6M9 16h6" /></>,
  gt: <path d="M9 5l7 7-7 7" />,
  arr: <path d="M4 12h15M13 5l7 7-7 7" />,
  ball: <><circle cx="12" cy="12" r="9" /><path d="M12 8l3 2-1 4h-4l-1-4z" /></>,
  spd: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  pass: <path d="M4 20L20 4M12 4h8v8" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9" /></>,
  xa: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></>,
  scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><circle cx="12" cy="12" r="3.500" /></>,
  tac: <><circle cx="6" cy="6" r="2.500" /><circle cx="18" cy="14" r="3" /><circle cx="8" cy="18" r="2.500" /><path d="M9 7l6 5" /></>,
  clap: <><rect x="3" y="9" width="18" height="12" rx="2" /><path d="M3 9l3-5h4l-3 5M10 9l3-5h4l-3 5M10 14l5 3-5 3z" /></>,
  bars: <path d="M5 20V12M10 20V6M15 20V10M20 20V4" />,
  cloud: <><path d="M7 18a4.500 4.500 0 010-9 6 6 0 0111.500 1.500A3.800 3.800 0 0118 18z" /><path d="M12 17v-7M9 13l3-3 3 3" /></>,
  play: <path d="M7 4l13 8-13 8z" />,
  tgt: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  yt: <><rect x="2" y="5" width="20" height="14" rx="4" /><path d="M10 9l5 3-5 3z" fill="currentColor" /></>,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17v.5" /></>,
  stab: <><circle cx="12" cy="12" r="4" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" /></>,
  crop: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M2 8h4M18 16h4" /></>,
  enh: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  vol: <path d="M3 9h4l5-4v14l-5-4H3zM16 8a5 5 0 010 8M2 3l20 18" />,
  asp: <rect x="4" y="4" width="16" height="16" rx="2" />,
  jer: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M10 9l2 1v5" /></>,
  pit: <><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="12" cy="12" r="3" /></>,
  mk: <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="12" r="3" /></>,
  cal: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 8h16M8 13h8M8 17h8" /></>,
  hl: <><rect x="4" y="5" width="12" height="14" rx="2" /><path d="M16 9l5-2v10l-5-2" /></>,
  /* Page 07 Clip Studio (its own speaker, speed and marker shapes differ from vol, spd and mk) */
  back: <path d="M20 12H5M11 5l-7 7 7 7" />,
  chev: <path d="M6 9l6 6 6-6" />,
  srch: <><circle cx="10" cy="10" r="6" /><path d="M15 15l6 6" /></>,
  flt: <path d="M4 7h16M7 12h10M10 17h4" />,
  fold: <path d="M3 6h7l2 2h9v11H3z" />,
  chk: <path d="M5 12l5 5 9-10" />,
  plus: <path d="M12 4v16M4 12h16" />,
  x: <path d="M5 5l14 14M19 5L5 19" />,
  sav: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 3v5h6M9 14h6" /></>,
  undo: <path d="M4 9h11a5 5 0 010 10H8M8 5L4 9l4 4" />,
  redo: <path d="M20 9H9a5 5 0 000 10h7M16 5l4 4-4 4" />,
  ai: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 3v4M17 5h4" />,
  exp: <path d="M12 15V4M7 9l5-5 5 5M4 14v7h16v-7" />,
  prev: <path d="M5 5v14M19 5L9 12l10 7z" />,
  next: <path d="M19 5v14M5 5l10 7L5 19z" />,
  speaker: <path d="M3 9h4l5-4v14l-5-4H3zM16 8a5 5 0 010 8M19 5a9 9 0 010 14" />,
  fs: <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />,
  cap: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-5 4-7 8-7s7 2 8 7" /></>,
  clk: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  tag: <path d="M3 12V4h8l10 10-8 8z" />,
  note: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5" /></>,
  cut: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8 8l12 10M8 16L20 6" /></>,
  split: <path d="M12 3v18M5 7h4v10H5zM15 7h4v10h-4z" />,
  trash: <path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14" />,
  marker: <path d="M6 3h12v18l-6-5-6 5z" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>,
  cc: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 10a2 2 0 100 4M16 10a2 2 0 100 4" /></>,
  gfx: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 14l3-3 5 5" /></>,
  speed: <><circle cx="12" cy="12" r="9" /><path d="M12 12l4-4M7 16h10" /></>,
  col: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /></>,
  mus: <path d="M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0z" />,
  trf: <path d="M7 3v14h14M3 7h14v14" />,
  fit: <><path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" /><circle cx="12" cy="12" r="3" /></>,
  zi: <><circle cx="10" cy="10" r="6" /><path d="M15 15l6 6M10 7v6M7 10h6" /></>,
  zo: <><circle cx="10" cy="10" r="6" /><path d="M15 15l6 6M7 10h6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  mute: <path d="M3 9h4l5-4v14l-5-4H3zM16 9l5 6M21 9l-5 6" />,
  fx: <path d="M5 19L19 5M7 7h4M13 17h4" />,
  exv: <path d="M4 10V4h6M20 10V4h-6M4 14v6h6M20 14v6h-6" />,
  /* Page 09 Library (its calendar, dots, bars and tag differ from cal, dots, bars and tag) */
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  dl: <path d="M12 3v12M6 10l6 6 6-6M4 20h16" />,
  tmpl: <><path d="M6 3h8l4 4v14H6z" /><path d="M9 11h6M9 15h6" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" /><path d="M8 12l3 3 5-6" /></>,
  box: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h3v3H8zM13 13h3v3h-3z" /></>,
  ids: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="7" r="3" /><circle cx="7" cy="17" r="3" /><circle cx="17" cy="17" r="3" /></>,
  trk: <><circle cx="6" cy="6" r="1.5" /><circle cx="12" cy="9" r="1.5" /><circle cx="18" cy="6" r="1.5" /><circle cx="6" cy="16" r="1.5" /><circle cx="14" cy="18" r="1.5" /></>,
  shp: <path d="M4 6h5M15 6h5M4 18h5M15 18h5M9 6l6 12M15 6L9 18" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  send: <path d="M3 11l18-8-8 18-2-8z" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  cir: <circle cx="12" cy="12" r="9" />,
  xc: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  img: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M6 17l4-5 3 3 3-4 3 6" /></>,
  sort: <path d="M8 10l4-5 4 5M8 14l4 5 4-5" />,
  hdots: <><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></>,
  bars3: <path d="M5 20V12M12 20V5M19 20V9" />,
  tagdot: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></>,
  /* Page 02 Upload */
  ups: <path d="M12 19V6M6 12l6-6 6 6" />,
  file: <><path d="M5 3h9l5 5v13H5z" /><path d="M10 11l5 3-5 3z" /></>,
  /* Page 02 Upload: its own up chevron, ball, file-size, edit and target shapes differ from up, ball, fs, edit and tgt */
  arrow: <path d="M4 12h15M13 5l7 7-7 7" />,
  meta: <><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="12" cy="12" r="3" /></>,
  snd: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></>,
  db: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3" /></>,
  ckc: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  u_up: <path d="M6 15l6-6 6 6" />,
  u_ball: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></>,
  u_fs: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 9h8M8 13h8" /></>,
  u_edit: <path d="M4 20h4L19 9l-4-4L4 16zM4 5h7" />,
  u_tgt: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></>,
};

export type IconKey = keyof typeof IC;

export function Ic({ x, y, k, size, o, color = "#fff", sw = 1.8, fill = "none" }: { x: number; y: number; k: string; size: number; o?: Origin; color?: string; sw?: number; fill?: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden focusable="false"
      style={{ left: u(x - ox(o) - size / 2), top: u(y - oy(o) - size / 2), width: u(size), height: u(size), color }}
      fill={fill} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {IC[k]}
    </svg>
  );
}

export { styles as stageStyles };
