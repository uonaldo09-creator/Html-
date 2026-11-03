import express from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import compression from "compression";

// SaaS Platform Modular Core Imports
import { logger } from "./src/server/logger";
import { BackupService } from "./src/server/backup";
import { errorHandler, AppError } from "./src/server/error";
import {
  correlationIdMiddleware,
  logAuditEvent,
  csrfProtection,
  AccountLockoutService,
  getSessionToken,
  isDevEnvironment,
  isDevAuthBypassEnabled,
  resolveCorsOrigin,
} from "./src/server/security";
import { MonitoringService } from "./src/server/monitoring";
import { getCounselorRole, getRegistrationRole } from "./src/server/authPolicy";
import { buildConvexJwks, mintConvexToken, readConvexAuthSettings } from "./src/server/convexAuth";

// New Core Extensions
import { dbService } from "./src/db/dbService";
import {
  getConvexUniversities,
  getConvexUniversityById,
  useConvexUniversityCatalog,
} from "./src/server/convexUniversityCatalog";
import { maintenanceService } from "./src/server/maintenance";
import { universities as staticUniversities } from "./src/data";
import { cacheGet, cacheSet, cacheDel, cacheFlushPattern, getRedisClient } from "./src/server/redis";
import { backgroundQueue } from "./src/server/queue";
import { S3BackupService } from "./src/server/s3Backup";
import { validateBackupEncryptionConfig } from "./src/server/backupEncryption";
import { openapiSpec } from "./src/server/openapi";
import { handleCounselorChat, handleGeneralChat, aiAnalytics } from "./src/server/ai";
import {
  validateRequest,
  loginSchema,
  registerSchema,
  studentProfileSchema,
  parentProfileSchema,
  userRoleSchema,
  bookmarkSchema,
  reviewSchema,
  adminUniversitySchema,
  chatSchema,
} from "./src/server/validator";

dotenv.config();

// ─── Process resilience: survive transient DB/network faults instead of dying ───
// Transient Postgres socket/DNS failures (e.g. Supabase pooler blips) previously
// surfaced as unhandled rejections from fire-and-forget DB calls and killed the
// process. Log, keep serving, and let pg's own retry logic recover the pool.
process.on("unhandledRejection", (reason: any) => {
  const msg = reason?.message || String(reason);
  const code = reason?.code || "";
  const isTransientDbFault =
    /getaddrinfo|ECONNRESET|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|Connection terminated|terminating connection/i.test(msg) ||
    /ECONNREFUSED|57P01|57P03|08006|08001|08003/i.test(code + " " + msg);
  if (isTransientDbFault) {
    logger.warn({ error: msg, code }, "Transient database/network fault survived (unhandled rejection contained).");
  } else {
    logger.error({ error: msg, code }, "Unhandled rejection contained (server kept alive).");
  }
});
process.on("uncaughtException", (err: Error) => {
  // Even non-DB crashes are logged and contained in dev so the preview stays up;
  // a genuinely broken process will still surface through failed requests.
  logger.error({ error: err.message, stack: err.stack }, "Uncaught exception contained (server kept alive).");
});

// Initialize Firebase Admin SDK.
// The project id comes from the environment — never hardcoded, so deployments
// can rotate Firebase projects without a code change.
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
try {
  if (getApps().length === 0) {
    if (firebaseProjectId) {
      initializeApp({ projectId: firebaseProjectId });
    } else {
      logger.warn(
        { key: "FIREBASE_PROJECT_ID" },
        "FIREBASE_PROJECT_ID is not configured. Google ID-token verification is disabled until it is set."
      );
    }
  }
} catch (error: any) {
  logger.error({ error: error.message }, "Failed to initialize firebase-admin");
}

// Pre-flight validation: fail fast with a clear message if required env vars are missing.
const requiredBare = ["DATABASE_URL", "LOG_LEVEL", "PORT"] as const;
for (const key of requiredBare) {
  const value = process.env[key];
  if (value === undefined || value === "undefined" || value === "null" || value.trim() === "") {
    logger.error({ key }, `Missing required environment variable: ${key}. The server will not start without it.`);
    process.exit(1);
  }
}

// Fail fast on hardcoded / placeholder credentials.
if (process.env.GROQ_API_KEY === "MY_GROQ_API_KEY" || process.env.GROQ_API_KEY === undefined) {
  logger.error({ key: "GROQ_API_KEY" }, "GROQ_API_KEY is not set. The AI counselor is disabled until it is configured.");
}
const app = express();
const PORT = Number(process.env.PORT) || 3000;

// TLS terminates at the reverse proxy (nginx.conf / docker-compose.yml) and the
// real client address arrives in X-Forwarded-For. Without trusting that single
// hop, `req.ip` is the proxy's address for every visitor, collapsing per-IP rate
// limits into one global bucket and erasing the real client IP from audit logs.
app.set("trust proxy", 1);

export function getSessionCookieHeader(req: express.Request, token: string, maxAge = 86400): string {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const sameSite = isHttps ? "None" : "Lax";
  const secure = isHttps ? "; Secure" : "";
  return `session_token=${token}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`;
}

export function getClearSessionCookieHeader(req: express.Request): string {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const sameSite = isHttps ? "None" : "Lax";
  const secure = isHttps ? "; Secure" : "";
  return `session_token=; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=0`;
}

// Enable Request Correlation ID tracking globally
app.use(correlationIdMiddleware);

// HTTP response compression middleware for bandwidth efficiency
app.use(compression());

// Strict request size limiter to prevent DoS / buffer issues
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// CORS and Request Headers Middleware to support embedded iframes and cross-origin preflights.
// Credentialed CORS is restricted to the request's own origin plus ALLOWED_ORIGINS:
// reflecting an arbitrary origin while the browser attaches the session cookie
// would expose authenticated data to any website.
const corsAllowlist = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const allowedOrigin = resolveCorsOrigin(req.headers.origin, {
    host: req.headers.host as string | undefined,
    forwardedHost: req.headers["x-forwarded-host"] as string | undefined,
    allowlist: corsAllowlist,
    allowLocalhost: isDevEnvironment(),
  });

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Correlation-ID, X-CSRF-Token");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Security Headers Middleware with iframe and external asset compatibility
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; img-src 'self' data: blob: https:; connect-src 'self' https: http: wss: ws: data: blob:; frame-ancestors *;"
  );

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

// Redis or In-Memory Rate Limiting
interface RateLimitRecord {
  timestamps: number[];
}
const rateLimitStore: Record<string, RateLimitRecord> = {};
const loginLimitStore: Record<string, RateLimitRecord> = {};
const aiLimitStore: Record<string, RateLimitRecord> = {};

