import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = query;
  },
}));

import {
  getConvexUniversities,
  getConvexUniversityById,
  useConvexUniversityCatalog,
} from "../server/convexUniversityCatalog";

type ConvexUniversity =
  FunctionReturnType<typeof api.universities.list>["page"][number];

const university: ConvexUniversity = {
  id: 990001,
  name: "Synthetic University",
  location: "Test City",
  state: "Test State",
  type: "Synthetic",
  fee: 1000,
  rating: 4,
  students: "100",
  courses: 2,
  image: "synthetic-image",
  logo: null,
  categories: ["Synthetic"],
  stream: ["Science"],
  degrees: ["BSc"],
  majors: ["Testing"],
  popularCourses: ["Testing"],
  phone: "0000000000",
  competitiveExams: ["TEST"],
  min10th: 50,
  min12th: 50,
  naacGrade: "A",
  nirfRank: 1,
  aicteApproved: true,
  nbaAccredited: false,
  nmcRecognized: false,
  avgPlacementLPA: 1,
  website: null,
  virtualTourUrl: null,
  expertInsight: null,
  alumniStories: [],
  campusMap: null,
  directoryProfile: {
  sourceName: "Fixture",
  established: "2020",
  accreditation: "Test accreditation",
  rankings: "Test ranking",
  courses: "Testing",
  feeRange: "Not reported",
  scholarships: "Not reported",
  sourceNote: "Synthetic test fixture",
},
  createdAt: 1791936000000,
  reviews: [],
  reviewCount: 0,
  averageReview: 0,
};

describe("Convex university catalog adapter", () => {
  beforeEach(() => {
    query.mockReset();
    process.env.UNIINFO_CONVEX_DEPLOYMENT = "dev:clear-gopher-925";
    process.env.UNIINFO_CONVEX_URL = "https://clear-gopher-925.ap-southeast-2.convex.cloud";
    delete process.env.UNIINFO_CATALOG_BACKEND;
  });

  it("keeps PostgreSQL as the default catalog backend", () => {
    expect(useConvexUniversityCatalog()).toBe(false);
    process.env.UNIINFO_CATALOG_BACKEND = "convex";
    expect(useConvexUniversityCatalog()).toBe(true);
  });

  it("reads and maps paginated Convex catalogue records while preserving PostgreSQL search behavior", async () => {
    query
      .mockResolvedValueOnce({
        page: [university],
        continueCursor: "page-2",
        isDone: false,
      })
      .mockResolvedValueOnce({
        page: [{
          ...university,
          id: 990002,
          name: "Another University",
          directoryProfile: { courses: "Synthetic Research", sourceName: "Example" },
        }],
        continueCursor: null,
        isDone: true,
      });

    const result = await getConvexUniversities({ search: "synthetic research" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 990002,
      name: "Another University",
      createdAt: new Date(1791936000000),
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, api.universities.list, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(query).toHaveBeenNthCalledWith(2, api.universities.list, {
      paginationOpts: { numItems: 100, cursor: "page-2" },
    });
  });

  it("rejects any deployment other than the dedicated UniInfo development deployment", async () => {
    process.env.UNIINFO_CONVEX_DEPLOYMENT = "dev:original-jay-387";
    await expect(getConvexUniversities()).rejects.toThrow(
      "UniInfo Convex catalog requires its dedicated development deployment.",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("resolves a university by its preserved legacy ID", async () => {
    query.mockResolvedValue(university);

    const result = await getConvexUniversityById(990001);

    expect(result).toMatchObject({
      id: 990001,
      createdAt: new Date(1791936000000),
    });
    expect(query).toHaveBeenCalledWith(api.universities.getByLegacyId, { legacyId: 990001 });
  });
});
