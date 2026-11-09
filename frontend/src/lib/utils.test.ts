import { describe, expect, it } from "vitest";
import { cn } from "./utils";
import { initialsOf } from "./initials";

describe("cn", () => {
  it("joins class names and skips falsy ones", () => {
    const off = Boolean(0); // a real condition would be a variable, not the literal false
    expect(cn("a", off && "b", undefined, null, "c", { d: true, e: false })).toBe("a c d");
  });

  it("lets a later class win over an earlier conflicting one, so a passed className overrides a component's defaults", () => {
    expect(cn("px-2 py-1 text-sm", "px-4")).toBe("py-1 text-sm px-4");
    expect(cn("h-8 rounded-lg", "h-6")).toBe("rounded-lg h-6");
    expect(cn("bg-primary text-primary-foreground", "bg-destructive/10")).toBe("text-primary-foreground bg-destructive/10");
  });

  it("keeps classes that do not conflict", () => {
    expect(cn("flex items-center", "gap-3")).toBe("flex items-center gap-3");
  });
});

describe("initialsOf", () => {
  it("uses the first and last word", () => {
    expect(initialsOf("Priya Sharma")).toBe("PS");
    expect(initialsOf("  priya   kumari  sharma ")).toBe("PS");
  });
  it("uses one letter for one word, and nothing for nothing", () => {
    expect(initialsOf("Ananya")).toBe("A");
    expect(initialsOf("")).toBe("");
  });
});
