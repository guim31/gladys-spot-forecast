// -----------------------------------------------------------------------------
// Pure computations on forecast slots `{ start: Date, end: Date, price: number }`
// (one hour each, sorted by start, price in €/kWh): no I/O, no clock,
// everything the device, the widget and the scenes read comes from here.
// -----------------------------------------------------------------------------

/**
 * The slot running at `at`.
 * @param {Array} slots
 * @param {Date} at
 */
export function slotAt(slots, at) {
  return slots.find((slot) => slot.start <= at && at < slot.end) ?? null;
}

/**
 * The slot starting when `slot` ends.
 * @param {Array} slots
 * @param {{ end: Date }} slot
 */
export function slotAfter(slots, slot) {
  return slots.find((candidate) => candidate.start.getTime() === slot.end.getTime()) ?? null;
}

/**
 * Average, cheapest and most expensive slot. On a tie the earliest slot wins:
 * the one a scene can still use.
 * @param {Array} slots
 * @returns {{ average: number, min: object, max: object } | null}
 */
export function summarize(slots) {
  if (slots.length === 0) {
    return null;
  }
  let min = slots[0];
  let max = slots[0];
  let sum = 0;
  for (const slot of slots) {
    sum += slot.price;
    if (slot.price < min.price) {
      min = slot;
    }
    if (slot.price > max.price) {
      max = slot;
    }
  }
  return { average: sum / slots.length, min, max };
}

/**
 * The slots between two instants: starting at `from` or later, ending at `to`
 * or earlier.
 * @param {Array} slots
 * @param {number} from ms
 * @param {number} to ms
 */
export function slotsBetween(slots, from, to) {
  return slots.filter((slot) => slot.start.getTime() >= from && slot.end.getTime() <= to);
}

/**
 * The cheapest run of `hours` consecutive slots (no gap between them).
 * On a tie the earliest run wins.
 * @param {Array} slots
 * @param {number} hours
 * @returns {{ start: Date, end: Date, average: number } | null}
 */
export function cheapestWindow(slots, hours) {
  let best = null;
  for (let first = 0; first + hours <= slots.length; first += 1) {
    const run = slots.slice(first, first + hours);
    const contiguous = run.every(
      (slot, index) => index === 0 || slot.start.getTime() === run[index - 1].end.getTime(),
    );
    if (!contiguous) {
      continue;
    }
    const average = run.reduce((sum, slot) => sum + slot.price, 0) / hours;
    if (best === null || average < best.average) {
      best = { start: run[0].start, end: run[hours - 1].end, average };
    }
  }
  return best;
}

/**
 * Round a price for publication: 5 decimals, a thousandth of a cent (the
 * forecast carries more digits than it means).
 * @param {number} value
 */
export function roundPrice(value) {
  return Math.round(value * 1e5) / 1e5;
}
