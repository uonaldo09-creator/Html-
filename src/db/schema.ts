import { pgTable, serial, text, integer, boolean, doublePrecision, jsonb, varchar, bigint, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  password: text("password").notNull(),
  role: varchar("role", { length: 50 }).notNull().default("Student"),
  name: varchar("name", { length: 100 }),
  loginFailures: integer("login_failures").default(0).notNull(),
  lockedUntil: bigint("locked_until", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  verificationToken: text("verification_token"),
  verificationExpires: timestamp("verification_expires"),
  // Authoritative, persisted identity subject for the Convex authentication bridge.
  // Legacy rows missing a subject use the documented `uniinfo-user:<id>` mapping;
  // new accounts receive a server-generated UUID. Never regenerate a persisted subject.
  authSubject: text("auth_subject").notNull().unique(),
  // Incremented on role change or account disable so outstanding Convex tokens stop validating.
  tokenVersion: integer("token_version").default(0).notNull(),
  disabled: boolean("disabled").default(false).notNull(),
});

export const universities = pgTable("universities", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  state: text("state").notNull(),
  type: text("type").notNull(),
  fee: integer("fee").notNull(),
  rating: doublePrecision("rating").notNull(),
  students: text("students").notNull(),
  courses: integer("courses").notNull(),
  image: text("image").notNull(),
  logo: text("logo"),
  categories: jsonb("categories").notNull(),
  stream: jsonb("stream").notNull(),
  degrees: jsonb("degrees").notNull(),
  majors: jsonb("majors").notNull(),
  popularCourses: jsonb("popular_courses").notNull(),
  phone: text("phone").notNull(),
  competitiveExams: jsonb("competitive_exams").notNull(),
  min10th: integer("min_10th").notNull(),
  min12th: integer("min_12th").notNull(),
  naacGrade: text("naac_grade").notNull(),
  nirfRank: integer("nirf_rank").notNull(),
  aicteApproved: boolean("aicte_approved").notNull(),
  nbaAccredited: boolean("nba_accredited").notNull(),
  nmcRecognized: boolean("nmc_recognized").notNull(),
  avgPlacementLPA: doublePrecision("avg_placement_lpa").notNull(),
  website: text("website"),
  virtualTourUrl: text("virtual_tour_url"),
  expertInsight: text("expert_insight"),
  alumniStories: jsonb("alumni_stories"),
  campusMap: jsonb("campus_map"),
  directoryProfile: jsonb("directory_profile"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  token: varchar("token", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  // expiresAt is the sliding idle expiry; keep its column name for existing callers.
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  absoluteExpiresAt: bigint("absolute_expires_at", { mode: "number" }).notNull(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  universityId: integer("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  userEmail: varchar("user_email", { length: 255 }).notNull(),
  userName: varchar("user_name", { length: 100 }).notNull().default("Student"),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  avatar: text("avatar"),
  reviewDate: varchar("review_date", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    uniIdx: index("reviews_university_id_idx").on(table.universityId),
    emailIdx: index("reviews_user_email_idx").on(table.userEmail),
  };
});

export const bookmarks = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  userEmail: varchar("user_email", { length: 255 }).notNull().references(() => users.email, { onDelete: "cascade" }),
  universityId: integer("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    userUniUnique: uniqueIndex("bookmarks_user_uni_unique_idx").on(table.userEmail, table.universityId),
  };
});

export const chatHistory = pgTable("chat_history", {
  id: serial("id").primaryKey(),
  userEmail: varchar("user_email", { length: 255 }),
  role: varchar("role", { length: 50 }).notNull(),
  content: text("content").notNull(),
  correlationId: varchar("correlation_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    emailIdx: index("chat_history_email_idx").on(table.userEmail),
  };
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 100 }).notNull(),
  details: jsonb("details").default({}).notNull(),
  userEmail: varchar("user_email", { length: 255 }),
  ip: varchar("ip", { length: 100 }),
  status: varchar("status", { length: 50 }),
  correlationId: varchar("correlation_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const analyticsEvents = pgTable("analytics_events", {
  id: integer("id").primaryKey(),
  eventType: varchar("event_type").notNull(),
  details: jsonb("details"),
  userEmail: varchar("user_email"),
  ipAddress: varchar("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  ip: varchar("ip", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }),
  success: boolean("success").notNull(),
  attemptTime: timestamp("attempt_time").defaultNow().notNull(),
}, (table) => {
  return {
    ipIdx: index("login_attempts_ip_idx").on(table.ip),
  };
});

export const studentProfiles = pgTable("student_profiles", {
  id: serial("id").primaryKey(),
  userEmail: varchar("user_email", { length: 255 }).unique().notNull().references(() => users.email, { onDelete: "cascade" }),
  stream: varchar("stream", { length: 100 }),
  budget: integer("budget"),
  preferredLocation: varchar("preferred_location", { length: 255 }),
  preferredCourse: varchar("preferred_course", { length: 255 }),
  entranceExams: jsonb("entrance_exams"), // e.g. ["BITSAT", "JEE"]
  hostelPreference: boolean("hostel_preference").default(false).notNull(),
  placementPriority: varchar("placement_priority", { length: 100 }), // e.g. "High", "Medium", "Low"
  academicScores: jsonb("academic_scores"), // e.g. { "tenth": 90, "twelfth": 92 }
  careerGoals: text("career_goals"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const parentProfiles = pgTable("parent_profiles", {
  id: serial("id").primaryKey(),
  userEmail: varchar("user_email", { length: 255 }).unique().notNull().references(() => users.email, { onDelete: "cascade" }),
  budget: integer("budget"),
  preferredStateCity: varchar("preferred_state_city", { length: 255 }),
  safetyPreference: varchar("safety_preference", { length: 100 }), // High, Medium, Low
  roiPreference: varchar("roi_preference", { length: 100 }), // High, Medium, Low
  scholarshipPreference: varchar("scholarship_preference", { length: 100 }), // Yes, No, Indifferent
  distancePreference: varchar("distance_preference", { length: 100 }), // Close, Moderate, Far
  accommodationPreference: varchar("accommodation_preference", { length: 100 }), // Hostel, PG, Day scholar
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userEmail: varchar("user_email", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 100 }).notNull(), // verification, reset_password, announcement, review_status, uni_update
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const universityReviewsAgg = pgTable("university_reviews_agg", {
  universityId: integer("university_id").primaryKey().references(() => universities.id, { onDelete: "cascade" }),
  avgRating: doublePrecision("avg_rating"),
  reviewCount: integer("review_count").default(0).notNull(),
});