const {
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
} = require("./update-contributors");

describe("EXCLUDED_LOGINS / isExcludedLogin", () => {
  test("contains udaycodespace in excluded list", () => {
    expect(EXCLUDED_LOGINS.has("udaycodespace")).toBe(true);
  });

  test("matches excluded login case-insensitively", () => {
    expect(isExcludedLogin("udaycodespace")).toBe(true);
    expect(isExcludedLogin("UdayCodeSpace")).toBe(true);
    expect(isExcludedLogin(" another-user ")).toBe(false);
  });
});

describe("normalizeLogin", () => {
  test("normalizes casing and trims spaces", () => {
    expect(normalizeLogin("  UdayCodeSpace  ")).toBe("udaycodespace");
  });

  test("handles empty values safely", () => {
    expect(normalizeLogin("")).toBe("");
    expect(normalizeLogin(null)).toBe("");
    expect(normalizeLogin(undefined)).toBe("");
  });
});

describe("isBotUser", () => {
  test("detects bot users", () => {
    expect(isBotUser({ login: "github-actions", type: "Bot" })).toBe(true);
    expect(isBotUser({ login: "dependabot[bot]", type: "User" })).toBe(true);
    expect(isBotUser({ login: "renovate[bot]", type: "Bot" })).toBe(true);
  });

  test("returns false for normal users", () => {
    expect(isBotUser({ login: "jidnyasa-p", type: "User" })).toBe(false);
  });

  test("handles invalid input", () => {
    expect(isBotUser(null)).toBe(true);
    expect(isBotUser({})).toBe(true);
  });
});

describe("detectCategories", () => {
  test("detects design from frontend/ui labels", () => {
    const pr = {
      title: "improve dashboard cards",
      labels: [{ name: "frontend" }, { name: "ui" }],
    };

    const result = detectCategories(pr);
    expect(result).toContain("🎨 Design");
  });

  test("detects docs from labels", () => {
    const pr = {
      title: "update docs",
      labels: [{ name: "documentation" }],
    };

    expect(detectCategories(pr)).toContain("📖 Docs");
  });

  test("detects bug fix from title", () => {
    const pr = {
      title: "fix login redirect bug",
      labels: [],
    };

    expect(detectCategories(pr)).toContain("🐛 Bug fix");
  });

  test("detects infrastructure from labels", () => {
    const pr = {
      title: "ci improvements",
      labels: [{ name: "github-actions" }],
    };

    expect(detectCategories(pr)).toContain("🚇 Infrastructure");
  });

  test("falls back to code when nothing matches", () => {
    const pr = {
      title: "minor cleanup",
      labels: [],
    };

    expect(detectCategories(pr)).toEqual(["💻 Code"]);
  });

  test("returns unique categories only", () => {
    const pr = {
      title: "docs: improve readme docs",
      labels: [{ name: "docs" }, { name: "documentation" }],
    };

    const result = detectCategories(pr);
    expect(result.filter((x) => x === "📖 Docs")).toHaveLength(1);
  });
});

describe("pickRandomMaxTwo", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns all items when length is 2 or less", () => {
    expect(pickRandomMaxTwo(["💻 Code"])).toEqual(["💻 Code"]);
    expect(pickRandomMaxTwo(["💻 Code", "📖 Docs"])).toEqual(["💻 Code", "📖 Docs"]);
  });

  test("deduplicates repeated values", () => {
    const result = pickRandomMaxTwo(["💻 Code", "💻 Code", "📖 Docs"]);
    expect(new Set(result).size).toBe(result.length);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test("returns exactly 2 items when more than 2 exist", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    const source = ["💻 Code", "📖 Docs", "🐛 Bug fix", "🧪 Tests"];
    const result = pickRandomMaxTwo(source);

    expect(result).toHaveLength(2);
    expect(result.every((item) => source.includes(item))).toBe(true);
  });
});

describe("scoreContributor", () => {
  test("calculates weighted score correctly", () => {
    const contributor = {
      mergedPRs: 3,
      commits: 4,
      reviews: 2,
    };

    expect(scoreContributor(contributor)).toBe(44);
  });

  test("handles missing values", () => {
    expect(scoreContributor({})).toBe(0);
  });
});

describe("calculateXPFromCategories", () => {
  test("adds base merged PR xp", () => {
    expect(calculateXPFromCategories([])).toBe(100);
  });

  test("adds category bonuses", () => {
    expect(calculateXPFromCategories(["🐛 Bug fix"])).toBe(125);
    expect(calculateXPFromCategories(["🎨 Design", "💻 Code"])).toBe(150);
  });

  test("deduplicates repeated categories", () => {
    expect(calculateXPFromCategories(["🎨 Design", "🎨 Design"])).toBe(130);
  });
});

