import {
  SPORTS,
  at,
  formationLabel,
  orderSpots,
  refLabel,
  sportOf,
  unitRows,
  type SectionDef,
  type Character,
  type Spot,
  type Team,
} from "@ftp/shared";
import { layoutSlots } from "../field/layout";
import { spotLabel } from "../dnd/ids";
import { paintMarks } from "../field/marks";
import { surfaceOf, type Pane, type SurfaceDef } from "../field/surfaces";
import type { LoadedList } from "../lists";

/**
 * PNG exports, drawn straight onto a canvas: shapes and text, then each portrait with
 * drawImage from the list's (same-origin) sprite atlas. No DOM capture, so no missed CSS
 * sprites or font races, and one image decode.
 */
/** "field" (everything on the surface), a unit's pane on its own, or "depth". */
export type Layout = string;

/** The export layouts a team offers: football has both sides, one side, depth chart. */
export function layoutsFor(team: Team): { id: Layout; label: string }[] {
  const sport = sportOf(team);
  const surface = surfaceOf(sport);
  const panes = surface.panes(sport, team);
  const facing = (surface.facing?.(sport, team).length ?? 0) > 1;
  return [
    { id: "field", label: facing ? `${surface.noun}, both sides` : surface.noun },
    ...(panes.length > 1
      ? panes.map((p) => ({ id: p.unit, label: `${surface.noun}, ${p.label.toLowerCase()}` }))
      : []),
    { id: "depth", label: "Depth chart" },
  ];
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Rendered = { canvas: HTMLCanvasElement; portraits: Rect[] };

/** The site's trading-card look (index.css), always in its light colours. */
const C = {
  bg: "#fff6dc",
  fg: "#111111",
  muted: "#4a4a4a",
  ink: "#111111",
  surface: "#ffffff",
  highlight: "#ffd23f",
  tileEmpty: "rgba(255,255,255,0.16)",
  twoWay: "#f7a8ff",
};
const FONT = '"Archivo", system-ui, sans-serif';
const DISPLAY = '"Archivo Black", "Archivo", system-ui, sans-serif';
/** Canvas text doesn't trigger web-font loads, so ask for each face before drawing. */
const FACES = [
  `400 16px ${DISPLAY}`,
  `400 16px ${FONT}`,
  `500 16px ${FONT}`,
  `600 16px ${FONT}`,
  `700 16px ${FONT}`,
];
const PAD = 40;
const HEADER_H = PAD + 92;
const FOOTER_H = 100;

export function exportFilename(title: string, layout: Layout): string {
  const slug =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // accents: "ï" -> "i"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team";
  return `${slug}-${layout === "depth" ? "depth-chart" : layout}.png`;
}

async function loadFonts() {
  const fonts = document.fonts;
  if (!fonts) return;
  // A missing font only falls back to the system face; never fail the export over it.
  await Promise.all(FACES.map((f) => fonts.load(f).catch(() => []))).catch(() => undefined);
  await fonts.ready;
}

const atlasCache = new Map<string, Promise<HTMLImageElement>>();
function loadAtlas(url: string): Promise<HTMLImageElement> {
  let p = atlasCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`couldn't load ${url}`));
      img.src = url;
    });
    atlasCache.set(url, p);
  }
  return p;
}

export async function renderTeam(
  team: Team,
  list: LoadedList,
  layout: Layout,
  opts: { url?: string } = {},
): Promise<Rendered> {
  const [atlas] = await Promise.all([loadAtlas(list.atlasUrl), loadFonts()]);
  const d = new Drawer(list, atlas);
  if (layout === "depth") return d.depth(team, opts.url);
  return d.field(team, layout, opts.url);
}

class Drawer {
  portraits: Rect[] = [];
  ctx!: CanvasRenderingContext2D;
  canvas!: HTMLCanvasElement;

  constructor(
    private list: LoadedList,
    private atlas: HTMLImageElement,
  ) {}

  private begin(width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.fillStyle = C.bg;
    this.ctx.fillRect(0, 0, width, height);
  }

