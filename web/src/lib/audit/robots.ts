// robots.txt evaluation per RFC 9309: the most specific matching user-agent
// group applies (falling back to "*"), and within it the longest matching
// path rule wins, with Allow winning ties.

type Rule = { allow: boolean; path: string; line: string };
type Group = { agents: string[]; rules: Rule[] };

export type ParsedRobots = { groups: Group[]; sitemaps: string[] };

export function parseRobots(text: string): ParsedRobots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow means "allow everything" and contributes no rule.
      if (key === "disallow" && value === "") continue;
      current.rules.push({ allow: key === "allow", path: value, line: rawLine.trim() });
    } else if (key === "sitemap") {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function ruleMatches(rulePath: string, path: string) {
  const anchored = rulePath.endsWith("$");
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}

export function evaluateRobots(robots: ParsedRobots, botToken: string, path = "/") {
  const token = botToken.toLowerCase();
  let group: Group | undefined = robots.groups
    .filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)))
    .sort((a, b) => Math.max(...b.agents.map((x) => x.length)) - Math.max(...a.agents.map((x) => x.length)))[0];
  let matchedAgent = group ? group.agents.find((a) => token.includes(a)) ?? null : null;
  if (!group) {
    group = robots.groups.find((g) => g.agents.includes("*"));
    matchedAgent = group ? "*" : null;
  }
  if (!group) return { allowed: true, rule: null as string | null, agent: null as string | null };

  let best: Rule | null = null;
  for (const rule of group.rules) {
    if (!ruleMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return {
    allowed: best ? best.allow : true,
    rule: best ? `User-agent: ${matchedAgent} → ${best.line}` : null,
    agent: matchedAgent,
  };
}
