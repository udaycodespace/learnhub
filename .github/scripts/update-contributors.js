const fs = require("fs");
const path = require("path");

const README_PATH = path.join(__dirname, "../../README.md");
const CONTRIBUTORS_PATH = path.join(__dirname, "../../contributors.json");
const CONTRIBUTOR_START = "<!-- CONTRIBUTORS-START -->";
const CONTRIBUTOR_END = "<!-- CONTRIBUTORS-END -->";

const EXCLUDED_LOGINS = new Set(["udaycodespace"]);

const CATEGORY_RULES = [
  { emoji: "🎨", label: "Design", match: ["frontend", "ui", "css", "design", "style", "ux"] },
  { emoji: "💻", label: "Code", match: ["backend", "api", "database", "db", "server", "code", "feature"] },
  { emoji: "📖", label: "Docs", match: ["docs", "documentation", "readme", "wiki"] },
  { emoji: "🐛", label: "Bug fix", match: ["bug", "fix", "hotfix", "patch"] },
  { emoji: "🧪", label: "Tests", match: ["test", "testing", "spec", "jest", "pytest"] },
  { emoji: "⚡", label: "Performance", match: ["performance", "speed", "perf"] },
  { emoji: "🔒", label: "Security", match: ["security", "vuln", "auth"] },
  { emoji: "🚇", label: "Infrastructure", match: ["infra", "ci", "cd", "workflow", "docker", "github-actions"] },
  { emoji: "♿", label: "Accessibility", match: ["accessibility", "a11y"] },
];

const XP_RULES = {
  baseMergedPR: 100,
  categoryBonus: {
    "🎨 Design": 30,
    "💻 Code": 20,
    "📖 Docs": 15,
    "🐛 Bug fix": 25,
    "🧪 Tests": 20,
    "⚡ Performance": 25,
    "🔒 Security": 30,
    "🚇 Infrastructure": 20,
    "♿ Accessibility": 20,
  },
};

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeLogin(login) {
  return String(login || "").trim().toLowerCase();
}

function isExcludedLogin(login) {
  return EXCLUDED_LOGINS.has(normalizeLogin(login));
}

function isBotUser(user) {
  if (!user || !user.login) return true;
  const login = normalizeLogin(user.login);
  return user.type === "Bot" || login.endsWith("[bot]") || login === "github-actions";
}

