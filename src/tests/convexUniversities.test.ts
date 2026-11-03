import { describe, expect, it, vi } from "vitest";
import { getByLegacyId, list, search } from "../../convex/universities";

type QueryHandler<Args, Result> = {
  _handler(ctx: unknown, args: Args): Promise<Result>;
};
type PaginationArgs = {
  paginationOpts: { numItems: number; cursor: string | null };
};
type CatalogPage = {
  page: Record<string, unknown>[];
  continueCursor: string | null;
  isDone: boolean;
};

const listHandler = list as unknown as QueryHandler<PaginationArgs, CatalogPage>;
const searchHandler = search as unknown as QueryHandler<
  PaginationArgs & { searchTerm: string; state?: string; type?: string },
  CatalogPage
>;
const detailHandler = getByLegacyId as unknown as QueryHandler<
  { legacyId: number },
  Record<string, unknown> | null
>;

const university = {
  _id: "universities:1",
  _creationTime: 10,
  legacyId: 41,
  searchText: "North University Dehradun",
  name: "North University",
  state: "Uttarakhand",
};

const review = {
  legacyId: 90,
  userEmail: "private@example.test",
  userName: "Sara",
  rating: 4,
  comment: "Great campus.",
  avatar: null,
  reviewDate: "2026-01-01",
};

function makeReviewsQuery(rows = [review]) {
  const eq = vi.fn();
  const collect = vi.fn().mockResolvedValue(rows);
  const order = vi.fn(() => ({ collect }));
  const withIndex = vi.fn((_name, build) => {
    build({ eq });
    return { order };
  });
  return { query: { withIndex }, eq, collect, order, withIndex };
}

function asQueryContext(db: unknown) {
  return { db };
}

