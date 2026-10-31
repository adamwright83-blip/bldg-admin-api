import { describe, expect, it } from "vitest";
import { MaterialBook } from "./material";

describe("material the interpreter hasn't read yet", () => {
  it("includes an item a later read expanded, under the same handle", () => {
    const book = new MaterialBook("sam@example.com");
    const header = { id: "m1", threadId: "t1", at: new Date("2026-10-01T12:00:00Z"), from: { name: "Sam", email: "sam@example.com" }, to: [{ name: "Ana", email: "ana@example.com" }], subject: "Routes", snippet: "short", sentByOwner: true, automated: false, url: "" };
    const first = book.mail(header);
    expect(book.takeChanged().map(item => item.handle)).toEqual([first.handle]);
    expect(book.takeChanged()).toEqual([]);
    // the whole thread is read: the same message, now with its body and signature
    const full = book.mail({ ...header, text: "Can you take the Tuesday route?\n\nSam\nRinse Farm", attachments: [] });
    expect(full.handle).toBe(first.handle);
    const changed = book.takeChanged();
    expect(changed.map(item => item.handle)).toEqual([first.handle]);
    expect(changed[0].text).toContain("Rinse Farm");
    // the same snippet again is not a change
    book.mail(header);
    expect(book.takeChanged()).toEqual([]);
  });
});
