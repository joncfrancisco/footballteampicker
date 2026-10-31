/** Field rows (0–100 units, line of scrimmage at 50) each view shows. */
export const VIEW = {
  offense: { yMin: 46, yMax: 72 },
  defense: { yMin: 20, yMax: 52 },
  // Facing each other on a wide screen, the two fields meet at the line of scrimmage.
  faceOffense: { yMin: 50, yMax: 72 },
  faceDefense: { yMin: 20, yMax: 50 },
} as const;

/** Pixels per field unit of depth; a field's height is (yMax - yMin) × scale. */
export const SCALE = { narrow: 15, wide: 12 } as const;

export const NARROW_WIDTH = 700;

export const TILE = {
  narrow: { width: 46, height: 50, sprite: 34 },
  wide: { width: 72, height: 84, sprite: 52 },
} as const;