// Clean up rate limit stores every 5 minutes to prevent memory leaks from inactive IPs
const rateLimitCleanupInterval = process.env.NODE_ENV === "test" ? null : setInterval(() => {
  const now = Date.now();
  const fifteenMinsMs = 15 * 60 * 1000;

  for (const [ip, record] of Object.entries(rateLimitStore)) {
    record.timestamps = record.timestamps.filter(t => now - t < fifteenMinsMs);
    if (record.timestamps.length === 0) {
      delete rateLimitStore[ip];
    }
  }

  for (const [ip, record] of Object.entries(loginLimitStore)) {
    record.timestamps = record.timestamps.filter(t => now - t < fifteenMinsMs);
    if (record.timestamps.length === 0) {
      delete loginLimitStore[ip];
    }
  }

  for (const [ip, record] of Object.entries(aiLimitStore)) {
    record.timestamps = record.timestamps.filter(t => now - t < fifteenMinsMs);
    if (record.timestamps.length === 0) {
      delete aiLimitStore[ip];
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

if (rateLimitCleanupInterval && typeof rateLimitCleanupInterval.unref === "function") {
  rateLimitCleanupInterval.unref();
}

// General Rate Limiter (e.g. 150 attempts per 15 minutes per IP for general endpoints)
async function generalRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const now = Date.now();
  const fifteenMinsMs = 15 * 60 * 1000;
  const correlationId = req.headers["x-correlation-id"] || "unknown";

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `rate_limit:general:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 900); // 15 mins
      }
      if (count >= 150) {
        logger.warn({ ip, path: req.path, correlationId, type: "general" }, "General rate limit violation detected via Redis!");
        res.status(429).json({ error: "Too many requests. Please try again after 15 minutes." });
        return;
      }
      return next();
    } catch (err) {}
  }

  // Fallback to local memory rate limiting
  if (!rateLimitStore[ip]) {
    rateLimitStore[ip] = { timestamps: [] };
  }
  rateLimitStore[ip].timestamps = rateLimitStore[ip].timestamps.filter(t => now - t < fifteenMinsMs);
  if (rateLimitStore[ip].timestamps.length >= 150) {
    logger.warn({ ip, path: req.path, correlationId, type: "general" }, "General rate limit violation detected in-memory!");
    res.status(429).json({ error: "Too many matching requests. Please try again after 15 minutes." });
    return;
  }
  rateLimitStore[ip].timestamps.push(now);
  next();
}

// Strict Rate Limiter (Max 5 attempts per 15 minutes for security sensitive endpoints)
async function loginRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const now = Date.now();
  const fifteenMinsMs = 15 * 60 * 1000;
  const correlationId = req.headers["x-correlation-id"] || "unknown";

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `rate_limit:login:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 900); // 15 mins
      }
      if (count >= 5) {
        logger.warn({ ip, path: req.path, correlationId, type: "login" }, "Login/Registration rate limit violation detected via Redis!");
        res.status(429).json({ error: "Too many login attempts. Please wait 15 minutes before trying again." });
        return;
      }
      return next();
    } catch (err) {}
  }

  // Fallback to local memory rate limiting
  if (!loginLimitStore[ip]) {
    loginLimitStore[ip] = { timestamps: [] };
  }
  loginLimitStore[ip].timestamps = loginLimitStore[ip].timestamps.filter(t => now - t < fifteenMinsMs);
  if (loginLimitStore[ip].timestamps.length >= 5) {
    const oldestTimestamp = loginLimitStore[ip].timestamps[0];
    const waitTimeMinutes = Math.ceil((fifteenMinsMs - (now - oldestTimestamp)) / 60000);
    logger.warn({ ip, path: req.path, correlationId, type: "login" }, "Login/Registration rate limit violation detected in-memory!");
    res.status(429).json({ error: `Too many login/registration attempts. Please wait ${waitTimeMinutes} minute(s) before trying again.` });
    return;
  }
  loginLimitStore[ip].timestamps.push(now);
  next();
}

// AI Rate Limiter (Max 30 attempts per 15 minutes per IP to prevent cost inflation and flooding)
async function aiRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const now = Date.now();
  const fifteenMinsMs = 15 * 60 * 1000;
  const correlationId = req.headers["x-correlation-id"] || "unknown";

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `rate_limit:ai:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 900); // 15 mins
      }
      if (count >= 30) {
        aiAnalytics.rateLimits++;
        logger.warn({ ip, path: req.path, correlationId, type: "ai" }, "AI rate limit violation detected via Redis!");
        res.status(429).json({ error: "Too many AI counseling requests. Please try again after 15 minutes." });
        return;
      }
      return next();
    } catch (err) {}
  }

  // Fallback to local memory rate limiting
  if (!aiLimitStore[ip]) {
    aiLimitStore[ip] = { timestamps: [] };
  }
  aiLimitStore[ip].timestamps = aiLimitStore[ip].timestamps.filter(t => now - t < fifteenMinsMs);
  if (aiLimitStore[ip].timestamps.length >= 30) {
    aiAnalytics.rateLimits++;
    logger.warn({ ip, path: req.path, correlationId, type: "ai" }, "AI rate limit violation detected in-memory!");
    res.status(429).json({ error: "Too many AI counseling requests. Please try again after 15 minutes." });
    return;
  }
  aiLimitStore[ip].timestamps.push(now);
  next();
}



// Full deep sanitization check to reject malformed parameters or scripts
function sanitizeValue(value: any, maxStrLength = 50000): any {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (value.length > maxStrLength) {
      throw new AppError("Input payload text exceeds safe lengths limit.", 400, "BAD_REQUEST_SIZE");
    }
    let clean = value.replace(/<[^>]*>/gi, "");
    clean = clean.replace(/javascript\s*:/gi, "");
    clean = clean.replace(/on\w+\s*=/gi, "");
    if (clean !== value) {
      logger.warn({ original: value, sanitized: clean }, "HTML tags or potential script injection stripped.");
    }
    return clean;
  } else if (Array.isArray(value)) {
    if (value.length > 500) {
      throw new AppError("Input array exceeds safe collection bounds.", 400, "BAD_REQUEST_ARRAY_SIZE");
    }
    return value.map(item => sanitizeValue(item, maxStrLength));
  } else if (typeof value === "object") {
    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.length > 120 || key.includes("__proto__") || key === "constructor" || key === "prototype") {
        throw new AppError("Inadmissible request parameter key.", 400, "BAD_REQUEST_PROTOTYPE_POLLUTION");
      }
      cleanObj[key] = sanitizeValue(val, maxStrLength);
    }
    return cleanObj;
  }
  return value;
}

// Auto-sanitizer for all payload bodies, queries, and request params
function requestSanitizer(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const isChat = req.path === "/api/chat" || req.originalUrl.includes("/api/chat");
    const maxStrLength = isChat ? 500000 : 50000;
    if (req.body) req.body = sanitizeValue(req.body, maxStrLength);
    if (req.query) req.query = sanitizeValue(req.query, maxStrLength);
    if (req.params) req.params = sanitizeValue(req.params, maxStrLength);
    next();
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Malformed payload or untrusted inputs rejected." });
  }
}

// Bind universal security filters on general endpoints (including CSRF protection)
app.use("/api", generalRateLimiter, requestSanitizer, csrfProtection);


// Password utilities
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, hash] = storedHash.split(":");
  const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return hash === testHash;
}

// Custom type declaration support
interface AuthenticatedRequest extends express.Request {
  userEmail?: string;
  userRole?: string;
  userEmailVerified?: boolean;
}

// Token-based Request Authenticator Middleware
async function authenticateToken(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  // Accepts either an `Authorization: Bearer <token>` header or the
  // HttpOnly `session_token` cookie (see getSessionToken in server/security).
  const token = getSessionToken(req);

  if (!token) {
    res.status(401).json({ error: "Unauthorized access: login session required." });
    return;
  }

  const session = await dbService.getSession(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) {
      await dbService.deleteSession(token);
    }
    res.status(401).json({ error: "Session expired or invalid. Please login again." });
    return;
  }

  req.userEmail = session.email;
  const user = await dbService.getUserByEmail(session.email);
  if (user) {
    req.userRole = user.role;
    req.userEmailVerified = user.emailVerified || false;
  }
  next();
}

// Optional Token Authenticator (attaches user info if authenticated, allows guest queries otherwise)
async function optionalAuthenticateToken(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  const token = getSessionToken(req);

  if (token) {
    try {
      const session = await dbService.getSession(token);
      if (session && session.expiresAt >= Date.now()) {
        req.userEmail = session.email;
        const user = await dbService.getUserByEmail(session.email);
        if (user) {
          req.userRole = user.role;
          req.userEmailVerified = user.emailVerified || false;
        }
      }
    } catch {
      // Proceed smoothly as guest
    }
  }
  next();
}

// Strict Email Verification Middleware
function requireVerifiedEmail(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  if (req.userEmailVerified !== true) {
    res.status(403).json({
      error: "Strict Email Verification Required: Please verify your email address to unlock this feature.",
      emailVerified: false
    });
    return;
  }
  next();
}

// Role-Based Access Control middleware
function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.userRole || !allowedRoles.includes(req.userRole)) {
      res.status(403).json({ error: `Forbidden: This action requires privileges of: ${allowedRoles.join(", ")}` });
      return;
    }
    next();
  };
}

function isValidApiKey(key: string | undefined): boolean {
  if (!key) return false;
  const clean = key.trim();
  return (
    clean !== "" &&
    clean !== "undefined" &&
    clean !== "null" &&
    !clean.startsWith("YOUR_") &&
    !clean.startsWith("MY_") &&
    !clean.includes("INSERT_") &&
    !clean.includes("API_KEY_HERE")
  );
}

// Dynamic health diagnostics endpoint
app.get("/health", async (req, res) => {
  const check = await MonitoringService.getHealthDiagnostics();
  res.status(check.status === "ok" ? 200 : 503).json(check);
});

app.get("/api/health", async (req, res) => {
  const check = await MonitoringService.getHealthDiagnostics();
  res.status(check.status === "ok" ? 200 : 503).json(check);
});

// Prometheus metrics
app.get("/metrics", async (req, res) => {
  await MonitoringService.handleMetrics(req, res);
});

app.get("/api/metrics", async (req, res) => {
  await MonitoringService.handleMetrics(req, res);
});

app.get("/.well-known/jwks.json", async (_req, res) => {
  try {
    const settings = readConvexAuthSettings();
    if (!settings) {
      res.status(404).json({ error: "Convex authentication is not configured." });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(await buildConvexJwks(settings));
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : "Unknown error" }, "Convex JWKS request failed");
    res.status(503).json({ error: "Convex authentication is not available." });
  }
});

app.post("/api/auth/convex-token", authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  try {
    const settings = readConvexAuthSettings();
    if (!settings) {
      res.status(503).json({ error: "Convex authentication is not configured on this server." });
      return;
    }

    const user = await dbService.getUserByEmail(req.userEmail!);
    if (!user || user.disabled || !user.authSubject) {
      res.status(401).json({ error: "Session expired or invalid. Please login again." });
      return;
    }

    const { token, expiresIn } = await mintConvexToken(
      { subject: user.authSubject, tokenVersion: user.tokenVersion },
      settings,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ token, expiresIn });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : "Unknown error" }, "Convex token issuance failed");
    res.status(503).json({ error: "Convex authentication is not available." });
  }
});

// Interactive API Documentation (CDN Swagger UI)
app.get("/api/docs", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>UniInfo Portal API Explorer</title>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
      <style>
        body { margin: 0; background: #0f172a; }
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info .title { color: #f1f5f9; }
        .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info td { color: #cbd5e1; }
        .swagger-ui .scheme-container { background: #1e293b; }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
      <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"></script>
      <script>
        window.onload = () => {
          window.ui = SwaggerUIBundle({
            url: '/api/openapi.json',
            dom_id: '#swagger-ui',
            presets: [
              SwaggerUIBundle.presets.apis,
              SwaggerUIStandalonePreset
            ],
            layout: "BaseLayout",
            deepLinking: true,
          });
        };
      </script>
    </body>
    </html>
  `);
});

