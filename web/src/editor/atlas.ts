import type { Character } from "@ftp/shared";
import type { LoadedList } from "../lists";

export type EditorCharacter = Character & {
  portrait: HTMLImageElement | HTMLCanvasElement | null;
  crop: { x: number; y: number; zoom: number };
};
export const emptyCrop = () => ({ x: 0, y: 0, zoom: 1 });
export function namedCharacter(name: string, index: number): EditorCharacter {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40),
    tags: [],
    twoWay: false,
    atlasIndex: index,
    portrait: null,
    crop: emptyCrop(),
  };
}
function canvas(width = 128, height = 128) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
export async function image(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
export async function filePortrait(file: File) {
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type) || file.size > 8_000_000)
    throw new Error("Choose a PNG, JPEG, WebP, GIF, or AVIF image under 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    return await image(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function slicePortraits(list: LoadedList): Promise<EditorCharacter[]> {
  const atlas = await image(list.atlasUrl);
  return list.characters.map((character) => {
    const portrait = canvas();
    const { columns, tile } = list.atlas;
    portrait
      .getContext("2d")!
      .drawImage(
        atlas,
        (character.atlasIndex % columns) * tile,
        Math.floor(character.atlasIndex / columns) * tile,
        tile,
        tile,
        0,
        0,
        128,
        128,
      );
    return { ...character, portrait, crop: emptyCrop() };
  });
}
export function drawPortrait(target: HTMLCanvasElement, character: EditorCharacter) {
  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = "#284456";
  ctx.fillRect(0, 0, 128, 128);
  if (character.portrait) {
    const p = character.portrait;
    const scale = (128 / Math.min(p.width, p.height)) * character.crop.zoom;
    const w = p.width * scale,
      h = p.height * scale;
    ctx.drawImage(
      p,
      (128 - w) / 2 + (character.crop.x * (w - 128)) / 2,
      (128 - h) / 2 + (character.crop.y * (h - 128)) / 2,
      w,
      h,
    );
  } else {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 44px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      character.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => [...s][0])
        .join("")
        .toUpperCase(),
      64,
      66,
    );
  }
}
export async function buildAtlas(characters: EditorCharacter[]): Promise<Blob> {
  const atlas = canvas(128 * 16, 128 * Math.ceil(characters.length / 16));
  const ctx = atlas.getContext("2d")!;
  const tile = canvas();
  characters.forEach((character, i) => {
    drawPortrait(tile, character);
    ctx.drawImage(tile, (i % 16) * 128, Math.floor(i / 16) * 128);
  });
  const encode = (mime: string) =>
    new Promise<Blob | null>((resolve) => atlas.toBlob(resolve, mime, 0.85));
  let blob = await encode("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
  if (!blob || !["image/webp", "image/jpeg"].includes(blob.type))
    throw new Error("This browser could not encode an atlas.");
  if (blob.size > 1_500_000)
    throw new Error("The atlas is over 1.5 MB. Try simpler portraits or fewer characters.");
  return blob;
}