  // ---- Layouts -------------------------------------------------------------------------

  field(team: Team, layout: string, url?: string): Rendered {
    const sport = sportOf(team);
    const surface = surfaceOf(sport);
    const facing = surface.facing?.(sport, team);
    const all = layout === "field";
    const shown = all
      ? (facing ?? surface.panes(sport, team).slice(0, 1))
      : surface
          .panes(sport, team)
          .filter((p) => p.unit === layout)
          .map((p) => ({ ...p, ...surface.exportView?.(p.unit) }));
    const staff = sport.sections.find((s) => s.kind === "staff" && team.sections?.[s.id]);
    const situational = sport.sections.find(
      (s) => s.kind === "situational" && team.sections?.[s.id],
    );
    // Facing panes go landscape with sections beside them; one pane is a portrait.
    const both = shown.length > 1;
    const [W, H] = both ? [1600, 900] : [1080, 1350];
    this.begin(W, H);

    const subtitle = [...shown]
      .reverse()
      .map((p) => formationLabel(p.formation))
      .join(" vs ");
    let top = this.header(team, subtitle, W);
    const bottom = this.footer(W, H, url);

    if (staff) top = this.staffStrip(team, staff, { x: PAD, y: top, w: W - 2 * PAD, h: 0 }) + 12;

    let fieldArea: Rect = { x: PAD, y: top, w: W - 2 * PAD, h: bottom - top };
    if (situational) {
      if (both) {
        const panelW = 300;
        this.sectionPanel(
          team,
          situational,
          { x: W - PAD - panelW, y: top, w: panelW, h: bottom - top },
          1,
        );
        fieldArea = { ...fieldArea, w: fieldArea.w - panelW - 16 };
      } else {
        const spots = Object.values(situational.rows).reduce((n, r) => n + r, 0);
        const panelH = Math.ceil(spots / 2) * 58 + 44;
        this.sectionPanel(
          team,
          situational,
          { x: PAD, y: bottom - panelH, w: W - 2 * PAD, h: panelH },
          2,
        );
        fieldArea = { ...fieldArea, h: fieldArea.h - panelH - 16 };
      }
    }

    const tile = both
      ? { width: 76, height: 92, sprite: 54 }
      : { width: 92, height: 112, sprite: 66 };
    const total = shown.reduce((n, p) => n + p.yMax - p.yMin, 0);
    const drawn: Rect[] = [];
    let y = fieldArea.y;
    for (const pane of shown) {
      const h = Math.round((fieldArea.h * (pane.yMax - pane.yMin)) / total);
      let area: Rect = { ...fieldArea, y, h };
      if (surface.aspect) {
        // Keep the surface's proportions, centred in the space.
        const span = (pane.yMax - pane.yMin) / 100;
        const w = Math.min(area.w, area.h / (surface.aspect * span));
        const fh = w * surface.aspect * span;
        area = { x: area.x + (area.w - w) / 2, y: area.y + (area.h - fh) / 2, w, h: fh };
      }
      this.fieldSide(team, surface, pane, area, tile);
      drawn.push(area);
      y += h;
    }
    if (drawn.length) {
      const x0 = Math.min(...drawn.map((r) => r.x));
      const y0 = Math.min(...drawn.map((r) => r.y));
      const x1 = Math.max(...drawn.map((r) => r.x + r.w));
      const y1 = Math.max(...drawn.map((r) => r.y + r.h));
      this.ink({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 3, { shadow: 6 });
    }
    return { canvas: this.canvas, portraits: this.portraits };
  }

  depth(team: Team, url?: string): Rendered {
    const W = 1080;
    const ROW = 46;
    const sport = sportOf(team);
    const sections: { title: string; side: Spot["side"]; rows: [string, number][] }[] = [];
    const on = (kind: SectionDef["kind"]) =>
      sport.sections.filter((s) => s.kind === kind && team.sections?.[s.id]);
    for (const s of on("staff"))
      sections.push({ title: s.name, side: s.id, rows: Object.entries(s.rows) });
    for (const u of sport.units) {
      const state = team.units[u.id]!;
      const variant = u.variants.length > 1 && u.variants.find((v) => v.id === state.variant);
      sections.push({
        title: variant ? `${u.name} (${variant.name})` : u.name,
        side: u.id,
        rows: Object.entries(unitRows(u, state.variant)),
      });
    }
    for (const s of on("situational"))
      sections.push({ title: s.name, side: s.id, rows: Object.entries(s.rows) });
    const order = sport.units.find((u) => u.battingOrder);

    const batting = order
      ? orderSpots(order, team.units[order.id]!.variant, team.units[order.id]!.order)
      : [];
    const body =
      sections.reduce((h, s) => h + 40 + s.rows.length * ROW + 20, 0) +
      (batting.length ? 40 + Math.ceil(batting.length / 3) * ROW + 20 : 0);
    const H = Math.max(1350, HEADER_H + body + FOOTER_H);
    this.begin(W, H);
    let y = this.header(team, "Depth chart", W);
    this.footer(W, H, url);

    const labelW = 70;
    const cellW =
      (W - 2 * PAD - labelW) / Math.max(6, ...sections.flatMap((s) => s.rows.map(([, n]) => n)));
    const ctx = this.ctx;
    for (const s of sections) {
      ctx.fillStyle = C.fg;
      ctx.font = `400 22px ${DISPLAY}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(s.title, PAD, y + 26);
      y += 40;
      for (const [pos, n] of s.rows) {
        ctx.fillStyle = C.fg;
        ctx.font = `700 16px ${FONT}`;
        ctx.textBaseline = "middle";
        ctx.fillText(pos, PAD, y + ROW / 2);
        for (let index = 0; index < n; index++) {
          const r = { x: PAD + labelW + index * cellW + 2, y: y + 3, w: cellW - 4, h: ROW - 6 };
          this.cell(
            r,
            this.char(at(team, { side: s.side, pos, index })),
            spotLabel({ side: s.side, pos, index }, sport),
          );
        }
        y += ROW;
      }
      y += 20;
    }
    if (order && batting.length) {
      ctx.fillStyle = C.fg;
      ctx.font = `400 22px ${DISPLAY}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText("Batting order", PAD, y + 26);
      y += 40;
      const w = (W - 2 * PAD) / 3;
      batting.forEach((o, i) => {
        const r = {
          x: PAD + (i % 3) * w + 2,
          y: y + Math.floor(i / 3) * ROW + 3,
          w: w - 4,
          h: ROW - 6,
        };
        const side = o.ref.unit ?? order.id;
        this.cell(
          r,
          this.char(at(team, { side, pos: o.ref.pos, index: o.ref.depth - 1 })),
          `${i + 1}. ${o.label}`,
        );
      });
    }
    return { canvas: this.canvas, portraits: this.portraits };
  }

  // ---- Pieces --------------------------------------------------------------------------

  /** Title, then "List · Sport · formations". The sport only shows once there's a choice. */
  private header(team: Team, subtitle: string, W: number): number {
    const title = team.title;
    const sport = SPORTS.length > 1 ? `${sportOf(team).name} · ` : "";
    const ctx = this.ctx;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.fg;
    ctx.font = `400 40px ${DISPLAY}`;
    ctx.fillText(fit(ctx, title, W - 2 * PAD), PAD, PAD + 36);
    ctx.fillStyle = C.muted;
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(fit(ctx, `${this.list.title} · ${sport}${subtitle}`, W - 2 * PAD), PAD, PAD + 70);
    return HEADER_H;
  }

  /** Returns the y where the footer starts. */
  private footer(W: number, H: number, url?: string): number {
    const ctx = this.ctx;
    ctx.textBaseline = "alphabetic";
    let y = H - 24;
    if (this.list.disclaimer) {
      ctx.fillStyle = C.muted;
      ctx.font = `400 13px ${FONT}`;
      ctx.fillText(fit(ctx, this.list.disclaimer, W - 2 * PAD), PAD, y);
      y -= 22;
    }
    const text = url ?? "depthchart.joncfrancis.co";
    ctx.font = `400 16px ${DISPLAY}`;
    const sticker = { x: PAD, y: y - 22, w: ctx.measureText(text).width + 20, h: 30 };
    this.ink(sticker, 2.5, { fill: C.highlight, shadow: 3 });
    ctx.fillStyle = C.ink;
    ctx.textBaseline = "middle";
    ctx.fillText(text, sticker.x + 10, sticker.y + sticker.h / 2 + 1);
    ctx.textBaseline = "alphabetic";
    return sticker.y - 24;
  }

  private fieldSide(
    team: Team,
    surface: SurfaceDef,
    pane: Pane,
    area: Rect,
    tile: { width: number; height: number; sprite: number },
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = surface.paint.bg;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    paintMarks(ctx, surface.marks(pane), area, pane, surface.paint);

    const placed = layoutSlots({
      slots: pane.slots,
      yMin: pane.yMin,
      yMax: pane.yMax,
      width: area.w,
      height: area.h,
      tile,
      away: pane.away,
    });
    const byId = new Map(pane.slots.map((s) => [s.id, s]));
    for (const p of placed) {
      const slot = byId.get(p.id)!;
      const side = slot.ref.unit ?? pane.unit;
      const c = this.char(at(team, { side, pos: slot.ref.pos, index: slot.ref.depth - 1 }));
      this.fieldTile(
        {
          x: area.x + p.left - tile.width / 2,
          y: area.y + p.top - tile.height / 2,
          w: tile.width,
          h: tile.height,
        },
        c,
        `${slot.label} · ${refLabel(slot.ref)}`,
        tile.sprite,
        surface.paint.ink,
      );
    }
  }

  /** `ink` colours an empty tile's border and label on a light surface (the rink). */
  private fieldTile(
    r: Rect,
    c: Character | undefined,
    label: string,
    sprite: number,
    ink?: string,
  ) {
    const ctx = this.ctx;
    const cx = r.x + r.w / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (c) {
      // A white card with an ink outline, a hard shadow and a yellow position label.
      this.ink(r, 2.5, { fill: C.surface, shadow: 3 });
      this.portrait(c, { x: cx - sprite / 2, y: r.y + 5, w: sprite, h: sprite });
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - sprite / 2, r.y + 5, sprite, sprite);
      if (c.twoWay) this.badge(r.x + 3, r.y + 3);
      // Label pinned to the bottom; the name sits between the portrait and the label.
      const size = Math.round(sprite / 5);
      const labelTop = r.y + r.h - size - 8;
      ctx.font = `800 ${size}px ${FONT}`;
      const text = fit(ctx, label, r.w - 10);
      const lw = ctx.measureText(text).width + 6;
      ctx.fillStyle = C.highlight;
      ctx.fillRect(cx - lw / 2, labelTop, lw, size + 4);
      ctx.fillStyle = C.ink;
      ctx.fillText(text, cx, labelTop + size + 1);
      ctx.font = `600 ${Math.round(sprite / 5)}px ${FONT}`;
      ctx.textBaseline = "middle";
      const nameMid = (r.y + 5 + sprite + labelTop) / 2;
      ctx.fillText(fit(ctx, c.name, r.w - 6), cx, nameMid);
      ctx.textBaseline = "alphabetic";
    } else {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = ink ? "rgba(16,51,27,0.12)" : C.tileEmpty;
      ctx.fill();
      ctx.strokeStyle = ink ?? "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ink ?? "#fff";
      ctx.font = `700 ${Math.round(sprite / 5)}px ${FONT}`;
      ctx.fillText(fit(ctx, label, r.w - 6), cx, r.y + r.h - 6);
    }
    ctx.textAlign = "left";
  }