app.get("/api/openapi.json", (req, res) => {
  res.json(openapiSpec);
});


// Secure, Google Auth ID Token verification endpoint
app.post("/api/auth/google", loginRateLimiter, async (req, res) => {
  const { idToken } = req.body;
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const correlationId = req.headers["x-correlation-id"] as string || "unknown";

  if (!idToken || typeof idToken !== "string") {
    res.status(400).json({ error: "Missing or malformed ID token." });
    return;
  }

  try {
    let decodedToken;
    if (isDevAuthBypassEnabled() && idToken.startsWith("mock-google-token-")) {
      const email = idToken.substring("mock-google-token-".length).trim().toLowerCase();
      decodedToken = {
        email,
        name: email.split("@")[0].charAt(0).toUpperCase() + email.split("@")[0].slice(1),
        email_verified: true, // Google accounts are pre-verified!
      };
      logger.info({ email, correlationId }, "Authenticated via mock Google Auth for localhost development.");
    } else {
      if (getApps().length === 0) {
        res.status(503).json({
          error: "Google sign-in is not configured on this server. Set FIREBASE_PROJECT_ID to enable it.",
        });
        return;
      }
      decodedToken = await getAuth().verifyIdToken(idToken);
    }
    const email = decodedToken.email?.trim().toLowerCase();
    const name = decodedToken.name || decodedToken.email?.split("@")[0] || "Google User";
    const emailVerified = decodedToken.email_verified === true;

    if (!email) {
      res.status(400).json({ error: "Google account does not have a valid email address." });
      return;
    }
    if (!emailVerified) {
      res.status(403).json({ error: "A verified Google email address is required." });
      return;
    }

    let user = await dbService.getUserByEmail(email);
    if (!user) {
      // Auto-register the Google user with a random high-entropy hashed password
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const hashedPassword = hashPassword(randomPassword);
      user = await dbService.createUser({
        email,
        password: hashedPassword,
        name,
        role: "Student",
        emailVerified: emailVerified,
      });

      logAuditEvent("register_google_success", { email, ip, status: "success", correlationId });
      dbService.logAnalyticsEvent({ eventType: "register_google", details: { email }, ip, correlationId });
    } else {
      // Update local verified state if Google has confirmed it
      if (emailVerified && !user.emailVerified) {
        await dbService.verifyEmail(email);
        user.emailVerified = true;
      }
    }

    // Generate Session Token
    const token = crypto.randomBytes(32).toString("hex");
    await dbService.createSession(token, email, Date.now() + 8 * 60 * 60 * 1000);

    logAuditEvent("login_google_success", { email, ip, status: "success", correlationId });
    dbService.logAnalyticsEvent({ eventType: "login_google", details: { email }, ip, correlationId });
    await dbService.recordLoginAttempt(ip, email, true);

    // The HttpOnly session cookie is the only credential returned to the browser.
    res.setHeader("Set-Cookie", getSessionCookieHeader(req, token));
    res.json({
      status: "success",
      message: "Successfully authenticated with UniInfo Secure Portal via Google.",
      user: {
        email,
        bookmarks: user.bookmarks || [],
        role: user.role,
        name: user.name,
        emailVerified: user.emailVerified || false
      }
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "verifyIdToken Google failed");
    res.status(401).json({ error: "Invalid Google credentials or token verification failed." });
  }
});


// Secure, rate-limited Login endpoint
app.post("/api/login", loginRateLimiter, validateRequest(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const correlationId = req.headers["x-correlation-id"] as string || "unknown";

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password are required parameters and must be valid strings." });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 100) {
    res.status(400).json({ error: "Malformed request: invalid email address structure." });
    return;
  }

  // Query database
  const user = await dbService.getUserByEmail(email);

  if (user) {
    try {
      AccountLockoutService.checkLockout(user);
    } catch (lockError: any) {
      logAuditEvent("login_lockout_rejected", { email, ip, status: "lockout", correlationId });
      await dbService.recordLoginAttempt(ip, email, false);
      res.status(423).json({ error: lockError.message });
      return;
    }
  }

  if (!user || !verifyPassword(password, user.password || "")) {
    let lockedNow = false;
    if (user) {
      lockedNow = AccountLockoutService.handleFailure(user);
      await dbService.updateUserLockout(user.email, user.loginFailures, user.lockedUntil);
    }
    logAuditEvent("login_failed", { email, ip, status: "failure", correlationId, userExists: !!user, lockedNow });
    await dbService.recordLoginAttempt(ip, email, false);

    if (lockedNow) {
      res.status(423).json({ error: "Account locked out due to 5 consecutive login failures. Try again in 15 minutes." });
    } else {
      res.status(401).json({ error: "Invalid email or password." });
    }
    return;
  }

  // Reset failures on success
  AccountLockoutService.handleSuccess(user);
  await dbService.updateUserLockout(user.email, 0, 0);

  // Strict Email Verification Check
  if (user.emailVerified !== true) {
    if (isDevAuthBypassEnabled()) {
      // Auto-verify on localhost / dev environment so developer is never blocked
      await dbService.verifyEmail(user.email);
      user.emailVerified = true;
    } else {
      logAuditEvent("login_rejected_unverified", { email, ip, status: "failure", correlationId });
      res.status(403).json({
        error: "Strict Email Verification Required: Please verify your email address to log in.",
        emailVerified: false
      });
      return;
    }
  }

  // Generate Session Token
  const token = crypto.randomBytes(32).toString("hex");
  await dbService.createSession(token, email, Date.now() + 8 * 60 * 60 * 1000);

  logAuditEvent("login_success", { email, ip, status: "success", correlationId });
  dbService.logAnalyticsEvent({ eventType: "login", details: { email }, ip, correlationId });
  await dbService.recordLoginAttempt(ip, email, true);

  // The session cookie is the credential. Do not return the raw token to the
  // browser (it would invite XSS token-stealing) — resolve the authenticated
  // user from the cookie top of the page sets isLoggedIn and the rest of the
  // UI reacts to that.
  res.setHeader("Set-Cookie", getSessionCookieHeader(req, token));
  res.json({
    status: "success",
    message: "Successfully authenticated with UniInfo Secure Portal.",
    user: { email, bookmarks: user.bookmarks || [], role: user.role, name: user.name, emailVerified: user.emailVerified || false }
  });
});


