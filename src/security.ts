import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "./config.js";

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

export function authenticate(config: AppConfig, req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length).trim();
  if (token !== config.authToken) {
    return res.status(403).json({ error: "Invalid token" });
  }
  return next();
}
