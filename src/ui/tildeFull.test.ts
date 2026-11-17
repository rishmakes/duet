import { describe, expect, it } from "vitest";
import { tildeChange } from "./tildeFull";

const none = { chatFull: false, timeMax: false, canvasMax: false };

describe("tilde fills the window with the part under the pointer", () => {
  it("the timeline, the picture or the chat, by where the pointer is", () => {
    expect(tildeChange(none, "`", "time", false)).toEqual({ timeMax: true });
    expect(tildeChange(none, "~", "canvas", false)).toEqual({ canvasMax: true });
    expect(tildeChange(none, "`", "chat", false)).toEqual({ chatFull: true });
    expect(tildeChange(none, "`", null, false)).toBeNull();
  });

  it("tilde again or Escape brings everything back", () => {
    const full = { ...none, timeMax: true };
    expect(tildeChange(full, "`", "time", false)).toEqual(none);
    expect(tildeChange(full, "Escape", null, false)).toEqual(none);
    expect(tildeChange(none, "Escape", null, false)).toBeNull();
  });

  it("keeps the key while typing in a box, and ignores other keys", () => {
    expect(tildeChange(none, "`", "time", true)).toBeNull();
    expect(tildeChange(none, "a", "time", false)).toBeNull();
  });
});
