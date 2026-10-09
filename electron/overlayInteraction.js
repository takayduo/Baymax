'use strict';

// Match the renderer's wake strip and use hysteresis at the painted edge.
// A single hit region prevents click-through from flapping between two owners.
function pointerInside(x, y, rect, wasInside = false) {
  if (![x, y, rect?.x, rect?.y, rect?.w, rect?.h].every(Number.isFinite)) return false;
  const hidden = rect.h <= 1;
  const width = hidden ? 240 : Math.max(0, rect.w);
  const left = rect.x + (rect.w - width) / 2;
  const height = hidden ? 6 : Math.max(0, rect.h);
  const margin = wasInside ? 10 : 6;
  return x >= left - margin && x <= left + width + margin &&
    y >= rect.y && y <= rect.y + height + margin;
}

function createMousePassthrough(apply) {
  let previous;
  return ignore => {
    const next = Boolean(ignore);
    if (next === previous) return false;
    apply(next, next ? { forward: true } : undefined);
    previous = next;
    return true;
  };
}

module.exports = { pointerInside, createMousePassthrough };
