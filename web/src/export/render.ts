import {
  LOS_Y,
  at,
  findFormation,
  formationLabel,
  slotsFor,
  sportOf,
  unitRows,
  type SectionDef,
  type Character,
  type Slot,
  type Spot,
  type Team,
} from "@ftp/shared";
import { layoutSlots } from "../field/layout";
import { VIEW } from "../field/views";
import type { LoadedList } from "../lists";

/**
 * PNG exports, drawn straight onto a canvas: shapes and text, then each portrait with
 * drawImage from the list's (same-origin) sprite atlas. No DOM capture, so no missed CSS
 * sprites or font races, and one image decode.
 */
export type Layout = "field" | "offense" | "defense" | "depth";

export const LAYOUTS: Record<Layout, { label: string; file: string }> = {
  field: { label: "Field, both sides", file: "field" },
  offense: { label: "Field, offense", file: "offense" },
  defense: { label: "Field, defense", file: "defense" },
  depth: { label: "Depth chart", file: "depth-chart" },
};

export type Rect = { x: number; y: number; w: number; h: number };
export type Rendered = { canvas: HTMLCanvasElement; portraits: Rect[] };

const C = {
  bg: "#f6f7f5",
  fg: "#1c1f1d",
  muted: "#5d6660",
  border: "#d3d8d4",
  surface: "#ffffff",
  turf: "#2f7a3e",
  line: "rgba(255,255,255,0.55)",
  los: "#5aa9ff",
  tile: "#10331b",
  tileEmpty: "rgba(255,255,255,0.14)",
  accent: "#1f6feb",
  twoWay: "#8a4fff",
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PAD = 40;
const HEADER_H = PAD + 92;
const FOOTER_H = 100;
/** One side on its own: a little tighter around the formation than the on-screen tab. */
const SINGLE_VIEW = { offense: { yMin: 47, yMax: 71 }, defense: { yMin: 21, yMax: 51 } };

export function exportFilename(title: string, layout: Layout): string {
  const slug =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // accents: "ï" -> "i"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team";
  return `${slug}-${LAYOUTS[layout].file}.png`;
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
  const [atlas] = await Promise.all([loadAtlas(list.atlasUrl), document.fonts?.ready]);
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

  field(team: Team, layout: "field" | "offense" | "defense", url?: string): Rendered {
    const sport = sportOf(team);
    const offense = findFormation(sport, team.units.offense!.formation)!;
    const defense = findFormation(sport, team.units.defense!.formation)!;
    const staff = sport.sections.find((s) => s.kind === "staff" && team.sections?.[s.id]);
    const situational = sport.sections.find(
      (s) => s.kind === "situational" && team.sections?.[s.id],
    );
    const both = layout === "field";
    const [W, H] = both ? [1600, 900] : [1080, 1350];
    this.begin(W, H);

    const subtitle = both
      ? `${formationLabel(offense)} vs ${formationLabel(defense)}`
      : layout === "offense"
        ? formationLabel(offense)
        : formationLabel(defense);
    let top = this.header(team.title, subtitle, W);
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
        const panelH = 4 * 58 + 44;
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
    if (both) {
      const defSpan = VIEW.faceDefense.yMax - VIEW.faceDefense.yMin;
      const offSpan = VIEW.faceOffense.yMax - VIEW.faceOffense.yMin;
      const defH = Math.round((fieldArea.h * defSpan) / (defSpan + offSpan));
      this.fieldSide(
        team,
        "defense",
        defense.slots,
        { ...fieldArea, h: defH },
        VIEW.faceDefense,
        tile,
      );
      this.fieldSide(
        team,
        "offense",
        slotsFor(offense, team.units.offense!.align),
        { ...fieldArea, y: fieldArea.y + defH, h: fieldArea.h - defH },
        VIEW.faceOffense,
        tile,
      );
    } else {
      const side = layout;
      const slots =
        side === "offense" ? slotsFor(offense, team.units.offense!.align) : defense.slots;
      this.fieldSide(team, side, slots, fieldArea, SINGLE_VIEW[side], tile);
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

    const body = sections.reduce((h, s) => h + 40 + s.rows.length * ROW + 20, 0);
    const H = Math.max(1350, HEADER_H + body + FOOTER_H);
    this.begin(W, H);
    let y = this.header(team.title, "Depth chart", W);
    this.footer(W, H, url);

    const labelW = 70;
    const cellW =
      (W - 2 * PAD - labelW) / Math.max(6, ...sections.flatMap((s) => s.rows.map(([, n]) => n)));
    const ctx = this.ctx;
    for (const s of sections) {
      ctx.fillStyle = C.fg;
      ctx.font = `600 22px ${FONT}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(s.title, PAD, y + 26);
      y += 40;
      for (const [pos, n] of s.rows) {
        ctx.fillStyle = C.muted;
        ctx.font = `600 16px ${FONT}`;
        ctx.textBaseline = "middle";
        ctx.fillText(pos, PAD, y + ROW / 2);
        for (let index = 0; index < n; index++) {
          const r = { x: PAD + labelW + index * cellW + 2, y: y + 3, w: cellW - 4, h: ROW - 6 };
          this.cell(
            r,
            this.char(at(team, { side: s.side, pos, index })),
            s.side === "staff" ? pos : `${pos}${index + 1}`,
          );
        }
        y += ROW;
      }
      y += 20;
    }
    return { canvas: this.canvas, portraits: this.portraits };
  }

  // ---- Pieces --------------------------------------------------------------------------

  private header(title: string, subtitle: string, W: number): number {
    const ctx = this.ctx;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.fg;
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(fit(ctx, title, W - 2 * PAD), PAD, PAD + 36);
    ctx.fillStyle = C.muted;
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(fit(ctx, `${this.list.title} · ${subtitle}`, W - 2 * PAD), PAD, PAD + 70);
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
    ctx.fillStyle = C.fg;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(url ?? "depthchart.joncfrancis.co", PAD, y);
    return y - 30;
  }

  private fieldSide(
    team: Team,
    side: "offense" | "defense",
    slots: Slot[],
    area: Rect,
    view: { yMin: number; yMax: number },
    tile: { width: number; height: number; sprite: number },
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = C.turf;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    const yPx = (y: number) => area.y + ((y - view.yMin) / (view.yMax - view.yMin)) * area.h;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    for (let y = LOS_Y - 50; y <= LOS_Y + 50; y += 10)
      if (y > view.yMin && y < view.yMax) line(ctx, area.x, yPx(y), area.x + area.w, yPx(y));
    for (let y = Math.ceil(view.yMin / 2) * 2; y < view.yMax; y += 2)
      for (const x of [0.5, 44.3, 55.7, 99.5]) {
        const px = area.x + (x / 100) * area.w;
        line(ctx, px - 6, yPx(y), px + 6, yPx(y));
      }
    if (LOS_Y >= view.yMin && LOS_Y <= view.yMax) {
      ctx.strokeStyle = C.los;
      ctx.lineWidth = 3;
      line(ctx, area.x, yPx(LOS_Y), area.x + area.w, yPx(LOS_Y));
    }
    ctx.restore();

    const placed = layoutSlots({
      slots,
      ...view,
      width: area.w,
      height: area.h,
      tile,
      away: side === "offense" ? 1 : -1,
    });
    const byId = new Map(slots.map((s) => [s.id, s]));
    for (const p of placed) {
      const slot = byId.get(p.id)!;
      const c = this.char(at(team, { side, pos: slot.ref.pos, index: slot.ref.depth - 1 }));
      this.fieldTile(
        {
          x: area.x + p.left - tile.width / 2,
          y: area.y + p.top - tile.height / 2,
          w: tile.width,
          h: tile.height,
        },
        c,
        `${slot.label} · ${slot.ref.pos}${slot.ref.depth}`,
        tile.sprite,
      );
    }
  }

  private fieldTile(r: Rect, c: Character | undefined, label: string, sprite: number) {
    const ctx = this.ctx;
    roundRect(ctx, r, 8);
    ctx.fillStyle = c ? C.tile : C.tileEmpty;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    if (!c) ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const cx = r.x + r.w / 2;
    if (c) {
      this.portrait(c, { x: cx - sprite / 2, y: r.y + 5, w: sprite, h: sprite });
      ctx.font = `500 ${Math.round(sprite / 4.5)}px ${FONT}`;
      ctx.fillText(fit(ctx, c.name, r.w - 6), cx, r.y + sprite + 5 + Math.round(sprite / 4));
      if (c.twoWay) this.badge(r.x + 3, r.y + 3);
    }
    ctx.font = `700 ${Math.round(sprite / 5)}px ${FONT}`;
    ctx.fillText(fit(ctx, label, r.w - 6), cx, r.y + r.h - 6);
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
        `${pos}${index + 1}`,
      );
    });
  }

  private panelTitle(text: string, x: number, y: number) {
    const ctx = this.ctx;
    ctx.fillStyle = C.muted;
    ctx.font = `600 16px ${FONT}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + 18);
  }

  /** A light card: portrait, name and a small label (depth chart, staff, special teams). */
  private cell(r: Rect, c: Character | undefined, label: string) {
    const ctx = this.ctx;
    roundRect(ctx, r, 6);
    ctx.fillStyle = c ? C.surface : C.bg;
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    if (!c) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    const size = Math.min(r.h - 6, 40);
    const textX = r.x + 3 + size + 8;
    ctx.textBaseline = "middle";
    if (c) {
      this.portrait(c, { x: r.x + 3, y: r.y + (r.h - size) / 2, w: size, h: size });
      if (c.twoWay) this.badge(r.x + 4, r.y + 3);
      ctx.fillStyle = C.fg;
      ctx.font = `500 15px ${FONT}`;
      ctx.fillText(fit(ctx, c.name, r.x + r.w - textX - 4), textX, r.y + r.h / 2 - 7);
      ctx.fillStyle = C.muted;
      ctx.font = `600 11px ${FONT}`;
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
    roundRect(ctx, { x, y, w, h: 15 }, 3);
    ctx.fillStyle = C.twoWay;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("2W", x + 3, y + 8);
    ctx.restore();
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

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

/** Truncate with an ellipsis to fit `max` px in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