// Resolve the currently authenticated user from the HttpOnly session cookie.
// Call this from the client after page load to set isLoggedIn and sync role/profile.
app.get("/api/auth/session", optionalAuthenticateToken, async (req: AuthenticatedRequest, res) => {
  if (!req.userEmail) {
    res.json({ status: "unauthenticated", user: null });
    return;
  }
  const user = await dbService.getUserByEmail(req.userEmail);
  if (!user) {
    // Logged-in but no DB row yet; treat as logged out and clear the stale cookie.
    res.setHeader("Set-Cookie", getClearSessionCookieHeader(req));
    res.json({ status: "unauthenticated", user: null });
    return;
  }
  res.json({
    status: "authenticated",
    user: {
      email: user.email,
      bookmarks: user.bookmarks || [],
      role: user.role,
      name: user.name,
      emailVerified: user.emailVerified || false,
    },
  });
});


// Secure Registration endpoint supporting multiple roles
app.post("/api/register", loginRateLimiter, validateRequest(registerSchema), async (req, res) => {
  const { email, password, accountType, name = "" } = req.body;
  const role = getRegistrationRole(accountType);
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const correlationId = req.headers["x-correlation-id"] as string || "unknown";

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password are required parameters." });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 100) {
    res.status(400).json({ error: "Malformed request: invalid email address structure." });
    return;
  }

  if (password.length < 6 || password.length > 120) {
    res.status(400).json({ error: "Password must be between 6 and 120 characters." });
    return;
  }
  if (!/^[A-Z]/.test(password)) {
    res.status(400).json({ error: "Password must start with an uppercase letter." });
    return;
  }
  if (!/\d/.test(password)) {
    res.status(400).json({ error: "Password must contain at least one number." });
    return;
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    res.status(400).json({ error: "Password must contain at least one special character." });
    return;
  }

  const existingUser = await dbService.getUserByEmail(email);
  if (existingUser) {
    logAuditEvent("register_failed_existing", { email, ip, status: "failure", correlationId });
    await dbService.recordLoginAttempt(ip, email, false);
    res.status(400).json({ error: "An account under this email address already exists." });
    return;
  }

  const hashedPassword = hashPassword(password);

  // Development auto-verifies and signs the account in immediately; production
  // requires the user to confirm their email address first.
  const isDevOrLocal = isDevAuthBypassEnabled();

  const newUser = await dbService.createUser({
    email,
    password: hashedPassword,
    role,
    name,
    emailVerified: isDevOrLocal,
  });

  // If local development, provide instant session so user can immediately use their account
  if (isDevOrLocal) {
    const token = crypto.randomBytes(32).toString("hex");
    await dbService.createSession(token, email, Date.now() + 8 * 60 * 60 * 1000);
    res.setHeader("Set-Cookie", getSessionCookieHeader(req, token));
    logAuditEvent("register_success", { email, ip, status: "success", correlationId });
    dbService.logAnalyticsEvent({ eventType: "register", details: { email, role }, ip, correlationId });
    await dbService.recordLoginAttempt(ip, email, true);

    res.json({
      status: "success",
      message: "Account registered successfully for local development!",
      user: { email, bookmarks: [], role, name, emailVerified: true }
    });
    return;
  }

  // 1. Generate secure token using crypto.randomBytes(32).
  const verificationToken = crypto.randomBytes(32).toString("hex");

  // 2. Save token to verification_token and 3. Set verification_expires to now + 24 hours.
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await dbService.updateUserVerificationToken(email, verificationToken, verificationExpires);

  // 4. Send verification email.
  await backgroundQueue.addJob({
    task: "send_verification_email",
    data: {
      email,
      token: verificationToken,
      appUrl: process.env.APP_URL || "http://localhost:3000"
    }
  });

  logAuditEvent("register_success", { email, ip, status: "success", correlationId });
  dbService.logAnalyticsEvent({ eventType: "register", details: { email, role }, ip, correlationId });
  await dbService.recordLoginAttempt(ip, email, true);

  // 5. Return message: "Please verify your email before accessing all features."
  res.json({
    status: "success",
    message: "Please verify your email before accessing all features."
  });
});


// Email verification endpoint supporting both GET (direct link click) and POST
app.get("/api/auth/verify-email", async (req, res) => {
  const token = req.query.token as string;
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const correlationId = req.headers["x-correlation-id"] as string || "unknown";

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing or malformed verification token." });
    return;
  }

  try {
    const user = await dbService.getUserByVerificationToken(token);
    if (!user) {
      res.status(400).json({ error: "Invalid or expired verification token." });
      return;
    }

    if (user.verificationExpires && Date.now() > new Date(user.verificationExpires).getTime()) {
      res.status(400).json({ error: "Verification token has expired. Please request a new one." });
      return;
    }

    // Set email_verified=true and clear token fields
    await dbService.verifyEmail(user.email);
    logAuditEvent("email_verified", { email: user.email, ip, status: "success", correlationId });
    dbService.logAnalyticsEvent({ eventType: "email_verified", details: { email: user.email }, ip, correlationId });

    // Redirect to success page
    res.redirect("/success.html");
  } catch (err: any) {
    logger.error({ error: err.message, token }, "verify-email GET failed");
    res.status(500).json({ error: "Verification failed due to an internal registry error." });
  }
});

// Redirect non-API email verification links to the appropriate API routes
app.get("/auth/verify-email", (req, res) => {
  const token = req.query.token || "";
  res.redirect(`/api/auth/verify-email?token=${token}`);
});

app.get("/verify-email", (req, res) => {
  const token = req.query.token || "";
  res.redirect(`/api/verify-email?token=${token}`);
});