  private staffStrip(team: Team, section: SectionDef, area: Rect): number {
    const h = 58;
    this.panelTitle("Front office", area.x, area.y);
    const y = area.y + 28;
    const roles = Object.keys(section.rows);
    const w = (area.w - (roles.length - 1) * 8) / roles.length;
    roles.forEach((role, i) => {
      this.cell(
        { x: area.x + i * (w + 8), y, w, h: h - 6 },
        this.char(team.sections![section.id]![role]?.[0] ?? null),
        role,
      );
    });
    return y + h;
  }

  private sectionPanel(team: Team, section: SectionDef, area: Rect, columns: 1 | 2) {
    this.panelTitle(section.name, area.x, area.y);
    const spots = Object.entries(section.rows).flatMap(([pos, n]) =>
      Array.from({ length: n }, (_, index) => ({ pos, index })),
    );
    const rowsPerCol = Math.ceil(spots.length / columns);
    const gap = 8;
    const w = (area.w - (columns - 1) * gap) / columns;
    const h = Math.min(58, (area.h - 32) / rowsPerCol);
    spots.forEach(({ pos, index }, i) => {
      const col = Math.floor(i / rowsPerCol);
      const row = i % rowsPerCol;
      this.cell(
        { x: area.x + col * (w + gap), y: area.y + 28 + row * h, w, h: h - 6 },
        this.char(team.sections?.[section.id]?.[pos]?.[index] ?? null),
        spotLabel({ side: section.id, pos, index }, sportOf(team)),
      );
    });
  }

