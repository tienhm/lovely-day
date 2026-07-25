// ── i18n ──────────────────────────────────────────────────────
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
document.querySelectorAll('[data-i18n]').forEach(el => {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
});

// ── Helpers ───────────────────────────────────────────────────
function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function fmtSecs(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const H = t('hour_abbr'), M = t('min_abbr');
  if (h === 0 && m === 0) return s > 0 ? t('less_than_1min') : '0' + M;
  return h === 0 ? `${m}${M}` : (m > 0 ? `${h}${H} ${m}${M}` : `${h}${H}`);
}


// ── Storage keys (last N days) ────────────────────────────────
function buildKeys(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i);
    return { key: 'ald_' + localDateStr(d), dateStr: localDateStr(d), daysAgo: i };
  });
}

// ── Load data and render ──────────────────────────────────────
function loadAndRender() {
  const entries = buildKeys(30);
  chrome.storage.local.get(entries.map(e => e.key), result => {
    const getData = key => result[key] || {};
    const sumDay  = data => Object.values(data).reduce((s, v) => s + v, 0);

    // Today
    const todayData  = getData(entries[0].key);
    const todaySecs  = sumDay(todayData);
    const weekSecs   = entries.slice(0, 7).reduce((s, e) => s + sumDay(getData(e.key)), 0);

    document.getElementById('todayTotal').textContent = fmtSecs(todaySecs);
    document.getElementById('weekTotal').textContent  = fmtSecs(weekSecs);

    renderTodaySites(todayData);
    renderWeekChart(entries.slice(0, 7).map(e => ({ dateStr: e.dateStr, secs: sumDay(getData(e.key)) })));
    // history tab removed
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Parse HTML an toàn qua DOMParser (nội dung đã được escape)
function setHTML(el, html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}

function displayName(domain) {
  return escapeHtml(domain === '__private__' ? t('label_private') : domain);
}

// Today by site
function renderTodaySites(data) {
  // __private__ luôn xuống cuối
  const sites = Object.entries(data).sort((a, b) => {
    if (a[0] === '__private__') return 1;
    if (b[0] === '__private__') return -1;
    return b[1] - a[1];
  });
  const el = document.getElementById('todaySites');
  if (!sites.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('popup_no_data');
    el.replaceChildren(empty);
    return;
  }
  const max = Math.max(...sites.map(([, v]) => v), 1);
  setHTML(el, sites.map(([domain, secs]) => `
    <div class="site-row">
      <div class="site-name" title="${displayName(domain)}">${displayName(domain)}</div>
      <div class="site-bar-wrap"><div class="site-bar" style="width:${Math.round(secs/max*100)}%"></div></div>
      <div class="site-time">${fmtSecs(secs)}</div>
    </div>`).join(''));
}

// 7-day bar chart (oldest → newest)
function renderWeekChart(days) {
  const reversed = [...days].reverse(); // oldest first
  const max = Math.max(...reversed.map(d => d.secs), 1);
  setHTML(document.getElementById('weekChart'), reversed.map(d => {
    const h = Math.max(3, Math.round(d.secs / max * 64));
    const label = new Date(d.dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    return `
      <div class="week-bar-col">
        <div class="week-bar" style="height:${h}px" title="${fmtSecs(d.secs)}"></div>
        <div class="week-label">${label}</div>
      </div>`;
  }).join(''));
}


// ── Tabs ──────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});


// Hash đơn giản (djb2) để fingerprint nội dung file
function hashContent(str) {
  let h = 5381;
  for (let i = 0; i < Math.min(str.length, 50000); i++) {
    h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ── Import CSV ────────────────────────────────────────────────
document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const raw = ev.target.result;
    e.target.value = ''; // reset ngay để cho phép chọn lại cùng file

    try {
      const lines = raw.trim().split('\n');
      if (!lines[0].trim().startsWith('Date,Site,Seconds')) {
        alert(t('import_error')); return;
      }

      // Hash nội dung file để phát hiện import trùng
      const fileHash = hashContent(raw);
      const IMPORTS_KEY = 'ald_imported_files';

      chrome.storage.local.get([IMPORTS_KEY], localResult => {
        const imported = localResult[IMPORTS_KEY] || [];

        const proceed = () => {
          // Parse
          const incoming = {};
          let count = 0;
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].trim().split(',');
            if (parts.length < 3) continue;
            const [dateStr, domain, secsStr] = parts;
            const secs = parseInt(secsStr, 10);
            if (!dateStr || !domain || !Number.isFinite(secs) || secs < 0) continue;
            const key = 'ald_' + dateStr.trim();
            if (!incoming[key]) incoming[key] = {};
            incoming[key][domain.trim()] = (incoming[key][domain.trim()] || 0) + secs;
            count++;
          }
          if (!count) { alert(t('import_error')); return; }

          // Merge: SUM existing + imported
          const keys = Object.keys(incoming);
          chrome.storage.local.get(keys, existing => {
            const merged = {};
            keys.forEach(key => {
              const ex = existing[key] || {};
              merged[key] = { ...ex };
              Object.entries(incoming[key]).forEach(([domain, secs]) => {
                merged[key][domain] = (merged[key][domain] || 0) + secs;
              });
            });
            chrome.storage.local.set(merged, () => {
              // Lưu hash để phát hiện import trùng sau này
              const updated = [...new Set([...imported, fileHash])].slice(-10);
              chrome.storage.local.set({ [IMPORTS_KEY]: updated });
              alert(t('import_success', [String(count)]));
              loadAndRender();
            });
          });
        };

        if (imported.includes(fileHash)) {
          // File đã import rồi — hỏi xác nhận
          if (confirm(t('import_duplicate'))) proceed();
        } else {
          proceed();
        }
      });
    } catch {
      alert(t('import_error'));
    }
  };
  reader.readAsText(file);
});

// ── Export CSV ────────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', () => {
  const entries = buildKeys(60);
  chrome.storage.local.get(entries.map(e => e.key), result => {
    let csv = 'Date,Site,Seconds,Time\n';
    entries.forEach(e => {
      const data = result[e.key] || {};
      Object.entries(data).sort((a,b) => b[1]-a[1]).forEach(([domain, secs]) => {
        csv += `${e.dateStr},${domain},${secs},${fmtSecs(secs)}\n`;
      });
    });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `ald-${localDateStr()}.csv`,
    });
    a.click();
  });
});

