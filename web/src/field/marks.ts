import type { Mark } from "./surfaces";

/**
 * Surface markings drawn two ways from one list: an SVG overlay on screen and straight onto
 * the export canvas. `sx`/`sy` are pixels per surface unit across and along, so circles stay
 * round however the surface is stretched.
 */
export type Scale = { sx: number; sy: number };

/** An arc as an SVG path in surface units. */
export function arcPath(m: Extract<Mark, { kind: "arc" }>, { sx, sy }: Scale): string {
  const ry = (m.r * sx) / sy;
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${m.cx + m.r * Math.cos(a)} ${m.cy + ry * Math.sin(a)}`;
  };
  const sweep = (((m.to - m.from) % 360) + 360) % 360;
  return `M ${at(m.from)} A ${m.r} ${ry} 0 ${sweep > 180 ? 1 : 0} 1 ${at(m.to)}`;
}

export type Colors = { line: string; fill: string; accent: string };

/** Paint marks onto a canvas area showing surface rows yMin–yMax. */
export function paintMarks(
  ctx: CanvasRenderingContext2D,
  marks: Mark[],
  area: { x: number; y: number; w: number; h: number },
  view: { yMin: number; yMax: number },
  colors: Colors,
) {
  const sx = area.w / 100;
  const sy = area.h / (view.yMax - view.yMin);
  const X = (x: number) => area.x + x * sx;
  const Y = (y: number) => area.y + (y - view.yMin) * sy;
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  for (const m of marks) {
    ctx.beginPath();
    ctx.lineWidth = m.kind === "line" && m.accent ? 3 : 1.5;
    ctx.strokeStyle = m.kind === "line" && m.accent ? colors.accent : colors.line;
    ctx.fillStyle = colors.fill;
    if (m.kind === "line") {
      ctx.moveTo(X(m.x1), Y(m.y1));
      ctx.lineTo(X(m.x2), Y(m.y2));
      ctx.stroke();
      continue;
    }
    if (m.kind === "rect") ctx.rect(X(m.x), Y(m.y), m.w * sx, m.h * sy);
    else if (m.kind === "circle")
      ctx.ellipse(X(m.cx), Y(m.cy), m.r * sx, m.r * sx, 0, 0, 2 * Math.PI);
    else if (m.kind === "arc")
      ctx.ellipse(
        X(m.cx),
        Y(m.cy),
        m.r * sx,
        m.r * sx,
        0,
        (m.from * Math.PI) / 180,
        (m.to * Math.PI) / 180,
      );
    else m.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    if (m.kind === "polygon") ctx.closePath();
    if ("fill" in m && m.fill) ctx.fill();
    else ctx.stroke();
  }
  ctx.restore();
}
