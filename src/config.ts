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
  protocolVersion: z.string().default("2025-06-18")
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const result = ConfigSchema.safeParse({
    port: process.env.PORT,
    authToken: process.env.AUTH_TOKEN,
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    githubToken: process.env.GITHUB_TOKEN,
    logLevel: process.env.LOG_LEVEL,
    protocolVersion: process.env.MCP_PROTOCOL_VERSION ?? "2025-06-18"
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
