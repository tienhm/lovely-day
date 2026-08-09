(function () {
  'use strict';

  const isFB     = /(?:^|\.)facebook\.com$/.test(location.hostname);
  const TWO_LEVEL_TLDS = ['com','co','gov','org','net','edu','ac'];

  // Chuẩn hóa về root domain để các subdomain cùng site gộp chung
  // login.microsoft.com → microsoft.com | maps.google.com.vn → google.com.vn
  function getRootDomain(hostname) {
    const h = hostname.replace(/^www\./, '');
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    const last = parts[parts.length - 1] || '';
    const secondLast = parts[parts.length - 2] || '';
    const keep = (last.length === 2 && TWO_LEVEL_TLDS.includes(secondLast)) ? 3 : 2;
    return parts.slice(-keep).join('.');
  }

  const HOSTNAME = getRootDomain(location.hostname);

  // Lấy tên chính của domain, bỏ subdomain và TLD
  // Ví dụ: maps.google.com.vn → google | www.bbc.co.uk → bbc | youtube.com → youtube
  function getSiteName(hostname) {
    const parts = hostname.split('.');
    const last       = parts[parts.length - 1] || '';
    const secondLast = parts[parts.length - 2] || '';
    const idx = (last.length === 2 && TWO_LEVEL_TLDS.includes(secondLast))
      ? parts.length - 3
      : parts.length - 2;
    return parts[Math.max(0, idx)] || hostname;
  }

  const DOMAIN = getSiteName(location.hostname);

  // Incognito/Private: dùng bộ đếm chung, không phân biệt URL
  // isIncognito sẽ được xác định async ở cuối file (MV3 Chrome không còn chrome.extension.inIncognitoContext)
  let isIncognito = false;
  let STORE_HOST = HOSTNAME;
  let DISPLAY_NAME = DOMAIN;

  // ─── i18n helper ─────────────────────────────────────────────
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  // Parse HTML an toàn — nội dung template đã được escape trước khi truyền vào
  function parseHTML(html) {
    return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  }
  function setElHTML(el, html) { el.replaceChildren(...Array.from(parseHTML(html).childNodes)); }

  // ─── Helpers ─────────────────────────────────────────────────
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ─── Lock ────────────────────────────────────────────────────
  // Dùng chrome.storage.local thay localStorage để Facebook JS không xóa được
  let LOCK_STORAGE_KEY;
  const LIMITS_KEY       = 'ald_limits';

  // Ẩn trang ngay lập tức trong lúc check lock (tránh flash nội dung)
  const lockCheckStyle = document.createElement('style');
  lockCheckStyle.textContent = 'html{visibility:hidden!important}#ald-lock-screen{visibility:visible!important}';
  document.documentElement.appendChild(lockCheckStyle);
  // Fallback: nếu storage callback không fire (extension reload, quota error...) thì hiện trang sau 3s
  const lockCheckFallback = setTimeout(() => lockCheckStyle.remove(), 3000);

  // Định dạng giây → "Xh Yp" hoặc "Zp"
  function fmtSecs(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const H = t('hour_abbr'), M = t('min_abbr');
    if (h === 0 && m === 0) return s > 0 ? t('less_than_1min') : '0' + M;
    return h === 0 ? `${m}${M}` : (m > 0 ? `${h}${H} ${m}${M}` : `${h}${H}`);
  }

  // Render thống kê vào container trong lock screen (async)
  function renderLockStats(container) {
    const hostname = STORE_HOST; // '__private__' in incognito, real host otherwise
    const now = new Date();

    const days = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = `ald_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return {
        key,
        label: d.toLocaleDateString('vi-VN', { weekday: 'short' }),
        month: d.getMonth(), year: d.getFullYear(), i,
      };
    });

    chrome.storage.local.get(days.map(d => d.key), result => {
      const site  = k => ((result[k] || {})[hostname] || 0);
      const total = k => Object.values(result[k] || {}).reduce((s, v) => s + v, 0);

      const todaySecs    = site(days[0].key);
      const thisWeekSecs = days.slice(0, 7).reduce((s, d) => s + site(d.key), 0);
      const lastWeekSecs = days.slice(7, 14).reduce((s, d) => s + site(d.key), 0);

      const cm = now.getMonth(), cy = now.getFullYear();
      const pm = cm === 0 ? 11 : cm - 1, py = cm === 0 ? cy - 1 : cy;
      const thisMonthSecs = days.filter(d => d.month === cm && d.year === cy).reduce((s, d) => s + site(d.key), 0);
      const lastMonthSecs = days.filter(d => d.month === pm && d.year === py).reduce((s, d) => s + site(d.key), 0);

      const siteTotalSecs = days.slice(0, 30).reduce((s, d) => s + site(d.key), 0);
      const allTotalSecs  = days.slice(0, 30).reduce((s, d) => s + total(d.key), 0);
      const ratio         = allTotalSecs > 0 ? Math.round(siteTotalSecs / allTotalSecs * 100) : 0;

      const last7   = days.slice(0, 7).reverse();
      const maxSecs = Math.max(...last7.map(d => site(d.key)), 1);

      function badge(curr, prev) {
        if (!prev) return '';
        const pct = Math.round((curr - prev) / prev * 100);
        if (Math.abs(pct) < 3) return ` <span style="color:rgba(255,255,255,.3);font-size:10px">–</span>`;
        return pct > 0
          ? ` <span style="color:#ff7878;font-size:10px">↑${pct}%</span>`
          : ` <span style="color:#78e89a;font-size:10px">↓${Math.abs(pct)}%</span>`;
      }

      const card = (lbl, val, sub) => `
        <div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
             border-radius:10px;padding:12px 10px;text-align:center">
          <div style="font-size:9px;letter-spacing:1px;color:rgba(255,255,255,.4);
               text-transform:uppercase;margin-bottom:6px">${lbl}</div>
          <div style="font-size:20px;font-weight:700;font-variant-numeric:tabular-nums">${val}</div>
          ${sub ? `<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:3px">${sub}</div>` : ''}
        </div>`;

      const bars = last7.map(d => {
        const s = site(d.key);
        const h = Math.max(4, Math.round(s / maxSecs * 72));
        return `
          <div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:3px">
            <div style="font-size:9px;color:rgba(255,255,255,.35);height:14px;display:flex;align-items:flex-end">${fmtSecs(s)}</div>
            <div style="width:100%;height:${h}px;
                 background:linear-gradient(180deg,rgba(130,160,255,.8),rgba(100,120,220,.5));
                 border-radius:3px 3px 0 0;min-height:4px"></div>
            <div style="font-size:9px;color:rgba(255,255,255,.4)">${d.label}</div>
          </div>`;
      }).join('');

      setElHTML(container, `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${card(t('stat_today'),       fmtSecs(todaySecs))}
            ${card(t('stat_this_week'),  fmtSecs(thisWeekSecs),  t('stat_vs_last_week')  + badge(thisWeekSecs,  lastWeekSecs))}
            ${card(t('stat_this_month'), fmtSecs(thisMonthSecs), t('stat_vs_last_month') + badge(thisMonthSecs, lastMonthSecs))}
          </div>

          <div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
               border-radius:10px;padding:14px">
            <div style="font-size:9px;letter-spacing:1px;color:rgba(255,255,255,.4);
                 text-transform:uppercase;margin-bottom:10px">${t('stat_last_7_days')}</div>
            <div style="display:flex;gap:5px;align-items:flex-end;height:100px">${bars}</div>
          </div>

          <div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
               border-radius:10px;padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
              <div style="font-size:9px;letter-spacing:1px;color:rgba(255,255,255,.4);text-transform:uppercase">
                ${t('stat_ratio_title')}
              </div>
              <div style="font-size:18px;font-weight:700">${ratio}%</div>
            </div>
            <div style="height:8px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${ratio}%;
                   background:linear-gradient(90deg,rgba(130,160,255,.9),rgba(180,110,255,.9));
                   border-radius:4px"></div>
            </div>
            <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:6px">
              ${fmtSecs(siteTotalSecs)} ${t('stat_of_total')} ${fmtSecs(allTotalSecs)}
            </div>
          </div>
        </div>`);
    });
  }

  function showLockScreen() {
    clearTimeout(lockCheckFallback);
    lockCheckStyle.remove(); // bỏ html{visibility:hidden}, lock screen tự xử lý ẩn nội dung
    if (document.getElementById('ald-lock-screen')) return;
    const hideStyle = document.createElement('style');
    hideStyle.textContent =
      'body>*:not(#ald-lock-screen){visibility:hidden!important;pointer-events:none!important}';
    (document.head || document.documentElement).appendChild(hideStyle);

    const el = document.createElement('div');
    el.id = 'ald-lock-screen';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'overflow-y:auto',
      'background:linear-gradient(135deg,#0f0f1a 0%,#1a1a3e 55%,#0a1628 100%)',
      'display:flex', 'flex-direction:column', 'align-items:center',
      'padding:40px 24px 40px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', 'color:#fff', 'color-scheme:dark',
    ].join(';');
    setElHTML(el, `
      <div style="filter:drop-shadow(0 0 28px rgba(120,140,255,.55));margin-bottom:16px">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
        </svg>
      </div>
      <h1 style="font-size:26px;font-weight:700;margin:0 0 6px;letter-spacing:-.5px;color:#fff">${t('site_locked_title', [DISPLAY_NAME])}</h1>
      <p style="font-size:15px;color:rgba(255,255,255,.85);margin:0 0 24px;text-align:center;font-style:italic">${t('site_locked_msg')}</p>

      <div id="ald-lock-stats" style="width:100%;max-width:460px;margin-bottom:24px">
        <div style="text-align:center;padding:20px;color:rgba(255,255,255,.25);font-size:13px">
          ${t('loading_stats')}
        </div>
      </div>

      <p style="font-size:13px;color:rgba(255,255,255,.45);margin:0 0 10px;text-align:center">
        ${t('unlock_tagline')}
      </p>
      <button id="ald-unlock-btn" style="background:rgba(255,255,255,0.08);
        border:1px solid rgba(255,255,255,0.2);border-radius:10px;
        color:rgba(255,255,255,0.6);font-size:13px;font-family:inherit;
        padding:10px 28px;cursor:pointer;transition:all .2s">
        ${t('unlock_early')}
      </button>
    `);

    function append() {
      if (!document.body) return;
      document.body.appendChild(el);
      const btn = el.querySelector('#ald-unlock-btn');
      if (btn) {
        btn.addEventListener('mouseover', () => { btn.style.background='rgba(255,255,255,.16)'; btn.style.color='#fff'; });
        btn.addEventListener('mouseout',  () => { btn.style.background='rgba(255,255,255,.08)'; btn.style.color='rgba(255,255,255,.6)'; });
        btn.addEventListener('click', () => {
          chrome.storage.sync.get([LIMITS_KEY], r => {
            const siteLimitSecs = ((r[LIMITS_KEY] || {})[STORE_HOST]) || 600;
            const graceSecs = Math.min(600, siteLimitSecs);
            chrome.storage.local.set(
              { ['ald_grace_' + STORE_HOST]: { until: Date.now() + graceSecs * 1000 } },
              () => chrome.storage.local.remove(LOCK_STORAGE_KEY, () => location.reload())
            );
          });
        });
      }
      renderLockStats(el.querySelector('#ald-lock-stats'));
    }
    document.body ? append() : document.addEventListener('DOMContentLoaded', append);
  }

  function lockForToday() {
    chrome.storage.local.set({ [LOCK_STORAGE_KEY]: { date: todayStr() } });
    showLockScreen();
  }

  // ─── Facebook blocking (chỉ chạy trên FB) ───────────────────
  let startFB = null; // gán bên dưới nếu isFB, gọi sau khi lock check xong
  if (isFB) {
    const BLOCKED_CLASS   = 'ald-blocked';
    const SCANNED_ATTR    = 'data-ald-scanned';
    const SETTINGS_KEY    = 'ald_settings';
    const DEFAULT_SETTINGS = { blockReels: true, blockAllVideos: true };

    let reelsStyleEl   = null;
    let videosStyleEl  = null;
    let currentSettings = Object.assign({}, DEFAULT_SETTINGS);

    const REELS_CSS = `
      [role="article"]:has(a[href*="/reel/"]),
      [role="article"]:has(a[href*="/reels"]),
      [role="article"]:has([aria-label*="Reel"]),
      [role="article"]:has([aria-label*="Reels"]) { display:none!important }
      a[href*="/reels"],
      li:has(a[href*="/reels"]),
      [role="listitem"]:has(a[href*="/reels"]),
      [role="menuitem"]:has(a[href*="/reels"]) { display:none!important }
      [data-pagelet*="eel"],[data-pagelet*="torie"] { display:none!important }
      [data-ad-video] { display:none!important }
      [role="article"]:has([data-ad-video]) { display:none!important }
      .${BLOCKED_CLASS} { display:none!important }
    `;
    const VIDEOS_CSS = `
      [role="article"]:has(video) { display:none!important }
      video { display:none!important }
      div:has(> [data-visualcompletion]:has([data-video-id])) { display:none!important }
      [data-video-id] { display:none!important }
      .${BLOCKED_CLASS} { display:none!important }
    `;

    function injectCSS() {
      const root = document.head || document.documentElement;
      reelsStyleEl = document.createElement('style');
      reelsStyleEl.id = 'ald-reels';
      reelsStyleEl.textContent = REELS_CSS;
      root.appendChild(reelsStyleEl);

      videosStyleEl = document.createElement('style');
      videosStyleEl.id = 'ald-videos';
      videosStyleEl.textContent = VIDEOS_CSS;
      root.appendChild(videosStyleEl);
    }

    // Direct video URLs: show confirm overlay instead of silently blocking
    function isDirectVideoUrl(url) {
      try {
        const p = new URL(url, location.href).pathname;
        return /^\/(share\/v|videos|reel)\//i.test(p) || /^\/watch(\/|$)/i.test(p);
      } catch { return false; }
    }

    let videoConfirmEl = null;
    let videoConfirmed = false;
    let urlWatcherId = null;
    const stopScrollEvent = e => { e.preventDefault(); e.stopPropagation(); };
    const stopScrollKey   = e => {
      if (['ArrowDown','ArrowUp','PageDown','PageUp'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    // Block clicks inside .__fb-dark-mode (prev/next nav zones) — mute button is not in this wrapper
    const stopNavClick = e => {
      if (e.target.closest('.__fb-dark-mode')) {
        e.preventDefault(); e.stopPropagation();
      }
    };

    function lockScroll() {
      window.addEventListener('wheel',     stopScrollEvent, { passive: false, capture: true });
      window.addEventListener('touchmove', stopScrollEvent, { passive: false, capture: true });
      window.addEventListener('keydown',   stopScrollKey,   { capture: true });
      window.addEventListener('click',     stopNavClick,    { capture: true });
      // Fallback: poll URL every 150ms — catches any navigation mechanism (X button, etc.)
      if (!urlWatcherId) {
        urlWatcherId = setInterval(() => {
          if (!isDirectVideoUrl(location.href)) {
            resetVideoConfirmed();
            applySettings(currentSettings);
          }
        }, 150);
      }
    }

    function unlockScroll() {
      window.removeEventListener('wheel',     stopScrollEvent, { capture: true });
      window.removeEventListener('touchmove', stopScrollEvent, { capture: true });
      window.removeEventListener('keydown',   stopScrollKey,   { capture: true });
      window.removeEventListener('click',     stopNavClick,    { capture: true });
      if (urlWatcherId) { clearInterval(urlWatcherId); urlWatcherId = null; }
    }

    function resetVideoConfirmed() {
      if (videoConfirmed) unlockScroll();
      videoConfirmed = false;
    }

    function removeVideoConfirm() {
      if (videoConfirmEl) { videoConfirmEl.remove(); videoConfirmEl = null; }
    }

    function showVideoConfirm() {
      if (videoConfirmEl) return;
      const el = document.createElement('div');
      el.id = 'ald-video-confirm';
      el.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483646',
        'background:rgba(10,10,16,0.88)',
        'backdrop-filter:blur(10px)', '-webkit-backdrop-filter:blur(10px)',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:18px',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', 'color:#fff', 'color-scheme:dark',
      ].join(';');
      setElHTML(el, `
        <svg width="52" height="52" viewBox="0 0 24 24" fill="rgba(255,255,255,0.75)"><path d="M8 5v14l11-7z"/></svg>
        <div style="font-size:16px;font-weight:500;text-align:center;max-width:300px;line-height:1.5;color:rgba(255,255,255,.85)">
          ${t('video_confirm_msg')}
        </div>
        <div style="display:flex;gap:10px">
          <button id="ald-video-watch" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);
            border-radius:10px;color:#fff;font-size:14px;font-family:inherit;padding:10px 28px;cursor:pointer;transition:background .2s">
            ${t('video_confirm_watch')}
          </button>
          <button id="ald-video-back" style="background:none;border:1px solid rgba(255,255,255,.1);
            border-radius:10px;color:rgba(255,255,255,.45);font-size:14px;font-family:inherit;padding:10px 20px;cursor:pointer;transition:background .2s">
            ${t('video_confirm_back')}
          </button>
        </div>
      `);
      const append = () => {
        document.body.appendChild(el);
        const watchBtn = el.querySelector('#ald-video-watch');
        const backBtn  = el.querySelector('#ald-video-back');
        watchBtn.addEventListener('mouseover', () => { watchBtn.style.background = 'rgba(255,255,255,.22)'; });
        watchBtn.addEventListener('mouseout',  () => { watchBtn.style.background = 'rgba(255,255,255,.12)'; });
        watchBtn.addEventListener('click', () => {
          videoConfirmed = true;
          removeVideoConfirm();
          if (videosStyleEl) videosStyleEl.disabled = true;
          if (reelsStyleEl)  reelsStyleEl.disabled  = true;
          document.querySelectorAll('.' + BLOCKED_CLASS).forEach(el => el.classList.remove(BLOCKED_CLASS));
          lockScroll();
          // Force Facebook's player to reinitialize so mute/unmute button works
          setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        });
        backBtn.addEventListener('click', () => history.back());
      };
      videoConfirmEl = el;
      document.body ? append() : document.addEventListener('DOMContentLoaded', append);
    }

    function refreshVideoBlocking() {
      const onDirectVideo = isDirectVideoUrl(location.href);
      const blocking = currentSettings.blockAllVideos;
      if (blocking && onDirectVideo && !videoConfirmed) {
        if (videosStyleEl) videosStyleEl.disabled = false;
        showVideoConfirm();
      } else {
        if (videosStyleEl) videosStyleEl.disabled = !blocking || videoConfirmed;
        if (!blocking || !onDirectVideo) resetVideoConfirmed();
        removeVideoConfirm();
      }
    }

    function applySettings(settings) {
      currentSettings = Object.assign({}, DEFAULT_SETTINGS, settings);
      if (reelsStyleEl) reelsStyleEl.disabled = !currentSettings.blockReels;
      refreshVideoBlocking();
    }

    function loadSettings() {
      chrome.storage.local.get([SETTINGS_KEY], r => applySettings(r[SETTINGS_KEY] || {}));
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) {
        applySettings(changes[SETTINGS_KEY].newValue || {});
      }
    });

    function isReelsUrl(url) {
      if (!url) return false;
      try { return /^\/(reel|reels)(\/|$)/i.test(new URL(url, location.href).pathname); }
      catch { return /\/(reel|reels)(\/|$)/i.test(url); }
    }

    function redirectIfReels() {
      if (!isReelsUrl(location.href)) return;
      // Nếu user navigate trực tiếp (paste URL, bookmark) thì không redirect — để overlay confirm xử lý
      try {
        const ref = document.referrer;
        if (!ref || !new URL(ref).hostname.endsWith('facebook.com')) return;
      } catch {}
      location.replace('https://www.facebook.com/');
    }

    function patchHistory() {
      function wrap(orig) {
        return function (state, title, url) {
          if (videoConfirmed && url && isDirectVideoUrl(url)) return;
          const r = orig.apply(this, arguments);
          if (url && isReelsUrl(url) && !isDirectVideoUrl(location.href)) setTimeout(() => location.replace('https://www.facebook.com/'), 50);
          else {
            resetVideoConfirmed();
            setTimeout(() => { applySettings(currentSettings); scan(); }, 400);
          }
          return r;
        };
      }
      try { history.pushState = wrap(history.pushState); history.replaceState = wrap(history.replaceState); } catch {}

      // Block history.back/forward/go while watching (Facebook's up/down buttons use these)
      try {
        const origBack    = history.back.bind(history);
        const origForward = history.forward.bind(history);
        const origGo      = history.go.bind(history);
        history.back    = function() { if (!videoConfirmed) origBack(); };
        history.forward = function() { if (!videoConfirmed) origForward(); };
        history.go      = function(n) { if (!videoConfirmed) origGo(n); };
      } catch {}

      window.addEventListener('popstate', () => {
        redirectIfReels();
        resetVideoConfirmed();
        applySettings(currentSettings);
        setTimeout(scan, 400);
      });
    }

    function block(el) {
      if (!el || el.classList.contains(BLOCKED_CLASS)) return;
      el.classList.add(BLOCKED_CLASS);
    }

    function getArticle(el) {
      return el.closest('[role="article"]') || el.closest('[data-pagelet]') || el.closest('li[class]');
    }

    function getSectionContainer(el, levels = 6) {
      let p = el.parentElement;
      for (let i = 0; i < levels && p; i++, p = p.parentElement) {
        const role = p.getAttribute('role');
        if (role === 'region' || role === 'complementary' || role === 'feed') return p;
        if (p.dataset && p.dataset.pagelet) return p;
        if (p.children.length > 2 && p.scrollWidth > window.innerWidth * 0.8) return p;
      }
      return null;
    }

    function scan() {
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (!/\/(reel|reels)(\/|$|\?|#)/i.test(href)) return;
        const article = getArticle(a);
        if (article) { block(article); return; }
        block(a.closest('li') || a.closest('[role="listitem"]') || a.closest('[role="menuitem"]') || a);
      });

      document.querySelectorAll('[aria-label]').forEach(el => {
        if (!/reel/i.test(el.getAttribute('aria-label'))) return;
        block(getArticle(el) || el);
      });

      document.querySelectorAll('span,h1,h2,h3,h4').forEach(el => {
        if (!/^reels?$/i.test(el.textContent.trim()) || el[SCANNED_ATTR]) return;
        el[SCANNED_ATTR] = true;
        const c = getSectionContainer(el) || el.closest('[role="region"]') || el.closest('[data-pagelet]');
        if (c) block(c);
      });

      document.querySelectorAll('video').forEach(video => {
        if (video[SCANNED_ATTR]) return;
        video[SCANNED_ATTR] = true;
        function check() {
          const { videoWidth: w, videoHeight: h } = video;
          if (!w || !h) return;
          if (h / w > 1.2) block(getArticle(video) || video.closest('div[class]') || video);
        }
        video.readyState >= 1 ? check() : video.addEventListener('loadedmetadata', check, { once: true });
      });

      if (currentSettings.blockAllVideos && !isDirectVideoUrl(location.href)) {
        document.querySelectorAll('[data-video-id]').forEach(el => {
          if (el[SCANNED_ATTR]) return;
          el[SCANNED_ATTR] = true;
          const article = getArticle(el);
          if (article) { block(article); return; }
          let cur = el;
          for (let i = 0; i < 3 && cur.parentElement && cur.parentElement !== document.body; i++) cur = cur.parentElement;
          block(cur);
        });
      }
    }

    function observe() {
      let timer = null;
      new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 100); })
        .observe(document.documentElement, { childList: true, subtree: true });
    }

    startFB = function () {
      injectCSS();
      loadSettings();
      patchHistory();
      redirectIfReels();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { scan(); observe(); });
      } else {
        scan();
        observe();
      }
      window.addEventListener('load', scan);
    };
  }

  // ─── Floating timer (tất cả website) ────────────────────────
  function initFloatingTimer() {
    const TIMER_CSS = `
      #ald-clock-row { display:flex; align-items:center; gap:8px; }
      #ald-lock-btn {
        background:none; border:none; cursor:pointer; padding:0;
        display:flex; align-items:center; color:rgba(255,255,255,0.45);
        flex-shrink:0; transition:color 0.2s;
      }
      #ald-lock-btn:hover { color:rgba(255,255,255,0.9); }
      #ald-clock.mini #ald-lock-btn { display:none; }
      #ald-clock {
        position:fixed; z-index:2147483647;
        background:rgba(10,10,16,0.82);
        backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
        border:1px solid rgba(255,255,255,0.10); border-radius:14px;
        padding:10px 18px 12px;
        box-shadow:0 6px 28px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.06);
        cursor:grab; user-select:none;
        transition:background 0.6s,box-shadow 0.3s;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      }
      #ald-clock.dragging { cursor:grabbing; box-shadow:0 16px 48px rgba(0,0,0,0.7); transform:scale(1.04); }
      #ald-clock:hover:not(.dragging) { box-shadow:0 10px 36px rgba(0,0,0,0.65); }
      #ald-clock.warn { background:rgba(140,72,0,0.88); border-color:rgba(255,160,60,0.25); }
      #ald-clock.over { background:rgba(140,18,18,0.90); border-color:rgba(255,80,80,0.25); }
      #ald-clock.mini { padding:7px 13px; border-radius:20px; }
      #ald-clock-label {
        font-size:9px; font-weight:600; letter-spacing:2px;
        color:rgba(255,255,255,0.32); text-transform:uppercase;
        margin-bottom:5px; display:flex; align-items:center; gap:5px;
      }
      #ald-clock.mini #ald-clock-label { display:none; }
      #ald-clock-dot {
        width:5px; height:5px; border-radius:50%;
        background:#4cff91; flex-shrink:0; box-shadow:0 0 5px #4cff91;
      }
      #ald-clock-dot.paused { background:rgba(255,255,255,0.22); box-shadow:none; }
      #ald-clock-time {
        font-family:'SF Mono','Cascadia Code','Consolas','Courier New',monospace;
        font-size:26px; font-weight:700; color:#fff;
        letter-spacing:3px; line-height:1; font-variant-numeric:tabular-nums;
      }
      #ald-clock.mini #ald-clock-time { font-size:12px; letter-spacing:1.5px; color:rgba(255,255,255,0.78); }
      /* Countdown mode: dot màu cam thay vì xanh */
      #ald-clock.countdown #ald-clock-dot { background:#f59e0b; box-shadow:0 0 5px #f59e0b; }
      #ald-clock.countdown #ald-clock-dot.paused { background:rgba(255,255,255,0.22); box-shadow:none; }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = TIMER_CSS;
    document.head.appendChild(styleEl);

    const SVG_LOCK = `<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
    </svg>`;

    const widget = document.createElement('div');
    widget.id = 'ald-clock';
    setElHTML(widget, `
      <div id="ald-clock-label"><span id="ald-clock-dot"></span>${DISPLAY_NAME}</div>
      <div id="ald-clock-row">
        <div id="ald-clock-time">00:00</div>
        ${isIncognito ? '' : `<button id="ald-lock-btn" title="${t('lock_btn_title', [DISPLAY_NAME])}">${SVG_LOCK}</button>`}
      </div>
    `);
    document.body.appendChild(widget);

    const timeEl = widget.querySelector('#ald-clock-time');
    const dotEl  = widget.querySelector('#ald-clock-dot');

    // ── Vị trí (localStorage: không cần sync) ──
    const POS_KEY = 'ald-clock-pos';

    function clampAndSet(top, left) {
      const w = widget.offsetWidth  || 160;
      const h = widget.offsetHeight || 72;
      top  = Math.max(0, Math.min(top,  window.innerHeight - h));
      left = Math.max(0, Math.min(left, window.innerWidth  - w));
      widget.style.top  = top  + 'px';
      widget.style.left = left + 'px';
    }

    function savePos() {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({
          top: parseFloat(widget.style.top), left: parseFloat(widget.style.left),
        }));
      } catch {}
    }

    function initPos() {
      try {
        const s = JSON.parse(localStorage.getItem(POS_KEY));
        if (s && Number.isFinite(s.top) && Number.isFinite(s.left)) { clampAndSet(s.top, s.left); return; }
      } catch {}
      const banner = document.querySelector('[role="banner"]');
      const main   = document.querySelector('[role="main"]');
      const top    = (banner ? banner.getBoundingClientRect().bottom : 56) + 8;
      const left   = main
        ? main.getBoundingClientRect().right - (widget.offsetWidth || 160) - 12
        : window.innerWidth - (widget.offsetWidth || 160) - 16;
      clampAndSet(top, left);
    }
    requestAnimationFrame(initPos);

    // Re-clamp khi window resize hoặc detach sang cửa sổ mới
    window.addEventListener('resize', () => {
      const top  = parseFloat(widget.style.top)  || 0;
      const left = parseFloat(widget.style.left) || 0;
      clampAndSet(top, left);
    });

    // ── Drag ──
    let dragging = false, hasMoved = false, origin = {};
    widget.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true; hasMoved = false;
      const r = widget.getBoundingClientRect();
      origin = { mx: e.clientX, my: e.clientY, el_top: r.top, el_left: r.left };
      widget.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - origin.mx, dy = e.clientY - origin.my;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      clampAndSet(origin.el_top + dy, origin.el_left + dx);
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      widget.classList.remove('dragging');
      if (hasMoved) savePos();
    });

    // ── Click (không drag) → thu nhỏ ──
    let mini = false;
    widget.addEventListener('click', e => {
      if (hasMoved || e.target.closest('#ald-lock-btn')) return;
      mini = !mini;
      widget.classList.toggle('mini', mini);
      requestAnimationFrame(savePos);
    });

    // ── Lock button (chỉ FB) ──
    const lockBtn = widget.querySelector('#ald-lock-btn');
    if (lockBtn) {
      lockBtn.addEventListener('click', e => {
        e.stopPropagation();
        lockForToday();
      });
    }

    // ── Timer — chrome.storage.local ──
    let SYNC_KEY = 'ald_' + todayStr();

    function fmt(s) {
      s = Math.max(0, s);
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
      return h > 0
        ? `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
        : `${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
    }

    let seconds   = 0;
    let timeLimit = null; // giây, null = không giới hạn

    function fmtDisplay() {
      if (timeLimit !== null) {
        // Đang trong grace period → hiện thời gian grace còn lại
        if (graceUntil && Date.now() < graceUntil) {
          return fmt(Math.ceil((graceUntil - Date.now()) / 1000));
        }
        return fmt(Math.max(0, timeLimit - seconds));
      }
      return fmt(seconds);
    }

    function applyLimit(limits) {
      const raw = limits && limits[STORE_HOST];
      timeLimit = raw ? Number(raw) : null;
      widget.classList.toggle('countdown', timeLimit !== null);
    }

    function updateColor() {
      widget.classList.remove('warn', 'over');
      if (timeLimit !== null) {
        const ratio = (timeLimit - seconds) / timeLimit;
        if (seconds >= timeLimit || ratio <= 0.25) widget.classList.add('over');
        else if (ratio <= 0.5) widget.classList.add('warn');
      } else {
        if (seconds >= 3600)      widget.classList.add('over');
        else if (seconds >= 1800) widget.classList.add('warn');
      }
    }

    // Grace key dùng STORE_HOST: trong incognito tất cả sites dùng chung '__private__'
    // nên unlock 1 tab = grace cho tất cả incognito tabs — đây là behavior mong muốn
    const GRACE_KEY = 'ald_grace_' + STORE_HOST;
    let graceUntil = 0;


    let dayCache    = {};
    let localLoaded = false; // guard: không save trước khi local.get callback chạy

    // Gửi timer lên background để ghi vào storage chính (persistent cả incognito)
    function saveTimer(callback) {
      if (!localLoaded) return; // tránh ghi đè data thật bằng {} khi pagehide quá sớm
      saveDay(SYNC_KEY, seconds, callback);
    }

    // Helpers gửi/nhận qua background — tránh content script incognito tự ghi storage bị mất
    function saveDay(key, value, callback) {
      const msg = { type: 'saveTimer', key, host: STORE_HOST, seconds: value };
      if (typeof callback === 'function') {
        chrome.runtime.sendMessage(msg, callback);
      } else {
        chrome.runtime.sendMessage(msg);
      }
    }
    function getDay(key, callback) {
      chrome.runtime.sendMessage(
        { type: 'getTimer', key, host: STORE_HOST },
        response => callback((response && response.dayCache) || {})
      );
    }

    // Lấy storage tươi từ background, merge với local, hỗ trợ đổi ngày, rồi ghi lại
    let isSaving = false;
    function mergeAndSaveTimer(callback) {
      if (!localLoaded) { if (callback) callback(); return; }
      if (isSaving) { if (callback) callback(); return; }

      const currentToday = todayStr();
      const currentKeyDate = SYNC_KEY.replace('ald_', '');

      if (currentToday !== currentKeyDate) {
        // Đang qua ngày mới: lưu giây tích lũy vào key cũ rồi chuyển sang key mới
        isSaving = true;
        const oldKey = SYNC_KEY;
        const oldSeconds = seconds;
        getDay(oldKey, oldFresh => {
          const oldStored = Math.round(oldFresh[STORE_HOST] || 0);
          const mergedOld = { ...oldFresh, [STORE_HOST]: Math.max(oldStored, oldSeconds) };
          saveDay(oldKey, mergedOld[STORE_HOST], () => {
            SYNC_KEY = 'ald_' + currentToday;
            getDay(SYNC_KEY, newFresh => {
              dayCache = newFresh;
              const newStored = Math.round(dayCache[STORE_HOST] || 0);
              // Giữ lại thời gian đã trôi qua trong lúc đổi ngày, lấy max với storage
              seconds = Math.max(newStored, seconds - oldSeconds);
              saveDay(SYNC_KEY, seconds, () => {
                isSaving = false;
                timeEl.textContent = fmtDisplay();
                updateColor();
                if (callback) callback();
              });
            });
          });
        });
        return;
      }

      isSaving = true;
      getDay(SYNC_KEY, fresh => {
        const stored = Math.round(fresh[STORE_HOST] || 0);
        dayCache = { ...fresh, [STORE_HOST]: Math.max(stored, seconds) };
        seconds  = Math.max(stored, seconds);
        saveDay(SYNC_KEY, seconds, () => {
          isSaving = false;
          if (callback) callback();
        });
      });
    }

    window.addEventListener('pagehide', mergeAndSaveTimer);
    window.addEventListener('beforeunload', mergeAndSaveTimer);
    if ('onfreeze' in document) {
      document.addEventListener('freeze', mergeAndSaveTimer);
    }

    // Cập nhật ngay khi popup thay đổi limit
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[LIMITS_KEY]) {
        applyLimit(changes[LIMITS_KEY].newValue || {});
        timeEl.textContent = fmtDisplay();
        updateColor();
      }
    });

    // Bước 1: load timer từ background (persistent cả incognito), sau đó grace
    getDay(SYNC_KEY, timerDayCache => {
      dayCache    = timerDayCache;
      seconds     = Math.round(dayCache[STORE_HOST] || 0);
      localLoaded = true;

      chrome.storage.local.get([GRACE_KEY], graceRes => {
        const grace = graceRes[GRACE_KEY];
        if (grace && grace.until > Date.now()) {
          graceUntil = grace.until;
        } else if (grace) {
          chrome.storage.local.remove(GRACE_KEY);
        }

        timeEl.textContent = fmtDisplay();
        updateColor();

        // visibilitychange đăng ký sau khi graceUntil đã sẵn sàng
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            saveTimer();
            mergeAndSaveTimer();
          } else {
            mergeAndSaveTimer(() => {
              timeEl.textContent = fmtDisplay();
              updateColor();
            });
          }
        });

        if ('onresume' in document) {
          document.addEventListener('resume', () => {
            mergeAndSaveTimer(() => {
              timeEl.textContent = fmtDisplay();
              updateColor();
            });
          });
        }

        // Interval khởi động ngay sau khi load timer
        let intervalId;
        intervalId = setInterval(() => {
          // Kiểm tra chuyển ngày mỗi giây
          if (todayStr() !== SYNC_KEY.replace('ald_', '')) {
            mergeAndSaveTimer();
          }

          const paused = document.hidden;
          dotEl.classList.toggle('paused', paused);
          if (paused) return;
          seconds++;
          timeEl.textContent = fmtDisplay();
          updateColor();
          if (timeLimit !== null && seconds >= timeLimit) {
            if (graceUntil && Date.now() < graceUntil) {
              // Đang trong grace period — chưa lock
            } else {
              graceUntil = 0;
              clearInterval(intervalId);
              saveTimer();
              mergeAndSaveTimer(lockForToday);
              return;
            }
          }
          // Lưu mỗi 30 giây (background persist nên mất tối đa 30")
          if (seconds % 30 === 0) mergeAndSaveTimer();
        }, 1000);

        // Bước 2: load limits từ sync (có thể chậm hơn) — áp dụng khi sẵn sàng
        chrome.storage.sync.get([LIMITS_KEY], syncRes => {
          applyLimit((syncRes || {})[LIMITS_KEY] || {});
          timeEl.textContent = fmtDisplay();
          updateColor();
        });
      });
    });
  }

  // ─── Async lock check & start app ────────────────────────────
  // chrome.storage.local: Facebook JS không thể xóa, persist qua reload
  function startApp() {
    chrome.storage.local.get([LOCK_STORAGE_KEY], result => {
      const lock = result[LOCK_STORAGE_KEY];
      if (lock && lock.date === todayStr()) {
        showLockScreen();
        return;
      }
      clearTimeout(lockCheckFallback);
      lockCheckStyle.remove();
      if (startFB) startFB();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFloatingTimer);
      } else {
        initFloatingTimer();
      }
    });
  }

  // Xác định incognito: MV2/Firefox dùng chrome.extension.inIncognitoContext,
  // MV3 Chrome dùng message lên background (chrome.extension bị xóa)
  function detectIncognito(callback) {
    if (chrome.extension && typeof chrome.extension.inIncognitoContext !== 'undefined') {
      callback(!!chrome.extension.inIncognitoContext);
      return;
    }
    if (typeof chrome.runtime.sendMessage === 'function') {
      try {
        chrome.runtime.sendMessage({ type: 'getIncognito' }, response => {
          callback((response && response.incognito) || false);
        });
      } catch {
        callback(false);
      }
      return;
    }
    callback(false);
  }

  detectIncognito(incog => {
    isIncognito = incog;
    STORE_HOST   = isIncognito ? '__private__' : HOSTNAME;
    DISPLAY_NAME = isIncognito ? (chrome.i18n.getMessage('label_private') || 'Private') : DOMAIN;
    LOCK_STORAGE_KEY = 'ald_lock_' + STORE_HOST;
    startApp();
  });

})();
