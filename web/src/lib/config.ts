const env = (key: string, fallback = "") => process.env[key]?.trim() || fallback;
const int = (key: string, fallback: number) => {
  const n = Number.parseInt(env(key), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  appUrl: env("APP_URL", "http://localhost:3000").replace(/\/$/, ""),
  authSecret: env("AUTH_SECRET"),

  openai: { apiKey: env("OPENAI_API_KEY"), model: env("OPENAI_MODEL", "gpt-4.1-mini") },

  engines: {
    openai: {
      enabled: env("ENGINE_OPENAI_ENABLED", "true") === "true" && !!env("OPENAI_API_KEY"),
      apiKey: env("OPENAI_API_KEY"),
      model: env("OPENAI_SEARCH_MODEL", "gpt-4.1-mini"),
    },
    perplexity: {
      enabled: !!env("PERPLEXITY_API_KEY"),
      apiKey: env("PERPLEXITY_API_KEY"),
      model: env("PERPLEXITY_MODEL", "sonar"),
    },
    gemini: {
      enabled: !!env("GEMINI_API_KEY"),
      apiKey: env("GEMINI_API_KEY"),
      model: env("GEMINI_MODEL", "gemini-2.5-flash"),
    },
    anthropic: {
      enabled: !!env("ANTHROPIC_API_KEY"),
      apiKey: env("ANTHROPIC_API_KEY"),
      model: env("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
    },
  },

  dataforseo: { login: env("DATAFORSEO_LOGIN"), password: env("DATAFORSEO_PASSWORD") },

  audit: { maxQuestions: int("AUDIT_MAX_QUESTIONS", 8), maxPages: int("AUDIT_MAX_PAGES", 8) },

  whop: {
    apiKey: env("WHOP_API_KEY"),
    companyId: env("WHOP_COMPANY_ID"),
    planId: env("WHOP_PLAN_ID"),
    webhookSecret: env("WHOP_WEBHOOK_SECRET"),
    creditsPerPayment: int("WHOP_CREDITS_PER_PAYMENT", 10),
  },

  terac: { apiKey: env("TERAC_API_KEY"), projectId: env("TERAC_PROJECT_ID") },

  adminEmails: env("ADMIN_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};

export type EngineName = keyof typeof config.engines;

export function integrationStatus() {
  return {
    llm: !!config.openai.apiKey,
    engines: Object.fromEntries(
      Object.entries(config.engines).map(([name, e]) => [name, e.enabled]),
    ) as Record<EngineName, boolean>,
    searchVolume: !!(config.dataforseo.login && config.dataforseo.password),
    whop: !!(config.whop.apiKey && config.whop.planId),
    whopWebhook: !!config.whop.webhookSecret,
    terac: !!config.terac.apiKey,
  };
}