function getHeaders() {
  const headers = {
    "User-Agent": "learnhub-contributors-automation",
    Accept: "application/vnd.github+json",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function detectCategories(pr) {
  const labels = (pr.labels || []).map((l) => String(l.name || "").toLowerCase());
  const title = String(pr.title || "").toLowerCase();
  const combined = [...labels, title];

  const categories = [];
  for (const rule of CATEGORY_RULES) {
    if (combined.some((item) => rule.match.some((m) => item.includes(m)))) {
      categories.push(`${rule.emoji} ${rule.label}`);
    }
  }

  if (categories.length === 0) categories.push("💻 Code");
  return [...new Set(categories)];
}

function pickRandomMaxTwo(items) {
  const arr = [...new Set(items)];
  if (arr.length <= 2) return arr;

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, 2);
}

function scoreContributor(c) {
  const mergedPRs = Number(c.mergedPRs || 0);
  const commits = Number(c.commits || 0);
  const reviews = Number(c.reviews || 0);
  return mergedPRs * 10 + commits * 2 + reviews * 3;
}

function calculateXPFromCategories(categories = []) {
  const unique = [...new Set(categories)];
  return unique.reduce((total, category) => {
    return total + Number(XP_RULES.categoryBonus[category] || 0);
  }, XP_RULES.baseMergedPR);
}

function getRankFromXP(xp) {
  if (xp >= 1400) return { level: 6, rankTitle: "LearnHub Legend" };
  if (xp >= 900) return { level: 5, rankTitle: "Academy Master" };
  if (xp >= 500) return { level: 4, rankTitle: "Lecture Guardian" };
  if (xp >= 250) return { level: 3, rankTitle: "Knowledge Builder" };
  if (xp >= 100) return { level: 2, rankTitle: "Course Crafter" };
  return { level: 1, rankTitle: "Rookie Learner" };
}

function sortContributors(contributors) {
  return [...contributors].sort((a, b) => {
    const xpDiff = Number(b.xp || 0) - Number(a.xp || 0);
    if (xpDiff !== 0) return xpDiff;

    const mergedDiff = Number(b.mergedPRs || 0) - Number(a.mergedPRs || 0);
    if (mergedDiff !== 0) return mergedDiff;

    const dateA = a.firstMergedAt ? new Date(a.firstMergedAt).getTime() : Number.POSITIVE_INFINITY;
    const dateB = b.firstMergedAt ? new Date(b.firstMergedAt).getTime() : Number.POSITIVE_INFINITY;
    if (dateA !== dateB) return dateA - dateB;

    return String(a.login || "").localeCompare(String(b.login || ""));
  });
}

function buildContributorMap(existing) {
  const map = new Map();

  for (const item of existing) {
    if (!item || !item.login) continue;

    const key = normalizeLogin(item.login);
    if (!key || isExcludedLogin(key)) continue;

    const contributionTypes = Array.isArray(item.contributionTypes)
      ? [...new Set(item.contributionTypes.filter(Boolean))]
      : [];

    if (!map.has(key)) {
      map.set(key, {
        login: key,
        name: item.name || item.login,
        profile: item.profile || `https://github.com/${key}`,
        avatarUrl: item.avatarUrl || `https://github.com/${key}.png`,
        mergedPRs: Number(item.mergedPRs || 0),
        commits: Number(item.commits || 0),
        reviews: Number(item.reviews || 0),
        contributionTypes,
        score: Number(item.score || 0),
        xp: Number(item.xp || 0),
        level: Number(item.level || 1),
        rankTitle: item.rankTitle || "Rookie Learner",
        firstMergedAt: item.firstMergedAt || null,
        lastMergedAt: item.lastMergedAt || null,
      });
      continue;
    }

    const current = map.get(key);
    current.name = item.name || current.name || item.login;
    current.profile = item.profile || current.profile || `https://github.com/${key}`;
    current.avatarUrl = item.avatarUrl || current.avatarUrl || `https://github.com/${key}.png`;
    current.mergedPRs += Number(item.mergedPRs || 0);
    current.commits += Number(item.commits || 0);
    current.reviews += Number(item.reviews || 0);
    current.score = Math.max(Number(current.score || 0), Number(item.score || 0));
    current.xp = Math.max(Number(current.xp || 0), Number(item.xp || 0));
    current.level = Math.max(Number(current.level || 1), Number(item.level || 1));
    current.rankTitle = item.rankTitle || current.rankTitle;
    current.contributionTypes = [...new Set([...current.contributionTypes, ...contributionTypes])];

    if (item.firstMergedAt && (!current.firstMergedAt || new Date(item.firstMergedAt) < new Date(current.firstMergedAt))) {
      current.firstMergedAt = item.firstMergedAt;
    }

    if (item.lastMergedAt && (!current.lastMergedAt || new Date(item.lastMergedAt) > new Date(current.lastMergedAt))) {
      current.lastMergedAt = item.lastMergedAt;
    }
  }

  return map;
}

function renderContributorsTable(contributors) {
  const cols = 5;
  let html = '\n<div align="center">\n\n<table>\n  <tbody>\n';

  for (let i = 0; i < contributors.length; i += cols) {
    html += "    <tr>\n";
    const row = contributors.slice(i, i + cols);

    for (const c of row) {
      const displayTypes = pickRandomMaxTwo(c.contributionTypes || []);
      const role = displayTypes.length ? displayTypes.join(" · ") : "💻 Code";

      html += `      <td align="center">
        <a href="${escapeHtml(c.profile)}">
          <img src="${escapeHtml(c.avatarUrl)}" width="80px" alt="${escapeHtml(c.name)}" />
          <br />
          <sub><b>${escapeHtml(c.name)}</b></sub>
          <br />
          <sub>${escapeHtml(c.rankTitle || "Rookie Learner")} • ${escapeHtml(role)}</sub>
          <br />
          <sub>XP: ${escapeHtml(c.xp)} • Rank #${escapeHtml(c.rank)}</sub>
        </a>
      </td>\n`;
    }

    html += "    </tr>\n";
  }

  html += "  </tbody>\n</table>\n\n</div>\n";
  return html;
}

function getMergedPullRequest(eventPayload) {
  const pr = eventPayload.pull_request;
  if (!pr) return null;
  if (!pr.merged) return null;
  return pr;
}

async function fetchUserProfile(login) {
  const url = `https://api.github.com/users/${encodeURIComponent(login)}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return null;
  return res.json();
}

function ensureReadmeSections(content) {
  const startIndex = content.indexOf(CONTRIBUTOR_START);
  const endIndex = content.indexOf(CONTRIBUTOR_END);

  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    throw new Error("Contributors placeholder comments not found in README.md.");
  }

  return { startIndex, endIndex };
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.error("Error: GITHUB_EVENT_PATH not set or not found.");
    process.exit(1);
  }

  const eventPayload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const pr = getMergedPullRequest(eventPayload);

  if (!pr) {
    console.log("Skipping: pull request was not merged.");
    process.exit(0);
  }

  if (!pr.user || isBotUser(pr.user)) {
    console.log("Skipping bot or invalid user.");
    process.exit(0);
  }

  const username = normalizeLogin(pr.user.login);
  if (!username) {
    console.log("Skipping: missing username.");
    process.exit(0);
  }

  if (isExcludedLogin(username)) {
    console.log(`Skipping excluded contributor: ${username}`);
    process.exit(0);
  }

  const repoDefaultBranch =
    process.env.GITHUB_DEFAULT_BRANCH ||
    eventPayload.repository?.default_branch ||
    "main";

  const baseBranch = String(pr.base?.ref || "").trim();
  if (baseBranch && baseBranch !== repoDefaultBranch) {
    console.log(`Skipping: merged into ${baseBranch}, expected ${repoDefaultBranch}.`);
    process.exit(0);
  }

  if (!fs.existsSync(README_PATH)) {
    console.error(`Error: README.md not found at ${README_PATH}`);
    process.exit(1);
  }

  const existingContributors = readJson(CONTRIBUTORS_PATH, []);
  const contributorMap = buildContributorMap(existingContributors);

  const categories = detectCategories(pr);
  const mergedAt = pr.merged_at || new Date().toISOString();
  const earnedXP = calculateXPFromCategories(categories);

  let profileName = pr.user.login;
  let avatarUrl = `https://github.com/${username}.png`;
  let profile = `https://github.com/${username}`;

  try {
    const userData = await fetchUserProfile(username);
    if (userData) {
      profileName = userData.name || userData.login || profileName;
      avatarUrl = userData.avatar_url || avatarUrl;
      profile = userData.html_url || profile;
    }
  } catch {
  }

  const current = contributorMap.get(username) || {
    login: username,
    name: profileName,
    profile,
    avatarUrl,
    mergedPRs: 0,
    commits: 0,
    reviews: 0,
    contributionTypes: [],
    score: 0,
    xp: 0,
    level: 1,
    rankTitle: "Rookie Learner",
    firstMergedAt: mergedAt,
    lastMergedAt: mergedAt,
  };

  current.name = profileName || current.name || username;
  current.profile = profile || current.profile || `https://github.com/${username}`;
  current.avatarUrl = avatarUrl || current.avatarUrl || `https://github.com/${username}.png`;
  current.mergedPRs += 1;
  current.contributionTypes = [...new Set([...(current.contributionTypes || []), ...categories])];
  current.xp = Number(current.xp || 0) + earnedXP;

  current.firstMergedAt = current.firstMergedAt
    ? new Date(current.firstMergedAt) < new Date(mergedAt)
      ? current.firstMergedAt
      : mergedAt
    : mergedAt;

  current.lastMergedAt = current.lastMergedAt
    ? new Date(current.lastMergedAt) > new Date(mergedAt)
      ? current.lastMergedAt
      : mergedAt
    : mergedAt;

  current.score = scoreContributor(current);

  const rankMeta = getRankFromXP(current.xp);
  current.level = rankMeta.level;
  current.rankTitle = rankMeta.rankTitle;

  contributorMap.set(username, current);

  const contributors = sortContributors([...contributorMap.values()]).map((c, index) => {
    const score = scoreContributor(c);
    const rankMetaFinal = getRankFromXP(Number(c.xp || 0));

    return {
      ...c,
      contributionTypes: [...new Set(c.contributionTypes || [])],
      score,
      xp: Number(c.xp || 0),
      level: rankMetaFinal.level,
      rankTitle: rankMetaFinal.rankTitle,
      rank: index + 1,
    };
  });

  writeJson(CONTRIBUTORS_PATH, contributors);

  const readme = fs.readFileSync(README_PATH, "utf8");
  const { startIndex, endIndex } = ensureReadmeSections(readme);
  const rendered = renderContributorsTable(contributors);

  const updated =
    readme.slice(0, startIndex + CONTRIBUTOR_START.length) +
    rendered +
    readme.slice(endIndex);

  fs.writeFileSync(README_PATH, updated, "utf8");
  console.log(`Updated ${contributors.length} contributors.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  CATEGORY_RULES,
  EXCLUDED_LOGINS,
  normalizeLogin,
  isExcludedLogin,
  isBotUser,
  detectCategories,
  pickRandomMaxTwo,
  scoreContributor,
  calculateXPFromCategories,
  getRankFromXP,
  sortContributors,
  buildContributorMap,
  renderContributorsTable,
};