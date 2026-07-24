 const FALLBACK_CONTRIBUTORS = [
      {
        login: "jidnyasa-p",
        name: "Jidnyasa Patil",
        profile: "https://github.com/jidnyasa-p",
        avatarUrl: "https://github.com/jidnyasa-p.png",
        mergedPRs: 6,
        commits: 14,
        reviews: 2,
        contributionTypes: ["💻 Code", "📖 Docs"],
        xp: 720,
        level: 4,
        rankTitle: "Lecture Guardian",
        rank: 1,
        lastMergedAt: "2026-07-22T10:10:00Z"
      },
      {
        login: "teja-311",
        name: "Teja",
        profile: "https://github.com/teja-311",
        avatarUrl: "https://github.com/teja-311.png",
        mergedPRs: 4,
        commits: 10,
        reviews: 1,
        contributionTypes: ["🎨 Design", "💻 Code"],
        xp: 520,
        level: 4,
        rankTitle: "Lecture Guardian",
        rank: 2,
        lastMergedAt: "2026-07-21T09:30:00Z"
      },
      {
        login: "hunter69240",
        name: "Hunter",
        profile: "https://github.com/hunter69240",
        avatarUrl: "https://github.com/hunter69240.png",
        mergedPRs: 3,
        commits: 7,
        reviews: 2,
        contributionTypes: ["🧪 Tests", "🐛 Bug fix"],
        xp: 360,
        level: 3,
        rankTitle: "Knowledge Builder",
        rank: 3,
        lastMergedAt: "2026-07-20T18:10:00Z"
      },
      {
        login: "new-contributor",
        name: "New Contributor",
        profile: "https://github.com/new-contributor",
        avatarUrl: "https://github.com/identicons/new-contributor.png",
        mergedPRs: 1,
        commits: 2,
        reviews: 0,
        contributionTypes: ["📖 Docs"],
        xp: 120,
        level: 2,
        rankTitle: "Course Crafter",
        rank: 4,
        lastMergedAt: "2026-07-19T11:00:00Z"
      }
    ];

    const typeText = "Loading live contributor ranks from contributors.json. XP, rank titles, merged PR momentum, and recent movement are rendered in one static GitHub Pages command center.";
    const typeLine = document.getElementById('typeLine');
    let typeIndex = 0;
    function tickType() {
      typeLine.innerHTML = typeText.slice(0, typeIndex) + '<span class="cursor"></span>';
      if (typeIndex < typeText.length) {
        typeIndex += 1;
        setTimeout(tickType, 18);
      }
    }
    tickType();

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatNumber(value) {
      return new Intl.NumberFormat().format(Number(value || 0));
    }

    function formatDate(value) {
      if (!value) return 'unknown';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'unknown';
      return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    }

    function getProgressBar(xp) {
      const numericXP = Number(xp || 0);
      const segmentSize = 250;
      const current = numericXP % segmentSize;
      const ratio = Math.max(0, Math.min(1, current / segmentSize));
      const total = 20;
      const filled = Math.round(ratio * total);
      return '[' + '█'.repeat(filled) + '·'.repeat(total - filled) + ']';
    }

    function normalizeContributors(data) {
      const raw = Array.isArray(data)
        ? data
        : Array.isArray(data?.contributors)
          ? data.contributors
          : [];

      return raw.map((item, index) => {
        const mergedPRs = Number(item.mergedPRs || item.merged_prs || item.prs || 0);
        const xp = Number(item.xp || 0);
        const level = Number(item.level || 1);
        const login = item.login || item.username || `contributor-${index + 1}`;
        const name = item.name || login;
        const profile = item.profile || item.html_url || `https://github.com/${login}`;
        const contributionTypes = Array.isArray(item.contributionTypes)
          ? item.contributionTypes
          : Array.isArray(item.contributions)
            ? item.contributions
            : [];

        return {
          login,
          name,
          profile,
          avatarUrl: item.avatarUrl || item.avatar_url || `https://github.com/${login}.png`,
          mergedPRs,
          commits: Number(item.commits || 0),
          reviews: Number(item.reviews || 0),
          contributionTypes,
          xp,
          level,
          rankTitle: item.rankTitle || item.rank_title || 'Rookie Learner',
          rank: Number(item.rank || index + 1),
          score: Number(item.score || 0),
          firstMergedAt: item.firstMergedAt || item.first_merged_at || null,
          lastMergedAt: item.lastMergedAt || item.last_merged_at || null,
          latestPRTitle: item.latestPRTitle || item.latest_pr_title || null,
        };
      }).sort((a, b) => {
        if (b.xp !== a.xp) return b.xp - a.xp;
        if (b.mergedPRs !== a.mergedPRs) return b.mergedPRs - a.mergedPRs;
        const aTime = a.lastMergedAt ? new Date(a.lastMergedAt).getTime() : 0;
        const bTime = b.lastMergedAt ? new Date(b.lastMergedAt).getTime() : 0;
        return bTime - aTime;
      }).map((item, index) => ({ ...item, rank: index + 1 }));
    }

    function renderStats(contributors) {
      const totalXP = contributors.reduce((sum, person) => sum + Number(person.xp || 0), 0);
      const totalPRs = contributors.reduce((sum, person) => sum + Number(person.mergedPRs || 0), 0);
      const topRankTitle = contributors[0]?.rankTitle || 'N/A';

      document.getElementById('totalContributors').textContent = formatNumber(contributors.length);
      document.getElementById('totalXP').textContent = formatNumber(totalXP);
      document.getElementById('totalPRs').textContent = formatNumber(totalPRs);
      document.getElementById('topRankTitle').textContent = topRankTitle;
      document.getElementById('boardCount').textContent = `${contributors.length} loaded`;
    }

    function renderContributors(contributors) {
      const mount = document.getElementById('contributorsMount');
      if (!contributors.length) {
        mount.innerHTML = '<div class="empty">No contributors found in contributors.json.</div>';
        return;
      }

      mount.innerHTML = contributors.map(person => {
        const tags = (person.contributionTypes || []).slice(0, 2)
          .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
          .join('');

        return `
          <article class="contributor-card">
            <div class="rank-pill">#${person.rank}</div>
            <div class="contributor-main">
              <div class="contributor-name-row">
                <a class="contributor-name" href="${escapeHtml(person.profile)}" target="_blank" rel="noopener noreferrer">${escapeHtml(person.name)}</a>
                <span class="contributor-login">@${escapeHtml(person.login)}</span>
                <span class="contributor-title">${escapeHtml(person.rankTitle)} / LVL ${escapeHtml(person.level)}</span>
              </div>
              <div class="bar-wrap">
                <div class="bar-meta">
                  <span>progress_to_next_rank</span>
                  <span>xp=${formatNumber(person.xp)}</span>
                </div>
                <div class="ascii-bar">${getProgressBar(person.xp)}</div>
              </div>
              <div class="tags">${tags || '<span class="tag">NO TAGS</span>'}</div>
            </div>
            <div class="contributor-side">
              <div class="xp">XP ${formatNumber(person.xp)}</div>
              <div class="pr-count">merged_prs=${formatNumber(person.mergedPRs)}</div>
              <div class="last-activity">last_merge=${escapeHtml(formatDate(person.lastMergedAt))}</div>
            </div>
          </article>
        `;
      }).join('');
    }

    function buildRecentPRFeed(contributors) {
      return contributors
        .filter(person => person.mergedPRs > 0)
        .slice()
        .sort((a, b) => {
          const aTime = a.lastMergedAt ? new Date(a.lastMergedAt).getTime() : 0;
          const bTime = b.lastMergedAt ? new Date(b.lastMergedAt).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 8)
        .map(person => ({
          title: person.latestPRTitle || `Merged PR activity by @${person.login}`,
          author: person.login,
          rankTitle: person.rankTitle,
          mergedAt: person.lastMergedAt,
          summary: `${person.name} currently holds rank #${person.rank} with ${formatNumber(person.xp)} XP and ${formatNumber(person.mergedPRs)} merged PRs.`
        }));
    }

    function renderRecentPRs(contributors) {
      const mount = document.getElementById('recentPrMount');
      const items = buildRecentPRFeed(contributors);
      if (!items.length) {
        mount.innerHTML = '<div class="empty">No recent merged PR activity available yet.</div>';
        return;
      }

      mount.innerHTML = items.map(item => `
        <article class="feed-item">
          <h3>${escapeHtml(item.title)}</h3>
          <div class="feed-meta">author=@${escapeHtml(item.author)} · rank=${escapeHtml(item.rankTitle)} · merged=${escapeHtml(formatDate(item.mergedAt))}</div>
          <p class="feed-desc">${escapeHtml(item.summary)}</p>
        </article>
      `).join('');
    }

    async function loadContributors() {
      const sourceStatus = document.getElementById('sourceStatus');
      const updatedStatus = document.getElementById('updatedStatus');

      try {
        const response = await fetch('./contributors.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        const contributors = normalizeContributors(json);
        renderStats(contributors);
        renderContributors(contributors);
        renderRecentPRs(contributors);
        sourceStatus.textContent = 'source=[contributors.json loaded]';
        updatedStatus.textContent = `last_update=[${new Date().toLocaleString()}]`;
      } catch (error) {
        const contributors = normalizeContributors(FALLBACK_CONTRIBUTORS);
        renderStats(contributors);
        renderContributors(contributors);
        renderRecentPRs(contributors);
        sourceStatus.textContent = `source=[fallback demo data]`;
        updatedStatus.textContent = `last_update=[fallback mode / ${new Date().toLocaleString()}]`;
      }
    }

    loadContributors();

    (function initThree() {
      if (!window.THREE) return;
      const canvas = document.getElementById('bg-canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.z = 18;

      const geometry = new THREE.BufferGeometry();
      const starCount = 300;
      const positions = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 42;
        positions[i + 1] = (Math.random() - 0.5) * 24;
        positions[i + 2] = (Math.random() - 0.5) * 24;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const material = new THREE.PointsMaterial({
        color: 0x6cb2ff,
        size: 0.07,
        transparent: true,
        opacity: 0.85
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);

      const grid = new THREE.GridHelper(60, 24, 0xffb000, 0x24415f);
      grid.position.y = -6;
      grid.rotation.x = Math.PI / 2.8;
      scene.add(grid);

      function resize() {
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
      }

      function animate() {
        requestAnimationFrame(animate);
        points.rotation.y += 0.0008;
        points.rotation.x += 0.0002;
        grid.rotation.z += 0.0005;
        renderer.render(scene, camera);
      }

      resize();
      animate();
      window.addEventListener('resize', resize);
    })();