// Email verification endpoint supporting both GET (direct link click) and POST
app.get("/api/verify-email", async (req, res) => {
  const token = req.query.token as string;
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const correlationId = req.headers["x-correlation-id"] as string || "unknown";

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing or malformed verification token." });
    return;
  }

  try {
    const user = await dbService.getUserByVerificationToken(token);
    if (!user) {
      res.status(400).json({ error: "Invalid or expired verification token." });
      return;
    }

    if (user.verificationExpires && Date.now() > new Date(user.verificationExpires).getTime()) {
      res.status(400).json({ error: "Verification token has expired. Please request a new one." });
      return;
    }

    await dbService.verifyEmail(user.email);
    logAuditEvent("email_verified", { email: user.email, ip, status: "success", correlationId });
    dbService.logAnalyticsEvent({ eventType: "email_verified", details: { email: user.email }, ip, correlationId });

    // Send a beautiful success page if clicked from browser
    res.send(`
      <html>
        <head>
          <title>Verification Successful</title>
          <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #fafafa; margin: 0; }
            .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); text-align: center; max-width: 400px; }
            h1 { color: #ec4899; margin-bottom: 16px; }
            p { color: #4b5563; line-height: 1.5; font-size: 16px; margin-bottom: 24px; }
            .btn { background: #ec4899; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Email Verified!</h1>
            <p>Your email address has been verified successfully. You can now access all verified services on UniInfo Secure Portal.</p>
            <a href="${process.env.APP_URL || "http://localhost:3000"}" class="btn">Go to Dashboard</a>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    logger.error({ error: err.message, token }, "verify-email GET failed");
    res.status(500).json({ error: "Verification failed due to an internal registry error." });
  }
});

app.post("/api/verify-email", async (req, res) => {
  const { token } = req.body;
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const correlationId = req.headers["x-correlation-id"] as string || "unknown";

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing or malformed verification token." });
    return;
  }

  try {
    const user = await dbService.getUserByVerificationToken(token);
    if (!user) {
      res.status(400).json({ error: "Invalid or expired verification token." });
      return;
    }

    if (user.verificationExpires && Date.now() > new Date(user.verificationExpires).getTime()) {
      res.status(400).json({ error: "Verification token has expired. Please request a new one." });
      return;
    }

    await dbService.verifyEmail(user.email);
    logAuditEvent("email_verified", { email: user.email, ip, status: "success", correlationId });
    dbService.logAnalyticsEvent({ eventType: "email_verified", details: { email: user.email }, ip, correlationId });

    res.json({ status: "success", message: "Email address verified successfully!" });
  } catch (err: any) {
    logger.error({ error: err.message, token }, "verify-email POST failed");
    res.status(500).json({ error: "Verification failed due to an internal registry error." });
  }
});

// Endpoint to request a resend of verification email
app.post("/api/resend-verification", async (req, res) => {
  const { email } = req.body;
  const ip = req.ip || req.headers["x-forwarded-for"] as string || "unknown-ip";
  const correlationId = req.headers["x-correlation-id"] as string || "unknown";

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email parameter is required and must be a valid string." });
    return;
  }

  try {
    const user = await dbService.getUserByEmail(email);
    if (!user) {
      // Avoid user enumeration by sending success anyway but doing nothing
      res.json({ status: "success", message: "If the email is registered and unverified, a verification email has been sent." });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ error: "This email address is already verified." });
      return;
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await dbService.updateUserVerificationToken(email, verificationToken, verificationExpires);

    await backgroundQueue.addJob({
      task: "send_verification_email",
      data: {
        email,
        token: verificationToken,
        appUrl: process.env.APP_URL || "http://localhost:3000"
      }
    });

    logAuditEvent("resend_verification_success", { email, ip, status: "success", correlationId });

    res.json({ status: "success", message: "If the email is registered and unverified, a verification email has been sent." });
  } catch (err: any) {
    logger.error({ error: err.message, email }, "resend-verification failed");
    res.status(500).json({ error: "Failed to resend verification email." });
  }
});

// Dev-only instant email verification helper.
// This endpoint marks an account verified AND mints a session from an email
// address alone, so in production it would be a straight account-takeover
// primitive. It is therefore limited to non-production environments and shares
// the strict login rate limiter with the other credential endpoints.
app.post("/api/auth/dev-verify", loginRateLimiter, async (req, res) => {
  if (!isDevAuthBypassEnabled()) {
    logger.warn({ ip: req.ip }, "Rejected /api/auth/dev-verify outside a development environment.");
    res.status(404).json({ error: "Not found." });
    return;
  }

  const { email } = req.body;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required." });
    return;
  }
  try {
    const user = await dbService.getUserByEmail(email);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    await dbService.verifyEmail(email);

    // Generate Session Token as well for instant log in
    const token = crypto.randomBytes(32).toString("hex");
    await dbService.createSession(token, email, Date.now() + 8 * 60 * 60 * 1000);

    res.setHeader("Set-Cookie", getSessionCookieHeader(req, token));
    res.json({
      status: "success",
      message: "Email address verified successfully!",
      user: { email, bookmarks: user.bookmarks || [], role: user.role, name: user.name, emailVerified: true }
    });
  } catch (err: any) {
    res.status(500).json({ error: "Verification failed: " + err.message });
  }
});


// List universities with optional caching
app.get("/api/universities", async (req, res) => {
  try {
    const catalogBackend = useConvexUniversityCatalog() ? "convex" : "postgres";
    const cacheKey = `universities_query:${catalogBackend}:${JSON.stringify(req.query)}`;

    // Check Cache
    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    const list = useConvexUniversityCatalog()
      ? await getConvexUniversities(req.query)
      : await dbService.getUniversities(req.query);

    // Cache for 2 minutes to optimize load times
    await cacheSet(cacheKey, JSON.stringify(list), 120);

    // Async log analytics for search keyword
    const searchStr = req.query.search;
    if (searchStr) {
      dbService.logAnalyticsEvent({
        eventType: "search",
        details: { query: searchStr },
        ip: req.ip,
      });
    }

    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "Server search error: " + err.message });
  }
});


// University spotlight
app.get("/api/university-of-the-day", async (req, res) => {
  const catalogBackend = useConvexUniversityCatalog() ? "convex" : "postgres";
  const cacheKey = `university_of_the_day:${catalogBackend}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const list = useConvexUniversityCatalog()
    ? await getConvexUniversities({})
    : await dbService.getUniversities({});
  if (list.length === 0) {
    res.status(404).json({ error: "No universities in database." });
    return;
  }

  const day = new Date().getDate();
  const index = day % list.length;
  const spotlight = list[index];

  await cacheSet(cacheKey, JSON.stringify(spotlight), 1800); // Cache for 30 minutes
  res.json(spotlight);
});


// Search universities explicit route
app.get("/api/universities/search", async (req, res) => {
  try {
    const query = (req.query.q || req.query.search || "").toString();
    const list = useConvexUniversityCatalog()
      ? await getConvexUniversities({ search: query })
      : await dbService.getUniversities({ search: query });
    res.json(list);
  } catch (err: any) {
    logger.error({ error: err.message }, "Error in /api/universities/search");
    res.status(500).json({ error: "Failed to search universities." });
  }
});


// Single university by ID
app.get("/api/universities/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid university ID format." });
      return;
    }

    const catalogBackend = useConvexUniversityCatalog() ? "convex" : "postgres";
    const cacheKey = `university_detail:${catalogBackend}:${id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    const uni = useConvexUniversityCatalog()
      ? await getConvexUniversityById(id)
      : await dbService.getUniversityById(id);
    if (!uni) {
      res.status(404).json({ error: "University not found." });
      return;
    }

    dbService.logAnalyticsEvent({
      eventType: "page_view",
      details: { universityId: id, name: uni.name },
      ip: req.ip,
    });

    await cacheSet(cacheKey, JSON.stringify(uni), 300); // Cache for 5 minutes
    res.json(uni);
  } catch (err: any) {
    logger.error({ error: err.message, id: req.params.id }, "Error in /api/universities/:id");
    res.status(500).json({ error: "Failed to retrieve university." });
  }
});


// Post authenticated review
app.post("/api/universities/:id/reviews", authenticateToken, requireVerifiedEmail, validateRequest(reviewSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as any as number; // Already validated and transformed by Zod
    const { rating, comment } = req.body;

    const user = await dbService.getUserByEmail(req.userEmail || "");
    const userName = user ? user.email.split("@")[0] : "Student";
    const formattedName = userName.charAt(0).toUpperCase() + userName.slice(1);

    const newReview = {
      id: Date.now(),
      user: formattedName,
      userEmail: req.userEmail || "",
      rating,
      comment,
      date: new Date().toISOString().split("T")[0],
      avatar: `https://i.pravatar.cc/150?u=${encodeURIComponent(formattedName)}`
    };

    const updateResult = await dbService.addReview(id, newReview);
    if (!updateResult) {
      res.status(404).json({ error: "University not found." });
      return;
    }

    // Clear relevant caches
    await Promise.all([
      cacheDel(`university_detail:postgres:${id}`),
      cacheDel(`university_detail:convex:${id}`),
    ]);
    await cacheFlushPattern("universities_query:*");

    logger.info({ universityId: id, user: formattedName, rating }, "Verified student review submitted successfully.");
    dbService.logAnalyticsEvent({
      eventType: "review_submit",
      details: { universityId: id, rating },
      userEmail: req.userEmail,
    });

    res.json({
      status: "success",
      review: newReview,
      newRating: updateResult.rating
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Error submitting university review");
    res.status(500).json({ error: "Failed to submit review." });
  }
});