// ── Clear All ─────────────────────────────────────────────────
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm(t('clear_confirm'))) return;
  const entries = buildKeys(90);
  const keysToRemove = entries.map(e => e.key);
  chrome.storage.local.remove(keysToRemove, loadAndRender);
});

// ── Time Limits & Site-aware Settings ────────────────────────
const LIMITS_KEY  = 'ald_limits';
const SETTINGS_KEY = 'ald_settings';
const DEFAULT_SETTINGS = { blockReels: true, blockAllVideos: true };

let currentDomain = null;
let isFBSite      = false;

function fmtLimit(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  const H = t('hour_abbr'), M = t('min_abbr');
  return h > 0 ? (m > 0 ? `${h}${H} ${m}${M}` : `${h}${H}`) : `${m}${M}`;
}

// Render trạng thái limit của site hiện tại
function renderCurrentLimit(limits) {
  const secs  = currentDomain ? (limits[currentDomain] || 0) : 0;
  const statusEl = document.getElementById('currentLimitStatus');
  const removeBtn = document.getElementById('removeLimitBtn');

  if (secs > 0) {
    const s1 = Object.assign(document.createElement('span'), { textContent: fmtLimit(secs) });
    s1.style.cssText = 'font-size:12px;color:#a78bfa;font-weight:600';
    const s2 = Object.assign(document.createElement('span'), { textContent: t('limit_current') });
    s2.style.cssText = 'font-size:11px;color:rgba(255,255,255,.3);margin-left:6px';
    statusEl.replaceChildren(s1, s2);
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    document.getElementById('limitH').value = h || '';
    document.getElementById('limitM').value = m || '';
    removeBtn.disabled = false;
  } else {
    const s = Object.assign(document.createElement('span'), { textContent: t('limit_none') });
    s.style.cssText = 'font-size:11px;color:rgba(255,255,255,.3)';
    statusEl.replaceChildren(s);
    document.getElementById('limitH').value = '';
    document.getElementById('limitM').value = '';
    removeBtn.disabled = true;
  }
}

