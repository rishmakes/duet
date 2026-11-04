import { describe, expect, it } from "vitest";
import { openPage, showAllPages, resetPageFocus, getActivePage, isAllPages, newPageFromAi } from "./pageFocus";
import { emptyDoc } from "../document/types";
import { runCommand } from "../commands";

describe("pageFocus", () => {
  it("initializes cleanly with first page when pages enabled", () => {
    resetPageFocus();
    let doc = runCommand(emptyDoc(), "set_pages", { on: true });
    doc = runCommand(doc, "add_page", { id: "p1" });
    doc = runCommand(doc, "add_page", { id: "p2" });

    expect(getActivePage(doc)).toBe("p1");
    expect(isAllPages(doc)).toBe(false);
  });

  it("sets active page and clears all-pages mode", () => {
    resetPageFocus();
    let doc = runCommand(emptyDoc(), "set_pages", { on: true });
    doc = runCommand(doc, "add_page", { id: "p1" });
    doc = runCommand(doc, "add_page", { id: "p2" });

    showAllPages();
    expect(isAllPages(doc)).toBe(true);
    expect(getActivePage(doc)).toBeNull();

    openPage("p2");
    expect(isAllPages(doc)).toBe(false);
    expect(getActivePage(doc)).toBe("p2");
  });

  it("resets page focus cleanly so all-pages does not leak to other designs", () => {
    resetPageFocus();
    let doc1 = runCommand(emptyDoc(), "set_pages", { on: true });
    doc1 = runCommand(doc1, "add_page", { id: "tab1-p1" });

    showAllPages();
    expect(isAllPages(doc1)).toBe(true);

    // Tab change occurs: resetPageFocus is called
    resetPageFocus();

    let doc2 = runCommand(emptyDoc(), "set_pages", { on: true });
    doc2 = runCommand(doc2, "add_page", { id: "tab2-p1" });

    expect(isAllPages(doc2)).toBe(false);
    expect(getActivePage(doc2)).toBe("tab2-p1");
  });
});

describe("following the AI to a new page", () => {
  const pages = () => runCommand(runCommand(emptyDoc(), "set_pages", { on: true }), "add_page", { id: "p1" });
  it("goes to the page an AI just made, and never moves for the designer's own page", () => {
    const before = pages();
    const after = runCommand(before, "add_page", { id: "p2" });
    expect(newPageFromAi(before, after, "Claude Code")).toBe("p2");
    expect(newPageFromAi(before, after, "you")).toBeNull();
  });
  it("stays put when the AI changes things on the page already open", () => {
    const before = pages();
    expect(newPageFromAi(before, before, "Claude Code")).toBeNull();
  });
});
