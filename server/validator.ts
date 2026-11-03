import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { AppError } from "./error";

/**
 * Middleware to validate incoming requests against Zod schemas.
 */
export function validateRequest(schemas: {
  body?: z.ZodObject<any, any>;
  query?: z.ZodObject<any, any>;
  params?: z.ZodObject<any, any>;
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params && req.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as unknown as Request["params"];
      }
      if (schemas.query && req.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as unknown as Request["query"];
      }
      if (schemas.body && req.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        const err = new AppError(`Validation failed: ${issues}`, 400, "VALIDATION_ERROR");
        return next(err);
      }
      return next(error);
    }
  };
}

// 1. Auth Schemas
export const loginSchema = {
  body: z.object({
    email: z.string().email("Invalid email format").trim().toLowerCase(),
    password: z.string().min(6, "Password must be at least 6 characters long"),
  }),
};

export const registerSchema = {
  body: z.object({
    email: z.string().email("Invalid email format").trim().toLowerCase(),
    password: z.string().min(6, "Password must be at least 6 characters long"),
    name: z.string().min(1, "Name cannot be empty").max(100).optional().nullable(),
    accountType: z.enum(["Student", "Parent"]).optional(),
  }).strict(),
};

// 2. Profile Schemas
export const studentProfileSchema = {
  body: z.object({
    stream: z.string().max(100).optional().nullable(),
    budget: z.number().int().nonnegative().optional().nullable(),
    preferred_location: z.string().max(150).optional().nullable(),
    preferred_course: z.string().max(150).optional().nullable(),
    entrance_exams: z.any().optional(), // Can be dynamic JSON array/object
    hostel_preference: z.boolean().optional().nullable(),
    placement_priority: z.string().max(100).optional().nullable(),
    academic_scores: z.any().optional(),
    career_goals: z.string().max(1000).optional().nullable(),
  }),
};

export const parentProfileSchema = {
  body: z.object({
    budget: z.number().int().nonnegative().optional().nullable(),
    preferred_state_city: z.string().max(150).optional().nullable(),
    safety_preference: z.string().max(100).optional().nullable(),
    roi_preference: z.string().max(100).optional().nullable(),
    scholarship_preference: z.string().max(100).optional().nullable(),
    distance_preference: z.string().max(100).optional().nullable(),
    accommodation_preference: z.string().max(100).optional().nullable(),
  }),
};

// 3. User Role Configuration Schema
export const userRoleSchema = {
  body: z.object({
    email: z.string().email("Invalid email format").trim().toLowerCase(),
    role: z.enum(["Student", "Parent", "Counselor", "Admin"]),
  }),
};

// 4. Bookmarks Schema
export const bookmarkSchema = {
  body: z.object({
    universityId: z.number().int().positive(),
  }),
};

// 5. Review Creation Schema
export const reviewSchema = {
  params: z.object({
    id: z.string().regex(/^\d+$/, "University ID must be a numeric string").transform(val => parseInt(val, 10)),
  }),
  body: z.object({
    rating: z.number().min(1, "Rating must be at least 1").max(5, "Rating cannot exceed 5"),
    comment: z.string().min(3, "Review comments must be at least 3 characters").max(2000),
  }),
};

// 6. Admin University Ops Schema
export const adminUniversitySchema = {
  body: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1, "University name is required").max(200),
    location: z.string().min(1, "Location is required").max(200),
    state: z.string().min(1, "State is required").max(100),
    type: z.string().min(1, "Institution type is required").max(100),
    fee: z.number().int().nonnegative(),
    rating: z.number().min(1).max(5),
    students: z.string().max(50),
    courses: z.number().int().nonnegative(),
    image: z.string().url("Must be a valid cover photo URL").or(z.string().min(1)),
    logo: z.string().url("Must be a valid logo URL").optional().nullable().or(z.string().optional().nullable()),
    categories: z.array(z.string()).max(100),
    stream: z.array(z.string()).max(100),
    degrees: z.array(z.string()).max(100),
    majors: z.array(z.string()).max(100),
    popular_courses: z.array(z.string()).max(100),
    phone: z.string().max(30),
    competitive_exams: z.array(z.string()).max(100),
    min_10th: z.number().int().min(0).max(100),
    min_12th: z.number().int().min(0).max(100),
    naac_grade: z.string().max(10),
    nirf_rank: z.number().int().positive(),
    aicte_approved: z.boolean(),
    nba_accredited: z.boolean(),
    nmc_recognized: z.boolean(),
    avg_placement_lpa: z.number().nonnegative(),
    website: z.string().url("Must be a valid website URL").optional().nullable().or(z.string().optional().nullable()),
    virtual_tour_url: z.string().url("Must be a valid tour URL").optional().nullable().or(z.string().optional().nullable()),
    expert_insight: z.string().max(2000).optional().nullable(),
    alumni_stories: z.array(z.any()).max(100).optional().nullable(),
    campus_map: z.any().optional().nullable(),
  }),
};

// 7. Chat API Schema
export const chatSchema = {
  body: z.object({
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1, "Message content cannot be empty").max(20000, "Message content cannot exceed 20,000 characters"),
      })
    ).min(1, "At least one chat message is required").max(100, "At most 100 chat messages are allowed"),
    temperature: z.number().min(0).max(2).optional(),
    response_format: z.object({
      type: z.literal("json_object"),
    }).optional(),
  }),
};
