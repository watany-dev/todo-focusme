declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ALLOWED_EMAIL?: string;
  }
}