describe("public Convex university queries", () => {
  it("lists records in legacy-ID order with a maximum page size of 100", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [university],
      continueCursor: "next",
      isDone: false,
    });
    const order = vi.fn(() => ({ paginate }));
    const withIndex = vi.fn(() => ({ order }));
    const reviewsQuery = makeReviewsQuery();
    const db = {
      query: vi.fn((table: string) =>
        table === "reviews" ? reviewsQuery.query : { withIndex },
      ),
    };

    const result = await listHandler._handler(asQueryContext(db), {
      paginationOpts: { numItems: 500, cursor: null },
    });

    expect(db.query).toHaveBeenCalledWith("universities");
    expect(withIndex).toHaveBeenCalledWith("by_legacy_id");
    expect(order).toHaveBeenCalledWith("asc");
    expect(paginate).toHaveBeenCalledWith({ numItems: 100, cursor: null });
    expect(reviewsQuery.withIndex).toHaveBeenCalledWith(
      "by_university_date",
      expect.any(Function),
    );
    expect(reviewsQuery.eq).toHaveBeenCalledWith("universityId", university._id);
    expect(result.page).toEqual([
      {
        name: "North University",
        state: "Uttarakhand",
        id: 41,
        reviews: [
          {
            id: 90,
            userName: "Sara",
            rating: 4,
            comment: "Great campus.",
            avatar: null,
            reviewDate: "2026-01-01",
          },
        ],
        reviewCount: 1,
        averageReview: 4,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(result).toMatchObject({ continueCursor: "next", isDone: false });
  });

  it("searches only the university search index and applies supported filters", async () => {
    const eq = vi.fn(function (this: unknown) {
      return this;
    });
    const searchIndexBuilder = {
      search: vi.fn(() => searchIndexBuilder),
      eq,
    };
    const paginate = vi.fn().mockResolvedValue({
      page: [university],
      continueCursor: null,
      isDone: true,
    });
    const withSearchIndex = vi.fn((_name, build) => {
      build(searchIndexBuilder);
      return { paginate };
    });
    const reviewsQuery = makeReviewsQuery([]);
    const db = {
      query: vi.fn((table: string) =>
        table === "reviews" ? reviewsQuery.query : { withSearchIndex },
      ),
    };

    const result = await searchHandler._handler(asQueryContext(db), {
      searchTerm: "  North  ",
      state: "Uttarakhand",
      type: "Public",
      paginationOpts: { numItems: 20, cursor: null },
    });

    expect(withSearchIndex).toHaveBeenCalledWith("search_text", expect.any(Function));
    expect(searchIndexBuilder.search).toHaveBeenCalledWith("searchText", "North");
    expect(eq).toHaveBeenNthCalledWith(1, "state", "Uttarakhand");
    expect(eq).toHaveBeenNthCalledWith(2, "type", "Public");
    expect(paginate).toHaveBeenCalledWith({ numItems: 20, cursor: null });
    expect(result.page[0]).toMatchObject({
      id: 41,
      name: "North University",
      reviews: [],
      reviewCount: 0,
      averageReview: 0,
    });
  });

  it("rejects an empty search and resolves details by preserved legacy ID", async () => {
    const unique = vi.fn().mockResolvedValue(university);
    const eq = vi.fn();
    const withIndex = vi.fn((_name, build) => {
      build({ eq });
      return { unique };
    });
    const reviewsQuery = makeReviewsQuery([]);
    const db = {
      query: vi.fn((table: string) =>
        table === "reviews" ? reviewsQuery.query : { withIndex },
      ),
    };

    await expect(
      searchHandler._handler(asQueryContext(db), {
        searchTerm: " ",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Search term must contain 1 to 100 characters.");

    const detail = await detailHandler._handler(asQueryContext(db), { legacyId: 41 });
    expect(withIndex).toHaveBeenCalledWith("by_legacy_id", expect.any(Function));
    expect(eq).toHaveBeenCalledWith("legacyId", 41);
    expect(unique).toHaveBeenCalledOnce();
    expect(detail).toEqual({
      name: "North University",
      state: "Uttarakhand",
      id: 41,
      reviews: [],
      reviewCount: 0,
      averageReview: 0,
    });

    await expect(
      detailHandler._handler(asQueryContext(db), { legacyId: 0 }),
    ).rejects.toThrow("University ID must be a positive safe integer.");
  });

  it("exposes only allowlisted university fields and sanitizes nested data", async () => {
    const taintedUniversity = {
      ...university,
      createdAt: 1234,
      hiddenInternalField: "must-not-leak",
      alumniStories: [
        {
          id: 1,
          name: "Test Alumni",
          role: "Engineer",
          company: "Example Corp",
          graduationYear: 2024,
          quote: "Synthetic test story",
          image: "test-image",
          internalNotes: "must-not-leak",
        },
        {
          id: "invalid-id",
          name: "Malformed record",
        },
      ],
      campusMap: {
        acreage: 10,
        established: 2000,
        hasHostels: true,
        totalBuildings: 4,
        adminContact: "must-not-leak",
        zones: [
          {
            id: "zone-1",
            name: "Academic Block",
            description: "Test zone",
            type: "academic",
            highlights: ["Labs"],
            capacity: "100",
            internalNotes: "must-not-leak",
          },
          {
            id: "zone-2",
            name: "Invalid Zone",
            description: "Invalid type",
            type: "secret",
            highlights: [],
          },
        ],
      },
      directoryProfile: {
        sourceName: "Test Source",
        established: "2020",
        accreditation: "Test accreditation",
        rankings: "Test ranking",
        courses: "Engineering",
        feeRange: "Not reported",
        scholarships: "Not reported",
        sourceNote: "Synthetic fixture",
        directoryOnly: false,
        hiddenDebugPayload: "must-not-leak",
      },
    };

    const paginate = vi.fn().mockResolvedValue({
      page: [taintedUniversity],
      continueCursor: null,
      isDone: true,
    });
    const order = vi.fn(() => ({ paginate }));
    const withIndex = vi.fn(() => ({ order }));
    const reviewsQuery = makeReviewsQuery([]);
    const db = {
      query: vi.fn((table: string) =>
        table === "reviews" ? reviewsQuery.query : { withIndex },
      ),
    };

    const result = await listHandler._handler(asQueryContext(db), {
      paginationOpts: { numItems: 10, cursor: null },
    });

    const row = result.page[0];

    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("_id");
    expect(row).not.toHaveProperty("_creationTime");
    expect(row).not.toHaveProperty("searchText");
    expect(row).not.toHaveProperty("legacyId");
    expect(row).not.toHaveProperty("hiddenInternalField");

    // createdAt is intentionally part of the public response contract.
    expect(row.createdAt).toBe(1234);

    const alumniStories = row.alumniStories as
      | Array<Record<string, unknown>>
      | undefined;

    expect(alumniStories).toHaveLength(1);
    expect(alumniStories?.[0]).toMatchObject({
      name: "Test Alumni",
      company: "Example Corp",
    });
    expect(alumniStories?.[0]).not.toHaveProperty("internalNotes");

    const campusMap = row.campusMap as Record<string, unknown> | undefined;

    expect(campusMap).toBeDefined();
    expect(campusMap).not.toHaveProperty("adminContact");

    const zones = campusMap?.zones as
      | Array<Record<string, unknown>>
      | undefined;

    expect(zones).toHaveLength(1);
    expect(zones?.[0]).not.toHaveProperty("internalNotes");
    expect(zones?.[0].type).toBe("academic");

    const directoryProfile = row.directoryProfile as
      | Record<string, unknown>
      | undefined;

    expect(directoryProfile).toMatchObject({
      sourceName: "Test Source",
      courses: "Engineering",
    });
    expect(directoryProfile).not.toHaveProperty("hiddenDebugPayload");
  });
});