  private panelTitle(text: string, x: number, y: number) {
    const ctx = this.ctx;
    ctx.fillStyle = C.fg;
    ctx.font = `400 18px ${DISPLAY}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + 18);
  }

  /** A light card: portrait, name and a small label (depth chart, staff, special teams). */
  private cell(r: Rect, c: Character | undefined, label: string) {
    const ctx = this.ctx;
    if (c) {
      this.ink(r, 2, { fill: C.surface });
    } else {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const size = Math.min(r.h - 6, 40);
    const textX = r.x + 3 + size + 8;
    ctx.textBaseline = "middle";
    if (c) {
      this.portrait(c, { x: r.x + 3, y: r.y + (r.h - size) / 2, w: size, h: size });
      if (c.twoWay) this.badge(r.x + 4, r.y + 3);
      ctx.fillStyle = C.fg;
      ctx.font = `600 15px ${FONT}`;
      ctx.fillText(fit(ctx, c.name, r.x + r.w - textX - 4), textX, r.y + r.h / 2 - 7);
      ctx.fillStyle = C.muted;
      ctx.font = `700 11px ${FONT}`;
      ctx.fillText(label, textX, r.y + r.h / 2 + 10);
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = `600 13px ${FONT}`;
      ctx.fillText(label, r.x + 10, r.y + r.h / 2);
    }
  }

  private badge(x: number, y: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 11px ${FONT}`;
    const w = ctx.measureText("2W").width + 6;
    ctx.fillStyle = C.ink;
    ctx.fillRect(x, y, w, 15);
    ctx.fillStyle = C.twoWay;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("2W", x + 3, y + 8);
    ctx.restore();
  }

  /** An ink-outlined box: optional hard offset shadow, optional fill, then the outline. */
  private ink(r: Rect, width: number, opts: { fill?: string; shadow?: number } = {}) {
    const ctx = this.ctx;
    if (opts.shadow) {
      const d = opts.shadow;
      // Only the strips below and to the right, so nothing already drawn in `r` is covered.
      ctx.fillStyle = C.ink;
      ctx.fillRect(r.x + d, r.y + r.h, r.w, d);
      ctx.fillRect(r.x + r.w, r.y + d, d, r.h);
    }
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = width;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }

  private portrait(c: Character, r: Rect) {
    const { tile, columns } = this.list.atlas;
    const sx = (c.atlasIndex % columns) * tile;
    const sy = Math.floor(c.atlasIndex / columns) * tile;
    this.ctx.drawImage(this.atlas, sx, sy, tile, tile, r.x, r.y, r.w, r.h);
    this.portraits.push(r);
  }

  private char(id: string | null): Character | undefined {
    return id ? this.list.byId.get(id) : undefined;
  }
}

/** Truncate with an ellipsis to fit `max` px in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
