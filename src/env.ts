import { z } from "zod";

/**
 * Environment variable schema using Zod
 * This ensures all required environment variables are present and valid
 *
 * SECURITY: All sensitive API keys must be validated at startup
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),
  BACKEND_URL: z.url("BACKEND_URL must be a valid URL").default("http://localhost:3000"),

  // REQUIRED: Security secrets (fail startup if missing/placeholder)
  ADMIN_SECRET: z.string()
    .min(32, "ADMIN_SECRET must be at least 32 characters")
    .refine(
      (val) => !val.includes("your_") && !val.includes("placeholder") && !val.includes("change_me"),
      "ADMIN_SECRET cannot be a placeholder value"
    ),

  REVENUECAT_WEBHOOK_AUTH: z.string()
    .min(16, "REVENUECAT_WEBHOOK_AUTH must be at least 16 characters")
    .refine(
      (val) => !val.includes("your_") && !val.includes("placeholder"),
      "REVENUECAT_WEBHOOK_AUTH cannot be a placeholder value"
    ),

  CRON_SECRET: z.string()
    .min(16, "CRON_SECRET must be at least 16 characters")
    .refine(
      (val) => !val.includes("your_") && !val.includes("placeholder"),
      "CRON_SECRET cannot be a placeholder value"
    ),

  // OPTIONAL: External API keys (warn if missing but don't fail)
  GROK_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
});

/**
 * Validate and parse environment variables
 */
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    console.log("? Environment variables validated successfully");

    // Security warnings for optional but recommended keys
    if (!parsed.SENDGRID_API_KEY) {
      console.warn("??  SENDGRID_API_KEY not set - email features will be disabled");
    }
    if (!parsed.SUPABASE_URL || !parsed.SUPABASE_ANON_KEY) {
      console.warn("??  Supabase credentials not set - some features may be limited");
    }

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("? SECURITY: Environment variable validation failed:");
      error.issues.forEach((err: z.ZodIssue) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      console.error("\n??  APPLICATION CANNOT START WITH INSECURE CONFIGURATION");
      console.error("Please set all required security secrets in your .env file.");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validated and typed environment variables
 */
export const env = validateEnv();

/**
 * Type of the validated environment variables
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Extend process.env with our environment variables
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    // eslint-disable-next-line import/namespace
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
}