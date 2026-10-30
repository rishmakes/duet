import { describe, expect, it } from "vitest";
import { matchProjects } from "./ChatHome";

describe("projects beside the chat", () => {
  const all = [
    { name: "Poster for Kapil", path: "/a.duet" },
    { name: "Site", path: "/b.duet" },
    { name: "kapil logo", path: "/c.duet" },
  ];
  it("lists every project when nothing is typed", () => {
    expect(matchProjects(all, "  ")).toHaveLength(3);
  });
  it("finds by part of the name, ignoring capitals", () => {
    expect(matchProjects(all, "KAPIL").map((r) => r.name)).toEqual(["Poster for Kapil", "kapil logo"]);
    expect(matchProjects(all, "zzz")).toEqual([]);
  });
  it("finds by the words inside a project, such as its text or what was asked", () => {
    const words = (path: string) => (path === "/b.duet" ? "hero frame\nsummer sale" : undefined);
    expect(matchProjects(all, "Summer", words).map((r) => r.name)).toEqual(["Site"]);
    expect(matchProjects(all, "kapil", words).map((r) => r.name)).toEqual(["Poster for Kapil", "kapil logo"]);
  });
});
