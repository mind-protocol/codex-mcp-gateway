import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  authToken: z.string().min(1).optional(),
  allowedOrigins: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean) ?? []
    ),
  githubToken: z.string().optional(),
  logLevel: z.string().default("info"),
  protocolVersion: z.string().default("2025-06-18"),
  // OAuth/OIDC settings
  requireOAuth: z.coerce.boolean().default(false),
  oidcIssuer: z.string().url().optional(),
  oidcJwksUrl: z.string().url().optional(),
  oidcAudience: z.string().optional(),
  // OAuth proxy settings (for /oauth/token endpoint)
  auth0Domain: z.string().optional(),
  auth0TokenUrl: z.string().url().optional(),
  auth0Audience: z.string().optional(),
  oauthAllowedClientId: z.string().optional(),
  publicBaseUrl: z.string().url().optional()
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const result = ConfigSchema.safeParse({
    port: process.env.PORT,
    authToken: process.env.AUTH_TOKEN,
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    githubToken: process.env.GITHUB_TOKEN,
    logLevel: process.env.LOG_LEVEL,
    protocolVersion: process.env.MCP_PROTOCOL_VERSION ?? "2025-06-18",
    // OAuth/OIDC
    requireOAuth: process.env.REQUIRE_OAUTH,
    oidcIssuer: process.env.OIDC_ISSUER,
    oidcJwksUrl: process.env.OIDC_JWKS_URL,
    oidcAudience: process.env.OIDC_AUDIENCE,
    // OAuth proxy
    auth0Domain: process.env.AUTH0_DOMAIN,
    auth0TokenUrl: process.env.AUTH0_TOKEN_URL,
    auth0Audience: process.env.AUTH0_AUDIENCE,
    oauthAllowedClientId: process.env.OAUTH_ALLOWED_CLIENT_ID,
    publicBaseUrl: process.env.PUBLIC_BASE_URL
  });

  if (!result.success) {
    throw new Error(
      `Invalid configuration: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`
    );
  }

  return result.data;
}
