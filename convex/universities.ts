
import {
  paginationOptsValidator,
  queryGeneric,
} from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  GenericQueryCtx,
  QueryBuilder,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import schema from "./schema";

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type UniversityDocument = DocumentByName<DataModel, "universities">;

const query = queryGeneric as QueryBuilder<DataModel, "public">;

const CAMPUS_ZONE_TYPES = [
  "academic",
  "residential",
  "recreational",
  "research",
  "administrative",
] as const;

type CampusZoneType = (typeof CAMPUS_ZONE_TYPES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function safeAlumniStories(value: unknown) {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "number" ||
      !Number.isSafeInteger(item.id) ||
      typeof item.graduationYear !== "number" ||
      !Number.isSafeInteger(item.graduationYear) ||
      typeof item.name !== "string" ||
      typeof item.role !== "string" ||
      typeof item.company !== "string" ||
      typeof item.quote !== "string" ||
      typeof item.image !== "string"
    ) {
      return [];
    }

    return [
      {
        id: item.id,
        name: item.name,
        role: item.role,
        company: item.company,
        graduationYear: item.graduationYear,
        quote: item.quote,
        image: item.image,
        ...(typeof item.achievementBadge === "string"
          ? { achievementBadge: item.achievementBadge }
          : {}),
      },
    ];
  });
}

function safeCampusMap(value: unknown) {
  if (!isRecord(value)) return undefined;

  const zones = Array.isArray(value.zones)
    ? value.zones.flatMap((zone) => {
        if (
          !isRecord(zone) ||
          typeof zone.id !== "string" ||
          typeof zone.name !== "string" ||
          typeof zone.description !== "string" ||
          typeof zone.type !== "string" ||
          !(CAMPUS_ZONE_TYPES as readonly string[]).includes(zone.type)
        ) {
          return [];
        }

        return [
          {
            id: zone.id,
            name: zone.name,
            description: zone.description,
            type: zone.type as CampusZoneType,
            highlights: Array.isArray(zone.highlights)
              ? zone.highlights.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
            ...(typeof zone.capacity === "string"
              ? { capacity: zone.capacity }
              : {}),
          },
        ];
      })
    : [];

  return {
    acreage: safeNumber(value.acreage),
    established: safeNumber(value.established),
    hasHostels:
      typeof value.hasHostels === "boolean"
        ? value.hasHostels
        : false,
    totalBuildings: safeNumber(value.totalBuildings),
    zones,
  };
}

function safeDirectoryProfile(value: unknown) {
  if (!isRecord(value)) return undefined;

  return {
    sourceName: safeString(value.sourceName),
    established: safeString(value.established),
    accreditation: safeString(value.accreditation),
    rankings: safeString(value.rankings),
    courses: safeString(value.courses),
    feeRange: safeString(value.feeRange),
    scholarships: safeString(value.scholarships),
    sourceNote: safeString(value.sourceNote),
    ...(typeof value.directoryOnly === "boolean"
      ? { directoryOnly: value.directoryOnly }
      : {}),
  };
}

function publicUniversity(university: UniversityDocument) {
  const alumniStories = safeAlumniStories(university.alumniStories);
  const campusMap = safeCampusMap(university.campusMap);
  const directoryProfile = safeDirectoryProfile(
    university.directoryProfile,
  );

  // Explicit public-field allowlist. Do not spread the database document.
  // Internal fields such as _id, searchText, and createdAt stay private.
  return {
    createdAt: university.createdAt,
    id: university.legacyId,
    name: university.name,
    location: university.location,
    state: university.state,
    type: university.type,
    fee: university.fee,
    rating: university.rating,
    students: university.students,
    courses: university.courses,
    image: university.image,
    ...(university.logo ? { logo: university.logo } : {}),
    categories: university.categories,
    stream: university.stream,
    degrees: university.degrees,
    majors: university.majors,
    popularCourses: university.popularCourses,
    phone: university.phone,
    competitiveExams: university.competitiveExams,
    min10th: university.min10th,
    min12th: university.min12th,
    naacGrade: university.naacGrade,
    nirfRank: university.nirfRank,
    aicteApproved: university.aicteApproved,
    nbaAccredited: university.nbaAccredited,
    nmcRecognized: university.nmcRecognized,
    avgPlacementLPA: university.avgPlacementLPA,
    ...(university.website
      ? { website: university.website }
      : {}),
    ...(university.virtualTourUrl
      ? { virtualTourUrl: university.virtualTourUrl }
      : {}),
    ...(university.expertInsight
      ? { expertInsight: university.expertInsight }
      : {}),
    ...(alumniStories !== undefined
      ? { alumniStories }
      : {}),
    ...(campusMap !== undefined
      ? { campusMap }
      : {}),
    ...(directoryProfile !== undefined
      ? { directoryProfile }
      : {}),
  };
}

async function withPublicReviews(
  ctx: GenericQueryCtx<DataModel>,
  university: UniversityDocument,
) {
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_university_date", (index) =>
      index.eq("universityId", university._id),
    )
    .order("desc")
    .collect();

  const reviewCount = reviews.length;

  return {
    ...publicUniversity(university),
    reviews: reviews.map((review) => ({
      id: review.legacyId,
      userName: review.userName,
      rating: review.rating,
      comment: review.comment,
      avatar: review.avatar,
      reviewDate: review.reviewDate,
    })),
    reviewCount,
    averageReview: reviewCount
      ? reviews.reduce(
          (total, review) => total + review.rating,
          0,
        ) / reviewCount
      : 0,
  };
}

function boundedPagination<T extends { numItems: number }>(
  paginationOpts: T,
) {
  return {
    ...paginationOpts,
    numItems: Math.min(
      100,
      Math.max(1, Math.floor(paginationOpts.numItems)),
    ),
  };
}

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("universities")
      .withIndex("by_legacy_id")
      .order("asc")
      .paginate(boundedPagination(paginationOpts));

    return {
      ...page,
      page: await Promise.all(
        page.page.map((university) =>
          withPublicReviews(ctx, university),
        ),
      ),
    };
  },
});

export const search = query({
  args: {
    searchTerm: v.string(),
    state: v.optional(v.string()),
    type: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, {
    searchTerm,
    state,
    type,
    paginationOpts,
  }) => {
    const normalizedSearch = searchTerm.trim();

    if (!normalizedSearch || normalizedSearch.length > 100) {
      throw new ConvexError(
        "Search term must contain 1 to 100 characters.",
      );
    }

    const results = await ctx.db
      .query("universities")
      .withSearchIndex("search_text", (search) => {
        let filtered = search.search(
          "searchText",
          normalizedSearch,
        );

        if (state) {
          filtered = filtered.eq("state", state);
        }

        if (type) {
          filtered = filtered.eq("type", type);
        }

        return filtered;
      })
      .paginate(boundedPagination(paginationOpts));

    return {
      ...results,
      page: await Promise.all(
        results.page.map((university) =>
          withPublicReviews(ctx, university),
        ),
      ),
    };
  },
});

export const getByLegacyId = query({
  args: {
    legacyId: v.number(),
  },
  handler: async (ctx, { legacyId }) => {
    if (
      !Number.isSafeInteger(legacyId) ||
      legacyId <= 0
    ) {
      throw new ConvexError(
        "University ID must be a positive safe integer.",
      );
    }

    const university = await ctx.db
      .query("universities")
      .withIndex("by_legacy_id", (index) =>
        index.eq("legacyId", legacyId),
      )
      .unique();

    return university
      ? withPublicReviews(ctx, university)
      : null;
  },
});