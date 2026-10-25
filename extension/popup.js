const DEFAULT_API = "http://localhost:3000";
const $ = (id) => document.getElementById(id);
const state = { api: DEFAULT_API, token: null, signup: false, poll: null };

const show = (view) => {
  for (const v of ["auth", "main", "audit"]) $(`view-${v}`).classList.toggle("hidden", v !== view);
  $("logout").classList.toggle("hidden", view === "auth");
};
const setError = (msg) => ($("error").textContent = msg || "");
const pct = (n) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const tone = (n) => (n == null ? "" : n >= 70 ? "good" : n >= 40 ? "warn" : "bad");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function api(path, options = {}) {
  const res = await fetch(`${state.api}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    await chrome.storage.local.remove("token");
    state.token = null;
    show("auth");
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
  return data;
}

async function init() {
  const saved = await chrome.storage.local.get(["api", "token"]);
  state.api = saved.api || DEFAULT_API;
  state.token = saved.token || null;
  $("api").value = state.api;
  if (!state.token) return show("auth");
  await loadMain();
}

async function loadMain() {
  show("main");
  setError("");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith("http") && !$("url").value) $("url").value = new URL(tab.url).origin;
  } catch {}
  try {
    const [{ user }, { audits }] = await Promise.all([api("/api/auth/me"), api("/api/audits")]);
    $("credits").textContent = `${user.auditCredits} audit credit${user.auditCredits === 1 ? "" : "s"} left`;
    $("recent").innerHTML = audits.length
      ? `<label>Recent audits</label>${audits
          .slice(0, 5)
          .map((a) => `<div class="recent-item" data-id="${esc(a.id)}"><span>${esc(a.domain)}</span><span class="muted">${a.overallScore ?? a.status}</span></div>`)
          .join("")}`
      : "";
    document.querySelectorAll(".recent-item").forEach((el) => el.addEventListener("click", () => openAudit(el.dataset.id)));
  } catch (e) {
    setError(e.message);
  }
}

async function openAudit(id) {
  clearTimeout(state.poll);
  show("audit");
  $("a-open").onclick = () => chrome.tabs.create({ url: `${state.api}/audits/${id}` });
  const stages = ["queued", "crawling", "profiling", "questions", "querying", "analyzing", "done"];
  const tick = async () => {
    try {
      const { audit } = await api(`/api/audits/${id}`);
      $("a-title").textContent = audit.profile?.businessName || audit.domain;
      $("a-stage").textContent = audit.status === "failed" ? `Failed: ${audit.error || audit.stage}` : audit.stage || audit.status;
      const running = !["done", "failed", "blocked"].includes(audit.status);
      $("a-progress").classList.toggle("hidden", !running);
      $("a-progress").firstElementChild.style.width = `${Math.max(5, (stages.indexOf(audit.status) / 6) * 100)}%`;

      const s = audit.scores;
      $("a-scores").innerHTML = s.overall == null && s.readability == null ? "" : [
        ["Overall", s.overall, ""],
        ["In AI top 5", s.visibilityTop5 == null ? null : Math.round(s.visibilityTop5 * 100), "%"],
        ["Site cited", s.citationRate == null ? null : Math.round(s.citationRate * 100), "%"],
        ["Readability", s.readability, ""],
      ].map(([label, v, suf]) => `<div class="score"><span>${label}</span><b class="${tone(v)}">${v == null ? "—" : v + suf}</b></div>`).join("");

      $("a-findings").innerHTML = audit.findings
        .filter((f) => f.severity !== "info")
        .slice(0, 4)
        .map((f) => `<div class="finding ${esc(f.severity)}"><strong>${esc(f.title)}</strong><p>${esc(f.fix.split("\n")[0])}</p></div>`)
        .join("");

      if (running) state.poll = setTimeout(tick, 3000);
    } catch (e) {
      setError(e.message);
    }
  };
  tick();
}

$("auth-toggle").addEventListener("click", () => {
  state.signup = !state.signup;
  $("auth-submit").textContent = state.signup ? "Create account" : "Log in";
  $("auth-toggle").textContent = state.signup ? "Have an account? Log in" : "New here? Create an account";
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const { token } = await api(state.signup ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(body) });
    state.token = token;
    await chrome.storage.local.set({ token });
    await loadMain();
  } catch (err) {
    setError(err.message);
  }
});

$("audit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  $("audit-submit").disabled = true;
  try {
    const { audit } = await api("/api/audits", { method: "POST", body: JSON.stringify({ url: $("url").value }) });
    openAudit(audit.id);
  } catch (err) {
    setError(err.status === 402 ? `${err.message}. Open the dashboard → Billing to buy more.` : err.message);
  } finally {
    $("audit-submit").disabled = false;
  }
});

$("back").addEventListener("click", () => {
  clearTimeout(state.poll);
  loadMain();
});

$("logout").addEventListener("click", async () => {
  await chrome.storage.local.remove("token");
  state.token = null;
  show("auth");
});

$("save-api").addEventListener("click", async () => {
  state.api = $("api").value.trim().replace(/\/$/, "") || DEFAULT_API;
  await chrome.storage.local.set({ api: state.api });
  setError("");
  init();
});

init();
