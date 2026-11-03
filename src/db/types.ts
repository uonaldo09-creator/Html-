import type { InferSelectModel } from "drizzle-orm";
import type { UniversityDirectoryProfile } from "../types";
import type * as schema from "./schema";

type UserRow = InferSelectModel<typeof schema.users>;
type UniversityRow = InferSelectModel<typeof schema.universities>;

export type UserDb = Omit<UserRow, "createdAt" | "verificationExpires"> & {
  createdAt: Date | string;
  verificationExpires: Date | string | null;
  bookmarks?: number[];
};

export interface UniversityReviewDb {
  id: number;
  userName: string;
  rating: number;
  comment: string;
  avatar: string | null;
  reviewDate: string;
}

export type UniversityDb = Omit<
  UniversityRow,
  | "createdAt"
  | "categories"
  | "stream"
  | "degrees"
  | "majors"
  | "popularCourses"
  | "competitiveExams"
  | "alumniStories"
  | "campusMap"
> & {
  createdAt?: Date | string;
  categories: string[];
  stream: string[];
  degrees: string[];
  majors: string[];
  popularCourses: string[];
  competitiveExams: string[];
  alumniStories: UniversityRow["alumniStories"];
  campusMap: UniversityRow["campusMap"];
  directoryProfile?: UniversityDirectoryProfile | null;
  reviews?: UniversityReviewDb[];
  reviewCount?: number;
  averageReview?: number;
};
