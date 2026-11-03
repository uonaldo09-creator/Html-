export interface BookmarkRecord {
  userEmail: string;
  universityId: number;
  createdAt?: string;
}

export interface BookmarkToggleResult {
  added: boolean;
  action: "added" | "removed";
  bookmarks: number[];
}

export function toggleInMemoryBookmark(
  currentBookmarks: BookmarkRecord[],
  email: string,
  universityId: number,
  createdAt = new Date().toISOString(),
): { nextBookmarks: BookmarkRecord[]; result: BookmarkToggleResult } {
  const normalizedEmail = email.toLowerCase();
  const exists = currentBookmarks.some(
    (bookmark) => bookmark.userEmail.toLowerCase() === normalizedEmail && bookmark.universityId === universityId,
  );
  const nextBookmarks = exists
    ? currentBookmarks.filter(
        (bookmark) => !(bookmark.userEmail.toLowerCase() === normalizedEmail && bookmark.universityId === universityId),
      )
    : [...currentBookmarks, { userEmail: email, universityId, createdAt }];

  return {
    nextBookmarks,
    result: {
      added: !exists,
      action: exists ? "removed" : "added",
      bookmarks: nextBookmarks
        .filter((bookmark) => bookmark.userEmail.toLowerCase() === normalizedEmail)
        .map((bookmark) => bookmark.universityId),
    },
  };
}
