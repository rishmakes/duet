/**
 * What is picked in Media, as one small set of rules: the state before, one thing the person did, the state after.
 * `order` is what Media shows right now, top to bottom; picks never hold a thing that is not shown.
 */
export type Picks = {
  /** picked, in the order Media shows them */
  ids: string[];
  /** where Shift-click picks from */
  anchor: string | null;
  /** a press on one of several picked keeps them all (so they drag together); the click that follows narrows to it */
  narrow: string | null;
};

export type PickAct =
  | { type: "press"; id: string; shift?: boolean; toggle?: boolean }
  | { type: "click"; id: string }
  | { type: "tick"; id: string }
  | { type: "menu"; id: string }
  | { type: "all" }
  | { type: "none" }
  | { type: "dragEnd" }
  | { type: "shown" };

export const noPicks: Picks = { ids: [], anchor: null, narrow: null };

const inOrder = (ids: Iterable<string>, order: string[]) => {
  const set = new Set(ids);
  return order.filter((id) => set.has(id));
};

export function pick(s: Picks, a: PickAct, order: string[]): Picks {
  switch (a.type) {
    case "press": {
      if (a.shift) {
        const from = s.anchor && order.includes(s.anchor) ? s.anchor : a.id;
        const i = order.indexOf(from);
        const j = order.indexOf(a.id);
        if (j < 0) return s;
        return { ids: order.slice(Math.min(i, j), Math.max(i, j) + 1), anchor: from, narrow: null };
      }
      if (a.toggle) return pick(s, { type: "tick", id: a.id }, order);
      if (s.ids.includes(a.id) && s.ids.length > 1) return { ...s, narrow: a.id };
      return { ids: [a.id], anchor: a.id, narrow: null };
    }
    case "click":
      if (s.narrow === a.id) return { ids: [a.id], anchor: a.id, narrow: null };
      return s.narrow ? { ...s, narrow: null } : s;
    case "tick": {
      const ids = s.ids.includes(a.id) ? s.ids.filter((x) => x !== a.id) : inOrder([...s.ids, a.id], order);
      return { ids, anchor: a.id, narrow: null };
    }
    case "menu":
      return s.ids.includes(a.id) ? { ...s, narrow: null } : { ids: [a.id], anchor: a.id, narrow: null };
    case "all":
      return { ids: [...order], anchor: s.anchor, narrow: null };
    case "none":
      return s.ids.length || s.narrow ? noPicks : s;
    case "dragEnd":
      return s.narrow ? { ...s, narrow: null } : s;
    case "shown": {
      const ids = inOrder(s.ids, order);
      const anchor = s.anchor && order.includes(s.anchor) ? s.anchor : null;
      const narrow = s.narrow && order.includes(s.narrow) ? s.narrow : null;
      if (ids.length === s.ids.length && anchor === s.anchor && narrow === s.narrow) return s;
      return { ids, anchor, narrow };
    }
  }
}