describe("getRankFromXP", () => {
  test("maps xp to Rookie Learner", () => {
    expect(getRankFromXP(0)).toEqual({ level: 1, rankTitle: "Rookie Learner" });
    expect(getRankFromXP(99)).toEqual({ level: 1, rankTitle: "Rookie Learner" });
  });

  test("maps xp to Course Crafter", () => {
    expect(getRankFromXP(100)).toEqual({ level: 2, rankTitle: "Course Crafter" });
    expect(getRankFromXP(249)).toEqual({ level: 2, rankTitle: "Course Crafter" });
  });

  test("maps xp to Knowledge Builder", () => {
    expect(getRankFromXP(250)).toEqual({ level: 3, rankTitle: "Knowledge Builder" });
  });

  test("maps xp to Lecture Guardian", () => {
    expect(getRankFromXP(500)).toEqual({ level: 4, rankTitle: "Lecture Guardian" });
  });

  test("maps xp to Academy Master", () => {
    expect(getRankFromXP(900)).toEqual({ level: 5, rankTitle: "Academy Master" });
  });

  test("maps xp to LearnHub Legend", () => {
    expect(getRankFromXP(1400)).toEqual({ level: 6, rankTitle: "LearnHub Legend" });
  });
});

describe("sortContributors", () => {
  test("sorts by xp descending first", () => {
    const contributors = [
      { login: "b", xp: 200, mergedPRs: 5, firstMergedAt: "2026-07-20T00:00:00Z" },
      { login: "a", xp: 500, mergedPRs: 1, firstMergedAt: "2026-07-21T00:00:00Z" },
    ];

    const sorted = sortContributors(contributors);
    expect(sorted.map((c) => c.login)).toEqual(["a", "b"]);
  });

  test("breaks xp ties by mergedPRs descending", () => {
    const contributors = [
      { login: "less-pr", xp: 300, mergedPRs: 1, firstMergedAt: "2026-07-20T00:00:00Z" },
      { login: "more-pr", xp: 300, mergedPRs: 3, firstMergedAt: "2026-07-22T00:00:00Z" },
    ];

    const sorted = sortContributors(contributors);
    expect(sorted.map((c) => c.login)).toEqual(["more-pr", "less-pr"]);
  });

  test("breaks remaining ties by earliest firstMergedAt", () => {
    const contributors = [
      { login: "later", xp: 300, mergedPRs: 2, firstMergedAt: "2026-07-22T00:00:00Z" },
      { login: "earlier", xp: 300, mergedPRs: 2, firstMergedAt: "2026-07-20T00:00:00Z" },
    ];

    const sorted = sortContributors(contributors);
    expect(sorted.map((c) => c.login)).toEqual(["earlier", "later"]);
  });

  test("breaks final ties alphabetically by login", () => {
    const contributors = [
      { login: "zeta", xp: 300, mergedPRs: 2, firstMergedAt: "2026-07-20T00:00:00Z" },
      { login: "alpha", xp: 300, mergedPRs: 2, firstMergedAt: "2026-07-20T00:00:00Z" },
    ];

    const sorted = sortContributors(contributors);
    expect(sorted.map((c) => c.login)).toEqual(["alpha", "zeta"]);
  });
});

