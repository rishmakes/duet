import { describe, expect, it } from "vitest";
import { getChat, setMinimized } from "./chat";

const store = new Map<string, string>();
// @ts-expect-error mock storage for node test environment
globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)) };

describe("minimising the chat", () => {
  it("is remembered, so the chat stays out of the way after a restart", () => {
    setMinimized(true);
    expect(getChat().minimized).toBe(true);
    expect(localStorage.getItem("duet:chat-min")).toBe("1");
    setMinimized(false);
    expect(getChat().minimized).toBe(false);
    expect(localStorage.getItem("duet:chat-min")).toBe("0");
  });
});
