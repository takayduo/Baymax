/** Shared with file suction so the file disappears at the actual mouth. */
export function companionMouth(radius: number, morph: number, openness: number) {
  const m = Math.max(0, Math.min(1, morph));
  return { x: -radius * .48 * m, y: radius * .24, w: radius * .96 * m, h: Math.max(0, openness) * radius * .6 * m };
}