// Profile Endpoint
app.get("/api/user/profile", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await dbService.getUserByEmail(req.userEmail || "");
    if (!user) {
      res.status(404).json({ error: "User profile not found." });
      return;
    }
    res.json({
      email: user.email,
      bookmarks: user.bookmarks || [],
      role: user.role,
      name: user.name,
      emailVerified: user.emailVerified || false,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Error retrieving profile");
    res.status(500).json({ error: "Failed to retrieve user profile." });
  }
});


// STUDENT PROFILE GET/POST
app.get("/api/profile/student", authenticateToken, requireVerifiedEmail, requireRole(["Student", "Admin", "Counselor"]), async (req: AuthenticatedRequest, res) => {
  try {
    const profile = await dbService.getStudentProfile(req.userEmail || "");
    res.json({ status: "success", profile });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve student profile." });
  }
});

app.post("/api/profile/student", authenticateToken, requireVerifiedEmail, requireRole(["Student", "Admin", "Counselor"]), validateRequest(studentProfileSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const profile = await dbService.saveStudentProfile(req.userEmail || "", req.body);
    logAuditEvent("update_student_profile", { email: req.userEmail, ip: req.ip || "unknown-ip", status: "success" });
    await dbService.addNotification(req.userEmail || "", "Profile Updated", "Your student advisory profile has been updated and saved successfully.", "profile_update");
    res.json({ status: "success", profile });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save student profile." });
  }
});


// PARENT PROFILE GET/POST
app.get("/api/profile/parent", authenticateToken, requireVerifiedEmail, requireRole(["Parent", "Admin", "Counselor"]), async (req: AuthenticatedRequest, res) => {
  try {
    const profile = await dbService.getParentProfile(req.userEmail || "");
    res.json({ status: "success", profile });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve parent profile." });
  }
});

app.post("/api/profile/parent", authenticateToken, requireVerifiedEmail, requireRole(["Parent", "Admin", "Counselor"]), validateRequest(parentProfileSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const profile = await dbService.saveParentProfile(req.userEmail || "", req.body);
    logAuditEvent("update_parent_profile", { email: req.userEmail, ip: req.ip || "unknown-ip", status: "success" });
    await dbService.addNotification(req.userEmail || "", "Profile Updated", "Your parent advisory profile has been updated and saved successfully.", "profile_update");
    res.json({ status: "success", profile });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save parent profile." });
  }
});


// NOTIFICATIONS GET / READ
app.get("/api/notifications", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const list = await dbService.getNotifications(req.userEmail || "");
    res.json({ status: "success", notifications: list });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve notifications." });
  }
});

app.post("/api/notifications/read", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.body;
    if (typeof id !== "number") {
      res.status(400).json({ error: "Invalid notification ID." });
      return;
    }
    const updated = await dbService.markNotificationAsRead(id, req.userEmail || "");
    if (!updated) {
      res.status(404).json({ error: "Notification not found or access denied." });
      return;
    }
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to mark notification as read." });
  }
});


// AI COUNSELOR CHAT SYSTEM ENDPOINTS
app.get("/api/chat/history", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const history = await dbService.getChatHistory(req.userEmail || "");
    const mappedHistory = history.map((h: any) => ({
      role: h.role,
      content: h.content,
      createdAt: h.createdAt
    }));
    res.json({ status: "success", history: mappedHistory });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve conversation history." });
  }
});

app.post("/api/chat", optionalAuthenticateToken, aiRateLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    // 1. Handle general OpenAI-compatible chat completions
    if (Array.isArray(req.body.messages)) {
      const result = await handleGeneralChat(req.body.messages, req.body.temperature || 0.1, req.body.response_format);
      res.json(result);
      return;
    }

    // 2. Handle standard counselor chat message
    const { message, history = [], mode = "standard" } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required and must be a string." });
      return;
    }

    const email = req.userEmail || "guest@uniinfo.edu";
    const role = getCounselorRole(req.userRole);
    const canPersistUserData = Boolean(req.userEmail && req.userRole);
    const response = await handleCounselorChat(
      email,
      role,
      message,
      history,
      mode,
      req.body.completedProfile,
      canPersistUserData,
    );
    res.json({ status: "success", ...response });
  } catch (err: any) {
    logger.error({ error: err.message }, "Error in counselor chat processing");
    res.json({
      status: "success",
      reply: "I am having temporary difficulty connecting to the counselor intelligence engine. Please ask your question again or explore the top recommended colleges directly from our curated catalog.",
      recommendations: []
    });
  }
});

app.post("/api/chat/message", optionalAuthenticateToken, aiRateLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { message, history = [], mode = "standard" } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required and must be a string." });
      return;
    }

    const email = req.userEmail || "guest@uniinfo.edu";
    const role = getCounselorRole(req.userRole);
    const canPersistUserData = Boolean(req.userEmail && req.userRole);
    const response = await handleCounselorChat(
      email,
      role,
      message,
      history,
      mode,
      req.body.completedProfile,
      canPersistUserData,
    );
    res.json({ status: "success", ...response });
  } catch (err: any) {
    logger.error({ error: err.message }, "Error in counselor chat message processing");
    res.json({
      status: "success",
      reply: "I am having temporary difficulty connecting to the counselor intelligence engine. Please ask your question again or explore the top recommended colleges directly from our curated catalog.",
      recommendations: []
    });
  }
});