// Render danh sách các site khác (trừ site hiện tại) trong Others
function renderAllLimits(limits) {
  const el = document.getElementById('othersList');
  const entries = Object.entries(limits)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('limit_none');
    el.replaceChildren(empty);
    return;
  }
  setHTML(el, entries.map(([domain, secs]) => {
    const isCurrent = domain === currentDomain;
    const label = displayName(domain);
    return `
    <div class="other-row">
      <span class="other-name" title="${label}"
        style="${isCurrent ? 'color:#fff;font-weight:700' : ''}">${label}${isCurrent ? ' ●' : ''}</span>
      <span class="other-limit">${fmtLimit(secs)}</span>
      <button class="other-del" data-domain="${escapeHtml(domain)}">×</button>
    </div>`;
  }).join(''));

  el.querySelectorAll('[data-domain]').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.storage.sync.get([LIMITS_KEY], r => {
        const lim = r[LIMITS_KEY] || {};
        delete lim[btn.dataset.domain];
        chrome.storage.sync.set({ [LIMITS_KEY]: lim }, () => {
          renderCurrentLimit(lim);
          renderAllLimits(lim);
        });
      });
    });
  });
}

function loadLimits() {
  chrome.storage.sync.get([LIMITS_KEY], r => {
    const lim = r[LIMITS_KEY] || {};
    renderCurrentLimit(lim);
    renderAllLimits(lim);
  });
}

// Save/remove limit cho site hiện tại
document.getElementById('saveLimitBtn').addEventListener('click', () => {
  if (!currentDomain) return;
  const h = parseInt(document.getElementById('limitH').value, 10) || 0;
  const m = parseInt(document.getElementById('limitM').value, 10) || 0;
  const secs = h * 3600 + m * 60;
  if (secs <= 0) return;
  chrome.storage.sync.get([LIMITS_KEY], r => {
    const lim = Object.assign({}, r[LIMITS_KEY] || {}, { [currentDomain]: secs });
    chrome.storage.sync.set({ [LIMITS_KEY]: lim }, () => { renderCurrentLimit(lim); renderAllLimits(lim); });
  });
});

document.getElementById('removeLimitBtn').addEventListener('click', () => {
  if (!currentDomain) return;
  chrome.storage.sync.get([LIMITS_KEY], r => {
    const lim = r[LIMITS_KEY] || {};
    delete lim[currentDomain];
    chrome.storage.sync.set({ [LIMITS_KEY]: lim }, () => { renderCurrentLimit(lim); renderAllLimits(lim); });
  });
});

// Others collapsible
document.getElementById('othersToggle').addEventListener('click', () => {
  const body  = document.getElementById('othersList');
  const arrow = document.getElementById('othersArrow');
  const open  = body.classList.toggle('open');
  arrow.classList.toggle('open', open);
});

// FB blocking settings (chỉ show khi trên Facebook)
function loadFBSettings() {
  chrome.storage.local.get([SETTINGS_KEY], result => {
    const s = Object.assign({}, DEFAULT_SETTINGS, result[SETTINGS_KEY] || {});
    document.getElementById('blockReels').checked    = s.blockReels;
    document.getElementById('blockAllVideos').checked = s.blockAllVideos;
  });
}

function saveFBSettings() {
  chrome.storage.local.set({
    [SETTINGS_KEY]: {
      blockReels:     document.getElementById('blockReels').checked,
      blockAllVideos: document.getElementById('blockAllVideos').checked,
    }
  });
}

document.getElementById('blockReels').addEventListener('change', saveFBSettings);
document.getElementById('blockAllVideos').addEventListener('change', saveFBSettings);

// Detect current tab và render settings phù hợp
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  try {
    const url = tabs[0] && tabs[0].url;
    if (url && !url.startsWith('chrome') && !url.startsWith('about') && !url.startsWith('edge')) {
      currentDomain = new URL(url).hostname.replace(/^www\./, '');
    }
  } catch {}

  isFBSite = !!currentDomain && /(?:^|\.)facebook\.com$/.test(currentDomain);

  document.getElementById('currentSiteName').textContent = currentDomain || '—';
  document.getElementById('fbSection').style.display     = isFBSite ? 'block' : 'none';

  loadLimits();
  if (isFBSite) loadFBSettings();
});

// ── Init ──────────────────────────────────────────────────────
loadAndRender();
