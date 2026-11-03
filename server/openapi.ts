export const openapiSpec = {
  openapi: "3.0.0",
  info: {
    title: "UniInfo Secure Portal API",
    version: "1.0.0",
    description: "Production-grade, fully resilient API documentation for UniInfo University Advisory & Analytics Platform.",
  },
  servers: [
    {
      url: "/api",
      description: "Base API Path",
    },
  ],
  paths: {
    "/login": {
      post: {
        summary: "User Login",
        description: "Authenticate student, admin, parent, or counselor credentials.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Successful authentication" },
          401: { description: "Invalid credentials" },
          423: { description: "Account locked out" },
        },
      },
    },
    "/register": {
      post: {
        summary: "User Registration",
        description: "Register a new secure account with standard or custom roles.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                  role: { type: "string", enum: ["Admin", "Student", "Parent", "Counselor"], default: "Student" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Account created successfully" },
          400: { description: "Validation failures or account exists" },
        },
      },
    },
    "/universities": {
      get: {
        summary: "List Universities",
        description: "Query and filter the entire university catalog with detailed parameters.",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "stream", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", schema: { type: "string" } },
          { name: "feeMax", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "Filtered list of universities" },
        },
      },
    },
    "/universities/{id}": {
      get: {
        summary: "Get University Details",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "Detailed university object" },
          404: { description: "University not found" },
        },
      },
    },
    "/universities/{id}/reviews": {
      post: {
        summary: "Post Review",
        description: "Submit a verified review for a university (requires authentication).",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rating", "comment"],
                properties: {
                  rating: { type: "integer", minimum: 1, maximum: 5 },
                  comment: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Review added successfully" },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/university-of-the-day": {
      get: {
        summary: "University of the Day",
        description: "Get the highlighted university spotlight of the current day.",
        responses: {
          200: { description: "University spotlight" },
        },
      },
    },
    "/user/profile": {
      get: {
        summary: "User Profile",
        description: "Retrieve currently authenticated user profile including bookmarks and role.",
        responses: {
          200: { description: "User details" },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/user/bookmarks": {
      post: {
        summary: "Toggle Bookmark",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["universityId"],
                properties: {
                  universityId: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Bookmark toggled" },
        },
      },
    },
    "/analytics": {
      get: {
        summary: "System Analytics Metrics",
        description: "Fetch live event counts and trending student search terms (requires Admin role).",
        responses: {
          200: { description: "Analytics statistics" },
          403: { description: "Forbidden: Admin privileges required" },
        },
      },
    },
    "/chat": {
      post: {
        summary: "AI Counselor Chat",
        description: "Ask queries to the smart academic advisory chat engine.",
        responses: {
          200: { description: "Model response text payload" },
        },
      },
    },
  },
};
