import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AppConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AuthenticatedRequest extends Request {
  jwt?: JWTPayload;
  scopes?: string[];
}

let jwksCache: ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet> | null = null;

export function createRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  });
}

export function validateOrigin(config: AppConfig, req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
    return next();
  }
  return res.status(403).json({ error: "Origin not allowed" });
}

export async function authenticate(
  config: AppConfig,
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const token = header.slice("Bearer ".length).trim();

  // If OAuth is not required, fallback to simple token auth
  if (!config.requireOAuth) {
    if (config.authToken && token === config.authToken) {
      return next();
    }
    return res.status(403).json({ error: "Invalid token" });
  }

  // OAuth/JWT verification
  if (!config.oidcIssuer || !config.oidcAudience) {
    return res.status(500).json({ error: "OAuth not properly configured" });
  }

  try {
    // Create JWKS client if not cached
    if (!jwksCache) {
      // Try to load local JWKS first
      const localJwksPath = path.join(__dirname, "..", "jwks.json");
      if (fs.existsSync(localJwksPath)) {
        const jwksData = JSON.parse(fs.readFileSync(localJwksPath, "utf-8"));
        jwksCache = createLocalJWKSet(jwksData);
      } else if (config.oidcJwksUrl) {
        // Fallback to remote JWKS
        jwksCache = createRemoteJWKSet(new URL(config.oidcJwksUrl));
      } else {
        return res.status(500).json({ error: "No JWKS source configured" });
      }
    }

    // Verify JWT
    const { payload } = await jwtVerify(token, jwksCache, {
      issuer: config.oidcIssuer,
      audience: config.oidcAudience
    });

    // Extract scopes
    const scope = payload.scope as string | undefined;
    const scopes = scope ? scope.split(" ") : [];

    // Attach to request
    req.jwt = payload;
    req.scopes = scopes;

    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token verification failed";
    return res.status(403).json({ error: "Invalid token", details: message });
  }
}

export function requireScopes(requiredScopes: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.scopes) {
      return res.status(401).json({ error: "No scopes found in token" });
    }

    const hasAllScopes = requiredScopes.every((scope) => req.scopes?.includes(scope));
    if (!hasAllScopes) {
      return res.status(403).json({
        error: "Insufficient permissions",
        required: requiredScopes,
        provided: req.scopes
      });
    }

    return next();
  };
}