app.get("/api/ai-metrics", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    res.json({
      status: "success",
      metrics: {
        aiRequests: aiAnalytics.requests,
        averageResponseTimeMs: Math.round(aiAnalytics.getAverageResponseTime()),
        failures: aiAnalytics.failures,
        timeouts: aiAnalytics.timeouts,
        rateLimits: aiAnalytics.rateLimits,
        errors: aiAnalytics.errors,
        successfulRecommendations: aiAnalytics.successfulRecommendations,
        tokenUsage: aiAnalytics.tokenUsage,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load AI monitoring metrics." });
  }
});


// RECOMMENDATIONS ENGINE
app.get("/api/recommendations", authenticateToken, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  try {
    const email = req.userEmail || "";
    const studentProfile = await dbService.getStudentProfile(email);
    const parentProfile = await dbService.getParentProfile(email);

    const unis = await dbService.getUniversities();
    const activeUnis = (unis.length > 0 ? unis : staticUniversities)
      .filter((university) => !university.directoryProfile?.directoryOnly);

    const isParent = !!parentProfile;
    const budget = isParent ? parentProfile?.budget : studentProfile?.budget;

    const results = activeUnis.map((uni: any) => {
      let score = 85; // base score
      const pros: string[] = [];
      const cons: string[] = [];

      // 1. Preferred stream filter
      if (studentProfile?.stream) {
        const streamLower = studentProfile.stream.toLowerCase();
        const offersStream = uni.stream.some((s: string) => s.toLowerCase().includes(streamLower));
        if (offersStream) {
          score += 10;
          pros.push(`Offers your preferred ${studentProfile.stream} academic stream.`);
        } else {
          score -= 20;
          cons.push(`Does not offer preferred academic stream: ${studentProfile.stream}.`);
        }
      }

      // 2. Budget matching
      if (budget) {
        if (uni.fee <= budget) {
          score += 15;
          pros.push(`Tuition fee (₹${uni.fee.toLocaleString()}/yr) is within your budget threshold.`);
        } else {
          const diff = uni.fee - budget;
          const penalty = Math.min(Math.floor(diff / 10000), 40);
          score -= penalty;
          cons.push(`Tuition fee exceeds budget target by ₹${diff.toLocaleString()}/yr.`);
        }
      } else {
        pros.push("Tuition fee meets standard educational norms.");
      }

      // 3. Academic eligibility (10th/12th scores)
      const TenthScore = studentProfile?.academicScores?.tenth || 75;
      const TwelfthScore = studentProfile?.academicScores?.twelfth || 75;

      if (TenthScore < uni.min10th) {
        score -= 25;
        cons.push(`10th score (${TenthScore}%) falls short of academic threshold (${uni.min10th}%).`);
      } else {
        pros.push(`Meets or exceeds secondary academic eligibility of ${uni.min10th}%.`);
      }

      if (TwelfthScore < uni.min12th) {
        score -= 30;
        cons.push(`12th score (${TwelfthScore}%) falls short of secondary cutoff (${uni.min12th}%).`);
      } else {
        pros.push(`Meets senior secondary academic cutoff requirement of ${uni.min12th}%.`);
      }

      // 4. Entrance exams matching
      if (studentProfile?.entranceExams && Array.isArray(studentProfile.entranceExams)) {
        const matchingExams = studentProfile.entranceExams.filter((exam: string) =>
          uni.competitiveExams.some((ce: string) => ce.toLowerCase() === exam.toLowerCase())
        );
        if (matchingExams.length > 0) {
          score += 15;
          pros.push(`Accepts entrance exam: ${matchingExams.join(", ")}.`);
        } else if (uni.competitiveExams.length > 0) {
          score -= 10;
          cons.push(`Requires specific entrance exam(s): ${uni.competitiveExams.join(", ")}.`);
        }
      }

      // 5. Hostel preferences
      const wantsHostel = isParent ? parentProfile?.accommodationPreference === "Hostel" : !!studentProfile?.hostelPreference;
      const hasHostels = uni.campusMap?.hasHostels ?? true;

      if (wantsHostel) {
        if (hasHostels) {
          score += 10;
          pros.push("On-campus hostels are fully verified and available.");
        } else {
          score -= 15;
          cons.push("No official on-campus student hostel facility verified.");
        }
      }

      // 6. Preferred State/Location matching
      const prefLoc = isParent ? parentProfile?.preferredStateCity : studentProfile?.preferredLocation;
      if (prefLoc) {
        const locLower = prefLoc.toLowerCase();
        if (uni.location.toLowerCase().includes(locLower) || uni.state.toLowerCase().includes(locLower)) {
          score += 15;
          pros.push(`Located in preferred region: ${prefLoc}.`);
        } else {
          score -= 5;
        }
      }

      // 7. Placement Priority & ROI
      const placementPriority = studentProfile?.placementPriority || (isParent && parentProfile?.roiPreference) || "High";
      if (placementPriority === "High") {
        if (uni.avgPlacementLPA >= 8.0) {
          score += 15;
          pros.push(`High average placement return: ${uni.avgPlacementLPA} LPA.`);
        } else if (uni.avgPlacementLPA < 5.0) {
          score -= 15;
          cons.push(`Average placement package (${uni.avgPlacementLPA} LPA) is relatively modest.`);
        }
      }

      // 8. NIRF Ranking
      if (uni.nirfRank <= 30) {
        score += 15;
        pros.push(`Top-tier elite national institute (NIRF Rank: #${uni.nirfRank}).`);
      } else if (uni.nirfRank <= 100) {
        score += 5;
        pros.push(`Well-recognized national ranking (NIRF Rank: #${uni.nirfRank}).`);
      }

      // 9. Accreditation
      if (uni.naacGrade === "A" || uni.naacGrade === "A+" || uni.naacGrade === "A++") {
        pros.push(`Premium grade National Assessment accreditation (Grade: ${uni.naacGrade}).`);
      }
      if (uni.aicteApproved) {
        pros.push("AICTE regulatory approval verified.");
      }

      const finalScore = Math.max(10, Math.min(100, score));

      let reason = `This institution matches ${finalScore}% of your profile guidelines.`;
      if (finalScore >= 85) {
        reason = `Outstanding fit! Excellent placement metrics, NAAC accreditation, and matches all academic eligibility prerequisites.`;
      } else if (finalScore >= 65) {
        reason = `Strong candidate offering verified streams, but check budget and exam cutoffs.`;
      } else {
        reason = `Matches secondary preferences, but has potential budget mismatches or eligibility hurdles.`;
      }

      const similarUnis = activeUnis
        .filter((u: any) => u.id !== uni.id && u.stream.some((s: string) => uni.stream.includes(s)))
        .slice(0, 2)
        .map((u: any) => u.name);

      return {
        id: uni.id,
        name: uni.name,
        matchPercentage: finalScore,
        reasons: reason,
        pros: pros.slice(0, 3),
        cons: cons.slice(0, 3),
        similarUniversities: similarUnis,
      };
    });

    results.sort((a: any, b: any) => b.matchPercentage - a.matchPercentage);
    res.json({ status: "success", recommendations: results });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to execute scoring recommendation engine." });
  }
});


// UNIVERSITY ADMIN MANAGEMENT
app.post("/api/admin/universities", authenticateToken, requireRole(["Admin"]), validateRequest(adminUniversitySchema), async (req: AuthenticatedRequest, res) => {
  try {
    const saved = await dbService.upsertUniversity(req.body);
    logAuditEvent("admin_upsert_university", { email: req.userEmail, ip: req.ip || "unknown-ip", status: "success", universityId: req.body.id, name: req.body.name });
    res.json({ status: "success", university: saved });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save university configurations." });
  }
});

app.delete("/api/admin/universities/:id", authenticateToken, requireRole(["Admin"]), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid university ID format." });
      return;
    }

    await dbService.deleteUniversity(id);
    logAuditEvent("admin_delete_university", { email: req.userEmail, ip: req.ip || "unknown-ip", status: "success", universityId: id });
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete university." });
  }
});


// ADMIN USER ACCOUNTS MANAGEMENT
app.get("/api/admin/users", authenticateToken, requireRole(["Admin"]), async (req: AuthenticatedRequest, res) => {
  try {
    const users = await dbService.getAllUsers();
    res.json({ status: "success", users });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve user accounts." });
  }
});

