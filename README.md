# AI Visibility Audit

A browser extension + web app that tells a small business how often AI assistants
(ChatGPT, Perplexity, Gemini, Claude) recommend it in the top 3–5 for the questions
its customers actually ask — and shows the evidence and the exact fix for every gap.

```
extension/   Chrome MV3 popup (no build step). Log in, paste/auto-fill a URL, see scores.
web/         Next.js app: API, auth, SQLite DB (Prisma), audit engine, reports,
             Whop billing, Terac human-feedback studies.
```

## Run it

```bash
cd web
cp .env.example .env          # set AUTH_SECRET (openssl rand -hex 32), DATABASE_URL, DIRECT_URL
npm install                   # also generates the Prisma client
npm run db:push               # creates the tables in Supabase and enables RLS on them
npm run dev                   # http://localhost:3000
```

### Database (Supabase)

All data lives in Supabase Postgres: `User` (accounts, plan, credits, Whop ids, last
login), audits and their questions/engine answers/findings, feedback, Terac studies,
webhook deliveries, and `Event` — the observability log. `Event` gets one row per signup,
login (including failed attempts), logout, audit created/rejected, audit stage (with
duration), audit finished (with scores), every external API call (provider, operation,
latency, status, error; token usage for OpenAI), Whop webhook, study submission, and
pipeline error. Useful queries in the Supabase SQL editor:

```sql
-- Slowest / failing providers in the last day
select provider, operation, status, count(*), avg("durationMs")::int as avg_ms
from "Event" where type = 'api.call' and "createdAt" > now() - interval '1 day'
group by 1, 2, 3 order by 4 desc;

-- Full timeline of one audit
select "createdAt", type, operation, status, "durationMs", message
from "Event" where "auditId" = '<audit id>' order by "createdAt";
```

RLS is enabled on every table with no policies, so the publishable key
(`NEXT_PUBLIC_SUPABASE_*`) cannot read them through the Data API; the server connects
through Prisma as the `postgres` role. Re-run `npm run db:push` after adding tables.

Extension: `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
For a deployed server, add its origin to `host_permissions` in `extension/manifest.json`
and set the Server URL in the popup's Settings.

## Credentials (all in `web/.env`)

| Variable | Enables | Without it |
| --- | --- | --- |
| `OPENAI_API_KEY` | Business profiling, question generation, answer parsing, ChatGPT web-search engine | Only crawl/readability checks run |
| `PERPLEXITY_API_KEY` | Perplexity engine | Engine skipped |
| `GEMINI_API_KEY` | Gemini + Google Search grounding | Engine skipped |
| `ANTHROPIC_API_KEY` | Claude + web search | Engine skipped |
| `DATAFORSEO_LOGIN` / `_PASSWORD` | Monthly search volume per topic | Volumes shown as unavailable |
| `WHOP_API_KEY`, `WHOP_PLAN_ID`, `WHOP_WEBHOOK_SECRET` | Checkout + crediting audits on payment | Billing button errors |
| `TERAC_API_KEY` (+ optional `TERAC_PROJECT_ID`) | Launching human studies on Terac | Studies are local-only |
| `ADMIN_EMAILS` | Access to `/admin` (studies) | — |
| `APP_URL` | Public base URL for Terac task links and Whop redirects | Must be public HTTPS for Terac/Whop |

Whop: create a plan in the dashboard, then a webhook pointing to
`{APP_URL}/api/webhooks/whop` subscribed to `payment.succeeded`, `membership.activated`,
`membership.deactivated`. Each payment adds `WHOP_CREDITS_PER_PAYMENT` audits.

## How an audit works

1. **Can AI crawlers get in?** robots.txt evaluated per crawler (RFC 9309 matching) for
   OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot and the
   training bots; live fetch with each bot's user agent to catch firewall/CDN blocks;
   noindex/nosnippet; text available without JavaScript; schema.org; sitemap; llms.txt.
   If search crawlers are blocked the audit stops here — the site can't be in AI answers —
   and the report lists the exact rule/response and the fix.
2. **Understand the business** from the homepage + up to 7 key internal pages.
3. **Demand**: seed keywords → monthly Google search volume (DataForSEO) as a proxy for AI demand.
4. **Neutral questions**: the generator sees only the generic category, offerings and
   location — never the business name or marketing copy — and any question that still
   names the business is dropped and shown as such.
5. **Ask every engine** each question verbatim (no system prompt), store the full answer and
   citations, extract the ranked list of businesses, and locate the brand by domain/name.
6. **Score**: top-3 / top-5 / cited rates are computed per engine, then averaged with equal
   weight per engine. Overall = 65% top-5 visibility + 35% agent readability.
7. **Evidence of why**: per-question rankings and which question terms your site never uses;
   which competitors win; directory/review pages AI cited that we fetched and confirmed you're
   missing from; measured content/schema/FAQ differences vs cited competitor pages.

## Human input via Terac (before → after)

`/admin` creates a study from a completed audit. On Terac it becomes a general-population
opportunity whose task URL is `/study/{id}` in this app; participants rate whether each
generated question is something a real person would ask and write their own. Submissions
are held for manual review and **Sync & approve** pays only those whose answers arrived.

Every later audit feeds those labels into the question generator (realistic examples to
imitate, unrealistic ones to avoid, participants' own phrasings). The audit records how
many ratings it was generated with (`guidance at generation`), so the measurable
before/after is: realistic-rate of a study on an audit generated with 0 ratings vs. one
generated after. A second study type rates report clarity (1–5) and whether people would
know what to do next.

## Known limits of the POC

- "Crawlers allowed and able" is verified; "crawlers actually visit" needs server/CDN logs
  (not yet ingested).
- Bot-UA fetches come from our server's IP, not the bots' published ranges, so IP-verifying
  firewalls can behave differently for real crawlers (the finding says so).
- API answers can differ from the consumer apps (personalisation, location, model version).
- Audits run in-process; move `runAudit` to a job queue before real traffic. SQLite →
  Postgres by changing the Prisma provider and `DATABASE_URL`.