describe("buildContributorMap", () => {
  test("deduplicates contributors by normalized login and preserves strongest gamified fields", () => {
    const contributors = [
      {
        login: "Jidnyasa-P",
        name: "Jidnyasa-P",
        mergedPRs: 1,
        commits: 2,
        reviews: 0,
        contributionTypes: ["💻 Code"],
        score: 14,
        xp: 100,
        level: 2,
        rankTitle: "Course Crafter",
        firstMergedAt: "2026-07-20T00:00:00Z",
        lastMergedAt: "2026-07-20T00:00:00Z",
      },
      {
        login: "jidnyasa-p",
        name: "Jidnyasa Patil",
        mergedPRs: 2,
        commits: 1,
        reviews: 1,
        contributionTypes: ["📖 Docs"],
        score: 25,
        xp: 250,
        level: 3,
        rankTitle: "Knowledge Builder",
        firstMergedAt: "2026-07-19T00:00:00Z",
        lastMergedAt: "2026-07-22T00:00:00Z",
      },
    ];

    const map = buildContributorMap(contributors);
    expect(map.size).toBe(1);

    const merged = map.get("jidnyasa-p");
    expect(merged.mergedPRs).toBe(3);
    expect(merged.commits).toBe(3);
    expect(merged.reviews).toBe(1);
    expect(merged.score).toBe(25);
    expect(merged.xp).toBe(250);
    expect(merged.level).toBe(3);
    expect(merged.rankTitle).toBe("Knowledge Builder");
    expect(merged.contributionTypes).toEqual(expect.arrayContaining(["💻 Code", "📖 Docs"]));
    expect(merged.firstMergedAt).toBe("2026-07-19T00:00:00Z");
    expect(merged.lastMergedAt).toBe("2026-07-22T00:00:00Z");
  });

  test("ignores excluded logins from existing data", () => {
    const contributors = [
      {
        login: "udaycodespace",
        name: "Uday",
        mergedPRs: 10,
        commits: 10,
        reviews: 10,
        contributionTypes: ["💻 Code"],
        xp: 9999,
        level: 6,
        rankTitle: "LearnHub Legend",
      },
      {
        login: "hunter69240",
        name: "Hunter",
        mergedPRs: 1,
        commits: 0,
        reviews: 0,
        contributionTypes: ["🎨 Design"],
        xp: 130,
        level: 2,
        rankTitle: "Course Crafter",
      },
    ];

    const map = buildContributorMap(contributors);
    expect(map.has("udaycodespace")).toBe(false);
    expect(map.has("hunter69240")).toBe(true);
  });

  test("ignores invalid records", () => {
    const map = buildContributorMap([null, {}, { name: "NoLogin" }]);
    expect(map.size).toBe(0);
  });
});

describe("renderContributorsTable", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders contributor html with rank and xp", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    const html = renderContributorsTable([
      {
        login: "jidnyasa-p",
        name: "Jidnyasa-P",
        profile: "https://github.com/Jidnyasa-P",
        avatarUrl: "https://github.com/Jidnyasa-P.png",
        contributionTypes: ["💻 Code", "📖 Docs"],
        xp: 520,
        rank: 1,
        rankTitle: "Lecture Guardian",
      },
    ]);

    expect(html).toContain('<div align="center">');
    expect(html).toContain("https://github.com/Jidnyasa-P");
    expect(html).toContain("Jidnyasa-P");
    expect(html).toContain("Lecture Guardian");
    expect(html).toContain("XP: 520");
    expect(html).toContain("Rank #1");
  });

  test("escapes html-sensitive contributor names", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    const html = renderContributorsTable([
      {
        login: "safe-user",
        name: '<script>alert("x")</script>',
        profile: "https://github.com/safe-user",
        avatarUrl: "https://github.com/safe-user.png",
        contributionTypes: ["💻 Code"],
        xp: 100,
        rank: 1,
        rankTitle: "Course Crafter",
      },
    ]);

    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  test("renders multiple contributors into table cells", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    const html = renderContributorsTable([
      {
        login: "a",
        name: "A",
        profile: "https://github.com/a",
        avatarUrl: "https://github.com/a.png",
        contributionTypes: ["💻 Code"],
        xp: 100,
        rank: 1,
        rankTitle: "Course Crafter",
      },
      {
        login: "b",
        name: "B",
        profile: "https://github.com/b",
        avatarUrl: "https://github.com/b.png",
        contributionTypes: ["📖 Docs"],
        xp: 250,
        rank: 2,
        rankTitle: "Knowledge Builder",
      },
      {
        login: "c",
        name: "C",
        profile: "https://github.com/c",
        avatarUrl: "https://github.com/c.png",
        contributionTypes: ["🐛 Bug fix"],
        xp: 500,
        rank: 3,
        rankTitle: "Lecture Guardian",
      },
    ]);

    expect(html.match(/<td align="center">/g)).toHaveLength(3);
  });

  test("renders only up to 2 display categories even if more are stored", () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    const html = renderContributorsTable([
      {
        login: "teja-311",
        name: "teja-311",
        profile: "https://github.com/teja-311",
        avatarUrl: "https://github.com/teja-311.png",
        contributionTypes: ["💻 Code", "📖 Docs", "🐛 Bug fix", "🧪 Tests"],
        xp: 390,
        rank: 2,
        rankTitle: "Knowledge Builder",
      },
    ]);

    const roleLineMatch = html.match(/<sub>Knowledge Builder • (.*?)<\/sub>/s);
    expect(roleLineMatch).not.toBeNull();

    const roleLine = roleLineMatch ? roleLineMatch[1] : "";
    const pieces = roleLine.split(" · ");
    expect(pieces.length).toBeLessThanOrEqual(2);
  });
});