app.post("/api/admin/users/role", authenticateToken, requireRole(["Admin"]), validateRequest(userRoleSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { email, role } = req.body;
    await dbService.updateUserRole(email, role);
    logAuditEvent("admin_update_user_role", { email: req.userEmail, ip: req.ip || "unknown-ip", status: "success", targetUser: email, newRole: role });
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update user role." });
  }
});


// ADMIN REVIEWS MODERATION
app.get("/api/admin/reviews", authenticateToken, requireRole(["Admin"]), async (req: AuthenticatedRequest, res) => {
  try {
    const reviews = await dbService.getAllReviews();
    res.json({ status: "success", reviews });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve reviews." });
  }
});

app.delete("/api/admin/reviews/:id", authenticateToken, requireRole(["Admin"]), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid review ID format." });
      return;
    }

    await dbService.deleteReview(id);
    logAuditEvent("admin_delete_review", { email: req.userEmail, ip: req.ip || "unknown-ip", status: "success", reviewId: id });
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to moderate/delete review." });
  }
});


// ADMIN AUDIT LOGS
app.get("/api/admin/audit-logs", authenticateToken, requireRole(["Admin"]), async (req: AuthenticatedRequest, res) => {
  try {
    const logs = await dbService.getAllAuditLogs();
    res.json({ status: "success", logs });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve audit logs." });
  }
});


// Bookmarks toggle
app.post("/api/user/bookmarks", authenticateToken, requireVerifiedEmail, validateRequest(bookmarkSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { universityId } = req.body;
    if (typeof universityId !== "number") {
      res.status(400).json({ error: "Invalid university ID." });
      return;
    }

    const toggleResult = await dbService.toggleBookmark(req.userEmail || "", universityId);
    if (!toggleResult) {
      res.status(404).json({ error: "User or University not found." });
      return;
    }

    res.json({
      status: "success",
      action: toggleResult.action,
      bookmarks: toggleResult.bookmarks,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Error toggling bookmark");
    res.status(500).json({ error: "Failed to toggle bookmark." });
  }
});


// System Analytics Summary (Admin protected)
app.get("/api/analytics", authenticateToken, requireRole(["Admin"]), async (req: AuthenticatedRequest, res) => {
  try {
    const stats = await dbService.getAnalyticsSummary();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: "Analytics compilation failed: " + err.message });
  }
});


// Logout Session Termination
app.post("/api/user/logout", async (req, res) => {
  const token = getSessionToken(req);

  if (token) {
    await dbService.deleteSession(token);
  }

  res.setHeader("Set-Cookie", getClearSessionCookieHeader(req));
  res.json({ status: "success", message: "Logged out successfully." });
});


// Register Centralized Error Handler
app.use(errorHandler);


let backupInterval: NodeJS.Timeout | null = null;
let httpServer: http.Server | null = null;
let viteInstance: any = null;

// Helper to listen with graceful retry if port is temporarily in use (e.g. during dev server restart)
async function listenWithRetry(server: http.Server, port: number, host: string, maxRetries = 10, delayMs = 500): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: any) => {
          server.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return;
    } catch (err: any) {
      if (err.code === "EADDRINUSE" && attempt < maxRetries) {
        logger.warn(`Port ${port} is currently in use (EADDRINUSE). Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw err;
      }
    }
  }
}

// Server initialization
async function startServer() {
  await dbService.waitUntilReady();

  // Start the centralized maintenance service (development mode disabled)
  // Only runs in production; disabled in development to prevent
  // unauthorized remote operations against the Convex deployment.
  if (process.env.NODE_ENV === "production") {
    maintenanceService.start();
  }

  // Development mode: disable automatic backup scheduler to prevent
  // failed remote export operations without proper authorization.
  // Only start in production; disabled in development by default.
  if (process.env.NODE_ENV === "production") {
    await BackupService.startScheduler();
  } else {
    const hasS3Config = !!(
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
    );
    let durableBackupConfigured = false;

    if (hasS3Config && process.env.BACKUP_ENCRYPTION_KEY) {
      try {
        validateBackupEncryptionConfig();
        durableBackupConfigured = true;
      } catch (error) {
        logger.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Automated production backups are disabled because backup encryption is misconfigured.");
      }
    }

    if (durableBackupConfigured) {
      backupInterval = setInterval(() => {
        logger.info("Scheduling encrypted database backup to configured object storage.");
        backgroundQueue.addJob({ task: "backup_to_s3" });
      }, 12 * 60 * 60 * 1000);
      backupInterval.unref();
    } else {
      logger.warn("Automated production backups are disabled; configure encrypted object storage before enabling them.");
    }
  }

  httpServer = http.createServer(app);

  // Global error safety listener on HTTP server to prevent unhandled node event crash
  httpServer.on("error", (err: any) => {
    if (err.code !== "EADDRINUSE") {
      logger.error({ error: err.message, code: err.code }, "HTTP server error event");
    }
  });

  if (process.env.NODE_ENV !== "production") {
    viteInstance = await createViteServer({
      server: {
        middlewareMode: true,
        // Bind HMR to the existing HTTP server so Vite never opens standalone port 24678
        hmr: { server: httpServer },
      },
      appType: "spa",
    });
    app.use(viteInstance.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      maxAge: '1y',
      etag: true,
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  await listenWithRetry(httpServer, PORT, "0.0.0.0");
  logger.info(`Server running in ${process.env.NODE_ENV || "development"} mode on http://localhost:${PORT}`);
}

// Graceful shutdown helper
async function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Initiating graceful shutdown procedure...");

  // 1. Stop schedulers & timers
  try {
    await maintenanceService.stop();
  } catch (err: any) {
    logger.error({ error: err.message }, "Error shutting down centralized maintenance service.");
  }
  BackupService.stopScheduler();
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
    logger.info("S3 automatic backup scheduler interval cleared.");
  }

  // 2. Shut down background queue/workers
  try {
    await backgroundQueue.shutdown();
  } catch (err: any) {
    logger.error({ error: err.message }, "Error shutting down background queue service.");
  }

  // 3. Stop Vite instance
  if (viteInstance) {
    try {
      await viteInstance.close();
      logger.info("Vite dev server instance closed successfully.");
    } catch (err: any) {
      logger.error({ error: err.message }, "Error closing Vite instance.");
    }
  }

  // 4. Stop receiving new network requests
  if (httpServer) {
    logger.info("Closing HTTP server listener...");
    await new Promise<void>((resolve) => {
      httpServer!.close((err: any) => {
        if (err) {
          logger.error({ error: err.message }, "Error closing HTTP server listener.");
        } else {
          logger.info("HTTP server listener stopped successfully.");
        }
        resolve();
      });
    });
  }

  // 5. Close database connection pool
  try {
    await dbService.shutdown();
  } catch (err: any) {
    logger.error({ error: err.message }, "Error shutting down database service.");
  }

  logger.info("Graceful shutdown completed successfully. Exiting process.");
  process.exit(0);
}

// Attach listeners for SIGTERM & SIGINT
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { app };

if (process.env.NODE_ENV !== "test") {
  void startServer().catch(async (error: unknown) => {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown startup error" },
      "Server startup failed.",
    );

    BackupService.stopScheduler();
    if (backupInterval) {
      clearInterval(backupInterval);
      backupInterval = null;
    }
    const cleanupResults = await Promise.allSettled([
      maintenanceService.stop(),
      backgroundQueue.shutdown(),
      dbService.shutdown(),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        logger.error(
          { error: result.reason instanceof Error ? result.reason.message : "Unknown shutdown error" },
          "Failed to clean up a service after startup failure.",
        );
      }
    }

    process.exitCode = 1;
  });
}
