import type { LoadedList } from "./lists";

/** One portrait from a list's sprite atlas, drawn at `size` px. */
export function Sprite({
  list,
  index,
  size,
}: {
  list: Pick<LoadedList, "atlas" | "atlasUrl">;
  index: number;
  size: number;
}) {
  const { columns, count } = list.atlas;
  const rows = Math.ceil(count / columns);
  return (
    <span
      className="sprite"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${list.atlasUrl})`,
        backgroundSize: `${columns * size}px ${rows * size}px`,
        backgroundPosition: `-${(index % columns) * size}px -${Math.floor(index / columns) * size}px`,
      }}
    />
  );
}
