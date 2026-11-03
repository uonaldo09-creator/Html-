import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nullableString = v.union(v.string(), v.null());
const role = v.union(
  v.literal("Student"),
  v.literal("Parent"),
  v.literal("Counselor"),
  v.literal("Admin"),
);
const counterTableName = v.union(
  v.literal("users"),
  v.literal("reviews"),
  v.literal("bookmarks"),
  v.literal("chatHistory"),
  v.literal("auditLogs"),
  v.literal("loginAttempts"),
  v.literal("studentProfiles"),
  v.literal("parentProfiles"),
  v.literal("notifications"),
);
const migrationTableName = v.union(
  v.literal("universities"),
  v.literal("users"),
  v.literal("studentProfiles"),
  v.literal("parentProfiles"),
  v.literal("reviews"),
  v.literal("bookmarks"),
  v.literal("notifications"),
  v.literal("chatHistory"),
  v.literal("sessions"),
  v.literal("auditLogs"),
  v.literal("loginAttempts"),
  v.literal("universityReviewsAgg"),
  v.literal("analyticsEvents"),
);

export default defineSchema({
  users: defineTable({
    legacyId: v.number(),
    authSubject: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    firebaseUid: v.optional(nullableString),
    role,
    name: v.optional(nullableString),
    loginFailures: v.number(),
    lockedUntil: v.number(),
    createdAt: v.number(),
    emailVerified: v.boolean(),
    verificationTokenHash: v.optional(nullableString),
    verificationExpires: v.optional(v.union(v.number(), v.null())),
    tokenVersion: v.number(),
    disabled: v.boolean(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_auth_subject", ["authSubject"])
    .index("by_email", ["email"])
    .index("by_firebase_uid", ["firebaseUid"])
    .index("by_verification_token_hash", ["verificationTokenHash"])
    .index("by_role", ["role"]),

  universities: defineTable({
    legacyId: v.number(),
    name: v.string(),
    location: v.string(),
    state: v.string(),
    type: v.string(),
    fee: v.number(),
    rating: v.number(),
    students: v.string(),
    courses: v.number(),
    image: v.string(),
    logo: v.optional(nullableString),
    categories: v.array(v.string()),
    stream: v.array(v.string()),
    degrees: v.array(v.string()),
    majors: v.array(v.string()),
    popularCourses: v.array(v.string()),
    phone: v.string(),
    competitiveExams: v.array(v.string()),
    min10th: v.number(),
    min12th: v.number(),
    naacGrade: v.string(),
    nirfRank: v.number(),
    aicteApproved: v.boolean(),
    nbaAccredited: v.boolean(),
    nmcRecognized: v.boolean(),
    avgPlacementLPA: v.number(),
    website: v.optional(nullableString),
    virtualTourUrl: v.optional(nullableString),
    expertInsight: v.optional(nullableString),
    alumniStories: v.optional(v.any()),
    campusMap: v.optional(v.any()),
    directoryProfile: v.optional(v.any()),
    searchText: v.string(),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_state", ["state"])
    .index("by_type", ["type"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["state", "type"],
    }),

  sessions: defineTable({
    userId: v.id("users"),
    sessionTokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    lastUsedAt: v.number(),
    absoluteExpiresAt: v.number(),
  })
    .index("by_token_hash", ["sessionTokenHash"])
    .index("by_user", ["userId"])
    .index("by_expiry", ["expiresAt"]),

  reviews: defineTable({
    legacyId: v.number(),
    universityId: v.id("universities"),
    legacyUniversityId: v.number(),
    userId: v.optional(v.id("users")),
    userEmail: v.string(),
    userName: v.string(),
    rating: v.number(),
    comment: v.string(),
    avatar: v.optional(nullableString),
    reviewDate: v.string(),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_university_date", ["universityId", "reviewDate"])
    .index("by_legacy_university", ["legacyUniversityId"])
    .index("by_user", ["userId"]),

  bookmarks: defineTable({
    legacyId: v.number(),
    userId: v.id("users"),
    universityId: v.id("universities"),
    legacyUniversityId: v.number(),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_user_university", ["userId", "universityId"])
    .index("by_user", ["userId"])
    .index("by_legacy_university", ["legacyUniversityId"]),

  chatHistory: defineTable({
    legacyId: v.number(),
    userId: v.optional(v.id("users")),
    userEmail: v.optional(nullableString),
    role: v.string(),
    content: v.string(),
    correlationId: v.optional(nullableString),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_email_created", ["userEmail", "createdAt"]),

  auditLogs: defineTable({
    legacyId: v.number(),
    action: v.string(),
    details: v.any(),
    userEmail: v.optional(nullableString),
    ip: v.optional(nullableString),
    status: v.optional(nullableString),
    correlationId: v.optional(nullableString),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_action_created", ["action", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_email_created", ["userEmail", "createdAt"]),

  analyticsEvents: defineTable({
    legacyId: v.number(),
    eventType: v.string(),
    details: v.any(),
    userEmail: nullableString,
    ipAddress: nullableString,
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_event_type_created", ["eventType", "createdAt"])
    .index("by_created", ["createdAt"]),

  loginAttempts: defineTable({
    legacyId: v.number(),
    ip: v.string(),
    email: v.optional(nullableString),
    success: v.boolean(),
    attemptTime: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_ip_attempt", ["ip", "attemptTime"])
    .index("by_email_attempt", ["email", "attemptTime"])
    .index("by_attempt_time", ["attemptTime"]),

  studentProfiles: defineTable({
    legacyId: v.number(),
    userId: v.id("users"),
    stream: v.optional(nullableString),
    budget: v.optional(v.union(v.number(), v.null())),
    preferredLocation: v.optional(nullableString),
    preferredCourse: v.optional(nullableString),
    entranceExams: v.optional(v.any()),
    hostelPreference: v.boolean(),
    placementPriority: v.optional(nullableString),
    academicScores: v.optional(v.any()),
    careerGoals: v.optional(nullableString),
    updatedAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_user", ["userId"]),

  parentProfiles: defineTable({
    legacyId: v.number(),
    userId: v.id("users"),
    budget: v.optional(v.union(v.number(), v.null())),
    preferredStateCity: v.optional(nullableString),
    safetyPreference: v.optional(nullableString),
    roiPreference: v.optional(nullableString),
    scholarshipPreference: v.optional(nullableString),
    distancePreference: v.optional(nullableString),
    accommodationPreference: v.optional(nullableString),
    updatedAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_user", ["userId"]),

  notifications: defineTable({
    legacyId: v.number(),
    userId: v.optional(v.id("users")),
    userEmail: v.string(),
    title: v.string(),
    message: v.string(),
    type: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["legacyId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_email_created", ["userEmail", "createdAt"])
    .index("by_user_read", ["userId", "read"]),

  universityReviewsAgg: defineTable({
    universityId: v.id("universities"),
    legacyUniversityId: v.number(),
    avgRating: v.optional(v.union(v.number(), v.null())),
    reviewCount: v.number(),
  })
    .index("by_university", ["universityId"])
    .index("by_legacy_university", ["legacyUniversityId"]),

  idCounters: defineTable({
    tableName: counterTableName,
    nextId: v.number(),
  }).index("by_table_name", ["tableName"]),

  migrationCheckpoints: defineTable({
    tableName: migrationTableName,
    sourceFingerprint: v.string(),
    cursor: v.union(v.string(), v.null()),
    sourceCount: v.number(),
    inserted: v.number(),
    plannedInsert: v.number(),
    alreadyPresent: v.number(),
    verified: v.number(),
    done: v.boolean(),
  }).index("by_table_name", ["tableName"]),
});
