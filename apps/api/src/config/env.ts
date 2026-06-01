import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Storage — required in production, optional in dev (local disk fallback used)
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).optional(),

  // Stripe — optional; kept for backward compat / gradual migration
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_STARTER: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  DASHBOARD_URL: z.string().url().optional(),
  
  // Email — optional
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().default("billing@webtoapp.dev"),

  // Upload limits
  UPLOAD_MAX_SIZE_MB: z.coerce.number().default(200),
  UPLOADS_DIR: z.string().default("uploads"),
  OUTPUTS_DIR: z.string().default("outputs"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(8).default(2),

  // ClickPesa
  CLICKPESA_CLIENT_ID: z.string().optional(),
  CLICKPESA_API_KEY: z.string().optional(),
  CLICKPESA_CURRENCY: z.string().default("USD"),
  CLICKPESA_BASE_URL: z.string().url().default("https://api.clickpesa.com/third-parties"),

  // PayPal
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_BASE_URL: z.string().url().default("https://api-m.sandbox.paypal.com"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[api] ❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const useS3 = Boolean(env.AWS_ACCESS_KEY_ID && env.S3_BUCKET);

if (isProduction && !useS3) {
  console.warn(
    "[api] ⚠  S3 is not configured — artifacts will be stored on local disk and will be " +
    "LOST when the container restarts. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and " +
    "S3_BUCKET environment variables to enable durable artifact storage."
  );
}
