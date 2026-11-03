import { describe, expect, it } from "vitest";
import { toggleInMemoryBookmark } from "../db/bookmarks";

describe("in-memory bookmark toggle", () => {
  it("adds and removes only the requested user's university bookmark", () => {
    const initial = [
      { userEmail: "student@example.com", universityId: 1 },
      { userEmail: "other@example.com", universityId: 2 },
    ];

    const added = toggleInMemoryBookmark(initial, "STUDENT@example.com", 3, "2026-09-27T10:00:00.000Z");
    expect(added.result).toEqual({
      added: true,
      action: "added",
      bookmarks: [1, 3],
    });
    expect(added.nextBookmarks).toHaveLength(3);

    const removed = toggleInMemoryBookmark(added.nextBookmarks, "student@example.com", 1);
    expect(removed.result).toEqual({
      added: false,
      action: "removed",
      bookmarks: [3],
    });
    expect(removed.nextBookmarks).toEqual([
      { userEmail: "other@example.com", universityId: 2 },
      { userEmail: "STUDENT@example.com", universityId: 3, createdAt: "2026-09-27T10:00:00.000Z" },
    ]);
  });
});
