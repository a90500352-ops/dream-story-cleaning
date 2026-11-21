/* ============================================================
   Dream Story 청소 일정 대시보드
   - data/schedule.json 만 갱신하면 화면이 다시 계산됩니다.
   - 화면(청소 카드·준비물·체크리스트)은 stays 데이터에서 자동 생성.
   ============================================================ */

(function () {
  'use strict';

  /* ---------------- 저장 키 ---------------- */
  const K_UNLOCK = 'dsClean.unlock.v1';
  const K_ROLE = 'dsClean.role.v1';
  const K_TAB = 'dsClean.tab.v1';
  const K_CHECK = 'dsClean.checks.v1.';

  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------------- 상태 ---------------- */
  let DATA = null;
  let INDEX = new Map();
  let TODAY = '';
  let ROLE = 'cleaner';
  let TAB = 'today';
  let CAL_SEL = null;
  let LOADED_AT = null;
  let IS_PREVIEW = false;
  let QUERY_DATE = null;
  let pinBuf = '';

  /* ---------------- 공통 유틸 ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- 날짜 (UTC 기준으로 하루 단위 계산) ---------------- */
  function parseISO(iso) {
    const p = String(iso).split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }
  function isoOf(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function addDays(iso, n) { return isoOf(parseISO(iso) + n * 86400000); }
  function diffDays(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function dowOf(iso) { return new Date(parseISO(iso)).getUTCDay(); }
  function monthOf(iso) { return iso.slice(0, 7); }
  function fmtMD(iso) {
    const d = new Date(parseISO(iso));
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }
  function fmtKoMD(iso) {
    const d = new Date(parseISO(iso));
    return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일';
  }
  function fmtKoMDW(iso) { return fmtKoMD(iso) + ' (' + DOW[dowOf(iso)] + ')'; }
  function nextMonth(ym) {
    const p = ym.split('-').map(Number);
    return p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + pad2(p[1] + 1);
  }
  function seoulToday() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const g = t => { const f = parts.filter(p => p.type === t)[0]; return f ? f.value : ''; };
    return g('year') + '-' + g('month') + '-' + g('day');
  }
  function nowHM() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const g = t => { const f = parts.filter(p => p.type === t)[0]; return f ? f.value : ''; };
    return g('hour') + ':' + g('minute');
  }

  /* ---------------- 시간 ---------------- */
  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function toHHMM(min) {
    const m = ((min % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }
  function durationLabel(start, end) {
    const a = toMin(start), b = toMin(end);
    if (a == null || b == null || b <= a) return '';
    const m = b - a, h = Math.floor(m / 60), mm = m % 60;
    return mm ? h + '시간 ' + mm + '분' : h + '시간';
  }

  /* ---------------- 업데이트 시각 표시 ---------------- */
  function stampShort(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr || '');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d);
    const g = t => { const f = parts.filter(p => p.type === t)[0]; return f ? f.value : ''; };
    return g('month') + '/' + g('day') + ' ' + g('hour') + ':' + g('minute');
  }
  function updatedLabel(isoStr) {
    const t = new Date(isoStr).getTime();
    if (isNaN(t)) return '';
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return '방금 전';
    if (min < 60) return min + '분 전';
    const hr = Math.round(min / 60);
    if (hr < 24) return hr + '시간 전';
    const day = Math.round(hr / 24);
    if (day < 8) return day + '일 전';
    return stampShort(isoStr) + ' 기준';
  }
  function oldestHours() {
    const t = new Date(DATA.meta.last_updated).getTime();
    if (isNaN(t)) return 0;
    return (Date.now() - t) / 3600000;
  }

  /* ---------------- 게스트 수 ---------------- */
  function totalGuests(s) {
    return (s.adults || 0) + (s.children || 0) + (s.infants || 0);
  }
  function careGuests(s) {
    return Math.max(1, (s.adults || 0) + (s.children || 0));
  }
  function guestMetaParts(s) {
    const parts = [];
    const who = [];
    if (s.adults) who.push('성인 ' + s.adults);
    if (s.children) who.push('어린이 ' + s.children);
    if (s.infants) who.push('유아 ' + s.infants);
    if (!who.length) who.push(totalGuests(s) + '명');
    parts.push(who.join(' · '));
    if (s.pets && s.pets.length) {
      parts.push(s.pets.map(function (p) { return p.type + ' ' + p.count + '마리'; }).join(' · '));
    }
    if (s.nights) parts.push(s.nights + '박');
    return parts;
  }

  /* ---------------- 데이터 인덱스 ---------------- */
  function buildIndex() {
    const map = new Map();
    function slot(iso) {
      if (!map.has(iso)) map.set(iso, { date: iso, checkins: [], checkouts: [], clean: null });
      return map.get(iso);
    }
    (DATA.stays || []).forEach(function (s) {
      if (s.checkin) slot(s.checkin).checkins.push(s);
      if (s.checkout) slot(s.checkout).checkouts.push(s);
    });
    map.forEach(function (day) {
      day.checkins.sort(function (a, b) { return String(a.checkin_time || '').localeCompare(String(b.checkin_time || '')); });
      if (day.checkouts.length) day.clean = buildCleaning(day);
    });
    return map;
  }

  function overridesFor(date) { return (DATA.cleanings && DATA.cleanings[date]) || {}; }

  function buildCleaning(day) {
    const ov = overridesFor(day.date);
    const base = DATA.meta.default_window || { start: '12:00', end: '15:00' };
    let start = (ov.window && ov.window.start) || base.start;
    let end = (ov.window && ov.window.end) || base.end;

    let early = null;
    day.checkins.forEach(function (s) {
      if (!s.early_checkin) return;
      const m = toMin(s.early_checkin);
      if (m == null) return;
      if (m < toMin(end) && (!early || m < early.min)) early = { min: m, time: toHHMM(m), guest: s.guest };
    });
    let reduced = false;
    if (early) {
      end = early.time;
      reduced = true;
    }

    const checkoutTime = (day.checkouts[0] && day.checkouts[0].checkout_time) || '12:00';
    const checkinTime = (day.checkins[0] && day.checkins[0].checkin_time) || '15:00';
    return {
      date: day.date,
      window: { start: start, end: end },
      checkoutTime: checkoutTime,
      checkinTime: checkinTime,
      reduced: reduced,
      early: early,
      duration: durationLabel(start, end)
    };
  }

  function cleaningWindowLabel(c) { return c.window.start + ' ~ ' + c.window.end; }

  function alertsFor(date) {
    return (DATA.alerts || [])
      .filter(function (a) { return a.date === date; })
      .sort(function (a, b) { return (a.level === 'urgent' ? 0 : 1) - (b.level === 'urgent' ? 0 : 1); });
  }

  function nextCleaning(afterDate) {
    return allDays()
      .filter(function (d) { return d.clean && d.date > afterDate; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0] || null;
  }

  function nextCheckin(afterDate) {
    return (DATA.stays || [])
      .filter(function (s) { return s.checkin && s.checkin > afterDate; })
      .sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; })[0] || null;
  }

  function vacantLabel(date) {
    const n = nextCheckin(date);
    return n ? '공실 · 다음 입실 ' + fmtMD(n.checkin) : '공실 · 다음 입실 미정';
  }
  function allDays() { return Array.from(INDEX.values()); }

  /* ---------------- 준비물 계산 ---------------- */
  function supplyPlan(stay) {
    if (!stay) return null;
    const r = DATA.supply_rules || {};
    const guests = careGuests(stay);
    const towels = guests * (r.towel_per_guest || 2) + (r.towel_extra || 2);
    const pillows = guests * (r.pillow_per_guest || 1) + (r.pillow_extra || 1);
    const rules = (r.bed_rules || []).slice().sort(function (a, b) { return a.guests_up_to - b.guests_up_to; });
    let beds = 1;
    for (let i = 0; i < rules.length; i++) {
      if (guests <= rules[i].guests_up_to) { beds = rules[i].beds; break; }
      beds = rules[i].beds;
    }
    const cap = (DATA.property && DATA.property.beds) || 4;
    beds = Math.min(beds, cap);
    const extras = [];
    if (guests >= (r.large_group_threshold || 6)) extras.push('이불 여분 1세트');
    if ((stay.infants || 0) > 0) (r.infant_items || []).forEach(function (t) { extras.push(t); });
    return { guests: guests, towels: towels, pillows: pillows, beds: beds, water: guests, extras: extras };
  }

  /* ---------------- 체크리스트 ---------------- */
  function buildChecklistGroups(day) {
    const t = DATA.checklist_templates || {};
    const groups = [];
    if (t.base) groups.push({ key: 'base', title: '기본 청소', items: t.base });

    const pets = day.checkouts.filter(function (s) { return s.pets && s.pets.length; });
    if (pets.length && t.pet) groups.push({ key: 'pet', title: '반려동물 퇴실 — 털·냄새 집중', items: t.pet });

    const infants = day.checkins.filter(function (s) { return (s.infants || 0) > 0; });
    if (infants.length && t.infant) groups.push({ key: 'infant', title: '유아 동반 — 안전·위생', items: t.infant });

    let maxG = 0;
    day.checkins.concat(day.checkouts).forEach(function (s) { maxG = Math.max(maxG, totalGuests(s)); });
    if (maxG >= ((DATA.supply_rules || {}).large_group_threshold || 6) && t.large) {
      groups.push({ key: 'large', title: '대인원 세팅 (' + maxG + '인)', items: t.large });
    }

    const ov = overridesFor(day.date);
    if (ov.weather && ov.weather.rain && t.rain) groups.push({ key: 'rain', title: '비 예보 — 물기·미끄럼', items: t.rain });

    return groups;
  }

  function loadChecks(date) {
    try { return JSON.parse(localStorage.getItem(K_CHECK + date) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveChecks(date, obj) {
    try { localStorage.setItem(K_CHECK + date, JSON.stringify(obj)); } catch (e) { /* 저장 불가 */ }
  }

  /* ============================================================
     화면 그리기
     ============================================================ */

  function render() {
    if (!DATA) return;
    $('#app').hidden = false;
    $('#lock').hidden = true;
    applyRole();
    applyTab();
    renderSummary();
    renderToday();
    renderUpcoming();
    renderAll();
  }

  function applyRole() {
    $$('.role-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-role') === ROLE);
      b.setAttribute('aria-pressed', b.getAttribute('data-role') === ROLE ? 'true' : 'false');
    });
  }

  function applyTab() {
    ['today', 'upcoming', 'all'].forEach(function (t) {
      $('#tab-' + t).hidden = (t !== TAB);
      const nav = $('#nav-' + t);
      if (nav) {
        nav.classList.toggle('is-on', t === TAB);
        nav.setAttribute('aria-current', t === TAB ? 'page' : 'false');
      }
    });
  }

  /* ---------------- 상단 요약 ---------------- */
  function renderSummary() {
    const day = INDEX.get(TODAY);
    const clean = day && day.clean;
    const alerts = alertsFor(TODAY);
    const chips = day ? dayBadgesHTML(day, { alertChip: false }) : '';
    const stale = oldestHours() > 24;

    let status;
    if (clean) {
      status =
        '<div class="summary-status">' +
          '<div class="summary-status-label">오늘 청소</div>' +
          '<div class="summary-window">' +
            '<span class="summary-time">' + esc(cleaningWindowLabel(clean)) + '</span>' +
            '<span class="summary-hours">' + esc(clean.duration) + '</span>' +
          '</div>' +
        '</div>';
    } else {
      const next = nextCleaning(TODAY);
      status =
        '<div class="summary-status">' +
          '<div class="summary-status-label">오늘 청소</div>' +
          '<div class="summary-none">없음</div>' +
          (next ? '<div class="summary-next">다음 청소 ' + esc(fmtKoMDW(next.date)) + ' ' +
            esc(next.clean.window.start + ' ~ ' + next.clean.window.end) + '</div>' : '') +
        '</div>';
    }

    let extra = '';
    alerts.forEach(function (a) {
      extra += alertHTML(a);
    });
    if (stale) {
      extra += '<div class="alert alert-info"><span class="alert-ico" aria-hidden="true">🕒</span><div>' +
        '<div class="alert-title">일정 데이터가 오래됐어요</div>' +
        '<div class="alert-body">마지막 업데이트가 ' + esc(updatedLabel(DATA.meta.last_updated)) +
        '입니다. 새 예약·변경은 호스트에게 확인해 주세요.</div></div></div>';
    }
    if (IS_PREVIEW) {
      extra += '<div class="alert alert-info"><span class="alert-ico" aria-hidden="true">👀</span><div>' +
        '<div class="alert-title">미리보기 날짜</div>' +
        '<div class="alert-body">' + esc(fmtKoMDW(TODAY)) + ' 기준으로 보고 있습니다.</div></div></div>';
    }

    $('#summary').innerHTML =
      '<div class="summary">' +
        '<div class="summary-top">' +
          '<div><span class="summary-date">' + esc(fmtKoMD(TODAY)) + '</span>' +
          '<span class="summary-weekday">(' + DOW[dowOf(TODAY)] + ')</span></div>' +
          '<div class="summary-updated">' + esc(stampShort(DATA.meta.last_updated)) + '<br>' +
          esc(updatedLabel(DATA.meta.last_updated)) + '</div>' +
        '</div>' +
        status +
        extra +
        '<div class="summary-badges">' + chips + '</div>' +
      '</div>';
  }

  function alertHTML(a) {
    const urgent = a.level === 'urgent';
    return '<div class="alert ' + (urgent ? 'alert-urgent' : 'alert-info') + '">' +
      '<span class="alert-ico" aria-hidden="true">' + (urgent ? '⚠️' : 'ℹ️') + '</span>' +
      '<div><div class="alert-title">' + esc(a.title || '확인 사항') + '</div>' +
      '<div class="alert-body">' + esc(a.body || '') + '</div></div></div>';
  }

  function dayBadgesHTML(day, opts) {
    opts = opts || {};
    const out = [];
    const hasPet = day.checkouts.some(function (s) { return s.pets && s.pets.length; });
    const hasInfant = day.checkins.some(function (s) { return (s.infants || 0) > 0; });
    const early = day.checkins.filter(function (s) { return s.early_checkin; })[0];
    let maxG = 0;
    const setupBase = day.checkins.length ? day.checkins : day.checkouts;
    setupBase.forEach(function (s) { maxG = Math.max(maxG, totalGuests(s)); });

    if (hasPet) out.push('<span class="tag tag-pet">🐾 반려동물 퇴실</span>');
    if (hasInfant) out.push('<span class="tag tag-baby">👶 유아 동반</span>');
    if (early && !opts.skipEarly) out.push('<span class="tag tag-early">⏰ 조기 체크인 ' + esc(early.early_checkin) + '</span>');    if (maxG >= 6) out.push('<span class="tag tag-large">👥 ' + maxG + '인</span>');
    if (!day.checkins.length) out.push('<span class="tag tag-ok">공실 — 시간 여유</span>');
    const n = alertsFor(day.date).length;
    if (n && opts.alertChip !== false) out.push('<span class="tag tag-urgent">⚠️ 확인 ' + n + '건</span>');
    return out.join('');
  }

  /* ---------------- 오늘 탭 ---------------- */
  function renderToday() {
    const day = INDEX.get(TODAY);
    let html = '';

    if (day && day.clean) {
      html += cleaningCardHTML(day, { isToday: true, showChecklist: true });
    } else {
      html += emptyTodayHTML(day);
    }

    if (ROLE === 'host') html += hostDataPanelHTML();

    html += '<p class="foot-note">마지막 업데이트 <b>' + esc(stampShort(DATA.meta.last_updated)) + '</b>' +
      ' · 데이터 <b>data/schedule.json</b><br>일정이 맞지 않으면 호스트에게 알려 주세요.</p>';

    $('#todayBody').innerHTML = html;
    updateAllProgress();
  }

  function emptyTodayHTML(day) {
    const ins = day ? day.checkins : [];
    const next = nextCleaning(TODAY);
    let body = '';
    if (ins.length) {
      body = ins.map(function (s) {
        return '오늘 ' + esc(s.checkin_time || '15:00') + ' 입실 — <b>' + esc(s.guest) + '</b> (' +
          esc(guestMetaParts(s).join(' · ')) + ')';
      }).join('<br>');
    } else {
      body = '오늘은 입·퇴실 일정이 없습니다.';
    }
    if (next) {
      body += '<br>다음 청소는 <b>' + esc(fmtKoMDW(next.date)) + ' ' +
        esc(next.clean.window.start + ' ~ ' + next.clean.window.end) + '</b>';
    }
    return '<div class="empty-card">' +
      '<div class="empty-emoji" aria-hidden="true">☕</div>' +
      '<div class="empty-title">오늘은 청소가 없어요</div>' +
      '<div class="empty-body">' + body + '</div>' +
      '</div>';
  }

  /* ---------------- 청소 카드 ---------------- */
  function cleaningCardHTML(day, opts) {
    opts = opts || {};
    const c = day.clean;
    const ov = overridesFor(day.date);

    const head =
      '<div class="card-head">' +
        '<div class="card-head-row">' +
          '<div class="card-date">' + esc(fmtKoMDW(day.date)) +
            (opts.isToday ? '<span class="today-tag">오늘</span>' : '') + '</div>' +
        '</div>' +
        '<div class="card-window' + (c.reduced ? ' reduced' : '') + '">' +
          '<span aria-hidden="true">⏰</span>' +
          '<strong>' + esc(cleaningWindowLabel(c)) + '</strong>' +
          '<span class="win-tag">' + esc(c.duration) + '</span>' +
        '</div>' +
        (c.reduced ? '<div class="card-window reduced"><span>⚡</span><span class="win-tag">조기 체크인 ' +
          esc(c.early ? c.early.time : '') + ' — 시간 단축</span></div>' : '') +
        '<div class="card-badges">' + dayBadgesHTML(day, { skipEarly: c.reduced }) + '</div>' +
      '</div>';

    return '<article class="cleaning-card">' + head +
      outSectionHTML(day, c, opts) +
      inSectionHTML(day, c, opts) +
      supplySectionHTML(day) +
      notesSectionHTML(day, { includeAlerts: !opts.isToday }) +
      (opts.showChecklist ? checklistSectionHTML(day) : '') +
      '</article>';
  }

  function guestBlockHTML(s, kind) {
    const meta = guestMetaParts(s).join(' · ');
    let callout = '';

    if (kind === 'out' && s.pets && s.pets.length) {
      const kinds = s.pets.map(function (p) { return p.type; }).join('·');
      callout =
        '<div class="pet-callout"><span aria-hidden="true">🐾</span><div>' +
          '<div class="pc-title">' + esc(kinds) + ' 퇴실 — 털 제거 집중</div>' +
          '<div class="pc-body">소파·침구는 돌돌이로, 커튼·러그까지 털을 제거하고 30분 이상 환기해 주세요. ' +
          '털이 남으면 다음 게스트가 바로 알아챕니다.</div>' +
        '</div></div>';
    }
    if (kind === 'in' && (s.infants || 0) > 0) {
      callout =
        '<div class="baby-callout"><span aria-hidden="true">👶</span><div>' +
          '<div class="pc-title">유아 ' + s.infants + '명 동반 — 안전 확인</div>' +
          '<div class="pc-body">바닥은 기어다니는 높이까지 닦고, 콘센트 커버·모서리 보호대·위험한 물건 위치를 ' +
          '확인해 주세요.</div>' +
        '</div></div>';
    }

    const early = kind === 'in' && s.early_checkin
      ? '<div class="guest-sub">조기 체크인 ' + esc(s.early_checkin) + ' 약속</div>' : '';

    return '<div class="guest-block">' +
      '<div class="guest"><span class="guest-name">' + esc(s.guest) + '</span>' +
      '<span class="guest-meta">' + esc(meta) + '</span></div>' +
      early + callout +
      '</div>';
  }

  function outSectionHTML(day, c) {
    if (!day.checkouts.length) return '';
    return '<div class="card-section">' +
      '<div class="section-head">' +
        '<div class="section-title out"><span class="dot"></span>퇴실</div>' +
        '<span class="section-time">' + esc(c.checkoutTime) + '</span>' +
      '</div>' +
      day.checkouts.map(function (s) { return guestBlockHTML(s, 'out'); }).join('') +
      '</div>';
  }

  function inSectionHTML(day, c) {
    if (!day.checkins.length) {
      const nextIn = nextCheckin(day.date);
      return '<div class="card-section">' +
        '<div class="section-head">' +
          '<div class="section-title in"><span class="dot"></span>다음 입실</div>' +
        '</div>' +
        '<div class="guest-empty">이 날은 다음 입실이 없습니다. 시간 여유가 있으니 침구 건조·욕실 곰팡이까지 점검해 주세요.' +
        (nextIn ? '<br>다음 입실은 ' + esc(fmtKoMDW(nextIn.checkin)) + ' ' + esc(nextIn.checkin_time || '15:00') +
          ' — ' + esc(nextIn.guest) + ' ' + totalGuests(nextIn) + '명' : '') +
        '</div></div>';
    }
    return '<div class="card-section">' +
      '<div class="section-head">' +
        '<div class="section-title in"><span class="dot"></span>다음 입실</div>' +
        '<span class="section-time">' + esc(c.checkinTime) + '</span>' +
      '</div>' +
      day.checkins.map(function (s) { return guestBlockHTML(s, 'in'); }).join('') +
      '</div>';
  }

  function supplySectionHTML(day) {
    const mainIn = day.checkins.slice().sort(function (a, b) { return totalGuests(b) - totalGuests(a); })[0];
    if (!mainIn) {
      return '<div class="card-section">' +
        '<div class="section-head"><div class="section-title supply"><span class="dot"></span>준비물 · 침구</div></div>' +
        '<div class="guest-empty">입실 팀이 없어 인원 기준 세팅은 필요 없습니다. 세탁한 침구는 말려서 보관해 주세요.</div>' +
        '</div>';
    }
    const p = supplyPlan(mainIn);
    const items = [
      { num: p.towels, unit: '장', label: '수건' },
      { num: p.pillows, unit: '개', label: '베개' },
      { num: p.beds, unit: '세트', label: '침구' },
      { num: p.water, unit: '병', label: '생수' }
    ];

    let html = '<div class="card-section">' +
      '<div class="section-head">' +
        '<div class="section-title supply"><span class="dot"></span>준비물 · 침구</div>' +
        '<span class="section-time">' + esc(mainIn.guest) + ' ' + p.guests + '인 기준</span>' +
      '</div>' +
      '<div class="supply-grid">' +
      items.map(function (it) {
        return '<div class="supply-item"><span class="supply-num">' + it.num +
          '<small>' + it.unit + '</small></span><span class="supply-label">' + it.label + '</span></div>';
      }).join('') +
      '</div>';

    if (p.extras.length) {
      html += '<ul class="supply-extra">' +
        p.extras.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    }
    html += '</div>';
    return html;
  }

  function notesSectionHTML(day, opts) {
    opts = opts || {};
    const ov = overridesFor(day.date);
    const items = [];

    if (opts.includeAlerts) {
      alertsFor(day.date).forEach(function (a) {
        items.push({ kind: 'alert', text: a.title + ' — ' + (a.body || '') });
      });
    }
    if (ov.weather && ov.weather.summary) {
      items.push({ kind: 'weather', text: '☔ ' + ov.weather.summary + ' 예보 — 현관 매트·바닥 물기 확인' });
    }
    (ov.notes || []).forEach(function (t) { items.push({ kind: 'note', text: t }); });

    const many = (day.checkouts.length + day.checkins.length) > 1;
    day.checkouts.concat(day.checkins).forEach(function (s) {
      (s.ops_notes || []).forEach(function (t) {
        items.push({ kind: 'note', text: many ? s.guest + ' · ' + t : t });
      });
    });

    const seen = {};
    const uniq = items.filter(function (it) {
      if (seen[it.text]) return false;
      seen[it.text] = true;
      return true;
    });

    if (!uniq.length && ROLE !== 'host') return '';

    let html = '<div class="card-section">' +
      '<div class="section-head"><div class="section-title note"><span class="dot"></span>특이사항</div></div>';

    if (uniq.length) {
      html += '<ul class="note-list' + (opts.includeAlerts ? ' alert-list' : '') + '">' +
        uniq.map(function (it) { return '<li>' + esc(it.text) + '</li>'; }).join('') + '</ul>';
    } else {
      html += '<div class="guest-empty">전달할 특이사항이 없습니다.</div>';
    }

    if (ROLE === 'host') {
      day.checkouts.concat(day.checkins).forEach(function (s) {
        if (!s.id && !(s.host_notes && s.host_notes.length)) return;
        html += '<div class="host-note"><b>' + esc(s.guest) + '</b>' +
          (s.id ? ' · ' + esc(s.id) : '') +
          (s.host_notes && s.host_notes.length ? '<br>' + s.host_notes.map(esc).join(' · ') : '') +
          '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function checklistSectionHTML(day) {
    const groups = buildChecklistGroups(day);
    const state = loadChecks(day.date);
    let total = 0, done = 0;

    const body = groups.map(function (g) {
      const items = g.items.map(function (item) {
        total++;
        const isDone = !!state[item.id];
        if (isDone) done++;
        return '<button type="button" class="check-item' + (isDone ? ' done' : '') + '"' +
          ' data-date="' + esc(day.date) + '" data-id="' + esc(item.id) + '"' +
          ' aria-pressed="' + (isDone ? 'true' : 'false') + '">' +
          '<span class="check-box" aria-hidden="true">✓</span>' +
          '<span class="check-text"><span class="check-label">' + esc(item.label) + '</span>' +
          (item.hint ? '<span class="check-hint">' + esc(item.hint) + '</span>' : '') +
          '</span></button>';
      }).join('');
      return '<div class="check-group-title">' + esc(g.title) + '</div>' + items;
    }).join('');

    const pct = total ? Math.round(done / total * 100) : 0;

    return '<div class="card-section">' +
      '<div class="section-head">' +
        '<div class="section-title check"><span class="dot"></span>청소 체크리스트</div>' +
        (ROLE === 'host' ? '<button type="button" class="mini-btn" data-reset="' + esc(day.date) + '">초기화</button>' : '') +
      '</div>' +
      '<div class="progress-wrap" data-date="' + esc(day.date) + '">' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="progress-text">' + done + '/' + total + '</span>' +
      '</div>' +
      body +
      '</div>';
  }

  function updateAllProgress() {
    $$('.progress-wrap').forEach(function (wrap) {
      updateProgress(wrap.getAttribute('data-date'));
    });
  }

  function updateProgress(date) {
    if (!date) return;
    const items = $$('.check-item[data-date="' + date + '"]');
    const done = items.filter(function (b) { return b.classList.contains('done'); }).length;
    $$('.progress-wrap[data-date="' + date + '"]').forEach(function (w) {
      const fill = $('.progress-fill', w);
      const text = $('.progress-text', w);
      if (fill) fill.style.width = (items.length ? Math.round(done / items.length * 100) : 0) + '%';
      if (text) text.textContent = done + '/' + items.length;
    });
  }

  function toggleCheck(btn) {
    const date = btn.getAttribute('data-date');
    const id = btn.getAttribute('data-id');
    const state = loadChecks(date);
    if (state[id]) delete state[id];
    else state[id] = true;
    saveChecks(date, state);
    btn.classList.toggle('done', !!state[id]);
    btn.setAttribute('aria-pressed', state[id] ? 'true' : 'false');
    updateProgress(date);
  }

  /* ---------------- 다가오는 탭 ---------------- */
  function renderUpcoming() {
    const limit = addDays(TODAY, 14);
    const cleanDays = allDays()
      .filter(function (d) { return d.clean && d.date > TODAY && d.date <= limit; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    let html = '';

    if (!cleanDays.length) {
      html += '<div class="empty-card"><div class="empty-emoji" aria-hidden="true">🗓</div>' +
        '<div class="empty-title">2주 안에 청소가 없어요</div>' +
        '<div class="empty-body">아래 <b>전체 일정</b>에서 이후 일정을 확인할 수 있습니다.</div></div>';
    } else {
      html += cleanDays.map(function (d) { return upcomingItemHTML(d); }).join('');
    }

    const inOnly = allDays()
      .filter(function (d) { return !d.clean && d.checkins.length && d.date > TODAY && d.date <= limit; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    if (inOnly.length) {
      html += inOnly.map(function (d) {
        return '<div class="notice-line">🔑 <b>' + esc(fmtKoMDW(d.date)) + '</b> — 청소 없이 입실만 있습니다. ' +
          d.checkins.map(function (s) { return esc(s.guest) + ' ' + esc(s.checkin_time || '15:00'); }).join(', ') +
          '</div>';
      }).join('');
    }

    html += '<div class="notice-line">카드를 누르면 준비물과 특이사항이 펼쳐집니다. 체크리스트는 청소 당일 <b>오늘</b> 화면에서 사용하세요.</div>';
    $('#upcomingBody').innerHTML = html;
  }

  function upcomingItemHTML(day) {    const c = day.clean;
    const outNames = day.checkouts.map(function (s) { return s.guest + '(' + totalGuests(s) + '명)'; }).join(', ');
    const inNames = day.checkins.length
      ? day.checkins.map(function (s) { return s.guest + '(' + totalGuests(s) + '명)'; }).join(', ')
      : '';
    const n = diffDays(TODAY, day.date);
    const dday = n === 1 ? '내일' : n === 2 ? '모레' : 'D-' + n;

    const mainIn = day.checkins.slice().sort(function (a, b) { return totalGuests(b) - totalGuests(a); })[0];
    const p = supplyPlan(mainIn);

    let detail = '<div class="up-detail">';
    detail += '<div class="up-main" style="margin-top:0">청소 ' + esc(cleaningWindowLabel(c)) + ' · ' + esc(c.duration) + '</div>';
    if (p) {
      detail += '<div class="supply-grid" style="margin-top:10px">' +
        '<div class="supply-item"><span class="supply-num">' + p.towels + '<small>장</small></span><span class="supply-label">수건</span></div>' +
        '<div class="supply-item"><span class="supply-num">' + p.pillows + '<small>개</small></span><span class="supply-label">베개</span></div>' +
        '<div class="supply-item"><span class="supply-num">' + p.beds + '<small>세트</small></span><span class="supply-label">침구</span></div>' +
        '<div class="supply-item"><span class="supply-num">' + p.water + '<small>병</small></span><span class="supply-label">생수</span></div>' +
        '</div>';
    }
    const ov = overridesFor(day.date);
    const notes = [];
    if (ov.weather && ov.weather.summary) notes.push('☔ ' + ov.weather.summary + ' 예보');
    (ov.notes || []).forEach(function (t) { notes.push(t); });
    day.checkins.concat(day.checkouts).forEach(function (s) {
      (s.ops_notes || []).forEach(function (t) { notes.push(s.guest + ' · ' + t); });
    });
    if (notes.length) {
      detail += '<ul class="note-list" style="margin-top:10px">' +
        notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    }
    detail += '</div>';

    return '<details class="upcoming-item">' +
      '<summary>' +
        '<div class="up-row"><span class="up-date">' + esc(fmtKoMDW(day.date)) + '</span>' +
        '<span class="up-dday">' + dday + '</span></div>' +
        '<div class="up-main">' + (day.checkins.length
          ? '퇴실 ' + esc(outNames) + ' <span class="arrow">→</span> 입실 ' + esc(inNames)
          : '퇴실 ' + esc(outNames) + ' <span class="arrow">→</span> ' + esc(vacantLabel(day.date))) + '</div>' +
        '<div class="up-badges">' + dayBadgesHTML(day) + '</div>' +
        '<div class="up-window">' + esc(cleaningWindowLabel(c)) + ' · ' + esc(c.duration) + '</div>' +
      '</summary>' +
      detail +
      '</details>';
  }

  /* ---------------- 전체 일정 탭 ---------------- */
  function renderAll() {
    renderCalendar();
    renderStays();
    renderPending();
  }

  function renderCalendar() {
    const box = $('#calendarBody');
    if (!box) return;

    let end = monthOf(TODAY);
    DATA.stays.forEach(function (s) {
      [s.checkin, s.checkout].forEach(function (v) {
        if (v && monthOf(v) > end) end = monthOf(v);
      });
    });
    const months = [];
    let cur = monthOf(TODAY);
    for (let i = 0; i < 4 && cur <= end; i++) {
      months.push(cur);
      cur = nextMonth(cur);
    }

    if (!CAL_SEL) CAL_SEL = TODAY;

    let html = months.map(monthHTML).join('');
    html += '<div class="cal-legend">' +
      '<span><i class="legend-in"></i>입실</span>' +
      '<span><i class="legend-out"></i>퇴실</span>' +
      '<span><i class="legend-clean"></i>청소</span>' +
      '</div>';
    html += dayDetailHTML(CAL_SEL);
    box.innerHTML = html;
  }

  function monthHTML(ym) {
    const p = ym.split('-').map(Number);
    const y = p[0], m = p[1];
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell blank"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = y + '-' + pad2(m) + '-' + pad2(d);
      const day = INDEX.get(iso);
      const dow = dowOf(iso);
      const cls = ['cal-cell'];
      if (iso === TODAY) cls.push('today');
      if (iso === CAL_SEL) cls.push('selected');
      if (dow === 0) cls.push('sun');
      if (dow === 6) cls.push('sat');

      let marks = '';
      if (day) {
        if (day.checkins.length) marks += '<span class="cal-mark m-in">입</span>';
        if (day.checkouts.length) marks += '<span class="cal-mark m-out">퇴</span>';
        if (day.clean) marks += '<span class="cal-mark m-clean">청</span>';
      }

      cells += '<button type="button" class="' + cls.join(' ') + '" data-cal="' + iso + '"' +
        ' aria-label="' + esc(fmtKoMDW(iso)) + '">' +
        '<span class="cal-daynum">' + d + '</span>' +
        (marks ? '<span class="cal-marks">' + marks + '</span>' : '') +
        '</button>';
    }

    return '<div class="cal-month">' +
      '<div class="cal-month-title">' + y + '년 ' + m + '월</div>' +
      '<div class="cal-grid">' +
        DOW.map(function (w, i) {
          return '<div class="cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>';
        }).join('') +
        cells +
      '</div></div>';
  }

  function dayDetailHTML(iso) {
    const day = INDEX.get(iso);
    const lines = [];

    if (day && day.clean) {
      lines.push('🧹 청소 ' + esc(cleaningWindowLabel(day.clean)) + ' (' + esc(day.clean.duration) + ')');
    }
    if (day) {
      day.checkouts.forEach(function (s) {
        lines.push('🚪 퇴실 ' + esc(s.checkout_time || '12:00') + ' — ' + esc(s.guest) +
          ' (' + esc(guestMetaParts(s).join(' · ')) + ')');
      });
      day.checkins.forEach(function (s) {
        lines.push('🔑 입실 ' + esc(s.checkin_time || '15:00') + ' — ' + esc(s.guest) +
          ' (' + esc(guestMetaParts(s).join(' · ')) + ')');
      });
    }

    return '<div class="day-detail">' +
      '<div class="day-detail-title">' + esc(fmtKoMDW(iso)) + '</div>' +
      (lines.length
        ? '<ul>' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>'
        : '<div class="muted" style="margin-top:6px">이 날은 일정이 없습니다.</div>') +
      '</div>';
  }

  function renderStays() {
    const box = $('#staysBody');
    if (!box) return;
    const stays = (DATA.stays || []).slice().sort(function (a, b) {
      return String(a.checkin).localeCompare(String(b.checkin));
    });

    const byMonth = {};
    stays.forEach(function (s) {
      const m = monthOf(s.checkin);
      (byMonth[m] = byMonth[m] || []).push(s);
    });

    let html = '';
    Object.keys(byMonth).sort().forEach(function (m) {
      const p = m.split('-').map(Number);
      html += '<div class="stay-month-title">' + p[0] + '년 ' + p[1] + '월</div>';
      byMonth[m].forEach(function (s) {
        const range = fmtMD(s.checkin) + ' ~ ' + (s.checkout ? fmtMD(s.checkout) : '미정');
        const metaBits = [];
        metaBits.push(totalGuests(s) + '명');
        if (s.pets && s.pets.length) metaBits.push('🐾');
        if (s.nights) metaBits.push(s.nights + '박');
        html += '<div class="stay-row">' +
          '<span class="stay-dates">' + esc(range) + '</span>' +
          '<span class="stay-name">' + esc(s.guest) + '</span>' +
          '<span class="stay-meta">' + esc(metaBits.join(' · ')) + '</span>' +
          '</div>';
      });
    });
    box.innerHTML = html || '<div class="notice-line">등록된 예약이 없습니다.</div>';
  }

  function renderPending() {
    const box = $('#pendingBody');
    if (!box) return;
    const list = DATA.pending || [];
    let html = '';

    if (!list.length) {
      html = '<div class="notice-line">대기 중인 문의가 없습니다.</div>';
    } else {
      html = list.map(function (p) {
        return '<div class="pending-card">' +
          '<div class="pending-title"><span aria-hidden="true">⏳</span>' +
          esc(p.guest) + ' · ' + esc(p.guests) + '명 · ' + esc(fmtMD(p.checkin)) + '~' + esc(fmtMD(p.checkout)) + '</div>' +
          '<div class="pending-body"><b>' + esc(p.status) + '</b> — ' + esc(p.note) + '</div>' +
          '</div>';
      }).join('');
    }

    if (ROLE === 'host') html += hostDataPanelHTML();
    box.innerHTML = html;
  }

  function hostDataPanelHTML() {
    const stays = (DATA.stays || []).length;
    const remain = allDays().filter(function (d) { return d.clean && d.date >= TODAY; }).length;
    return '<div class="host-panel">' +
      '<h3>데이터 상태</h3>' +
      '<div class="host-kv"><span>마지막 업데이트</span><b>' + esc(stampShort(DATA.meta.last_updated)) + '</b></div>' +
      '<div class="host-kv"><span>업데이트 경과</span><b>' + esc(updatedLabel(DATA.meta.last_updated)) + '</b></div>' +
      '<div class="host-kv"><span>화면을 연 시각</span><b>' + esc(nowHM()) + '</b></div>' +
      '<div class="host-kv"><span>확정 예약</span><b>' + stays + '건</b></div>' +
      '<div class="host-kv"><span>남은 청소</span><b>' + remain + '건</b></div>' +
      '<div class="host-kv"><span>데이터 파일</span><b>data/schedule.json</b></div>' +
      '<div class="host-kv"><span>스키마</span><b>v' + esc(DATA.schema_version || 1) + '</b></div>' +
      '<p class="host-note">일정 변경은 <b>data/schedule.json</b>의 stays만 고쳐 저장(push)하면 됩니다. ' +
      '청소 카드·준비물·체크리스트는 자동으로 다시 계산됩니다. 업데이트 시각(meta.last_updated)도 함께 바꿔 주세요.</p>' +
      '</div>';
  }

  /* ============================================================
     잠금 화면
     ============================================================ */

  function hashPin(pin) {
    const str = 'ds' + String(pin);
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return 'v1_' + h.toString(36);
  }

  function paintDots() {
    $$('#pinDots span').forEach(function (s, i) {
      s.classList.toggle('filled', i < pinBuf.length);
    });
  }

  function showLock() {
    $('#app').hidden = true;
    $('#lock').hidden = false;
    pinBuf = '';
    paintDots();
    const err = $('#pinError');
    if (err) err.textContent = '';
  }

  function checkPin() {
    const pin = String((DATA.meta && DATA.meta.pin) || '1470');
    if (pinBuf === pin) {
      try { localStorage.setItem(K_UNLOCK, hashPin(pin)); } catch (e) { /* noop */ }
      pinBuf = '';
      paintDots();
      render();
      window.scrollTo(0, 0);
    } else {
      const err = $('#pinError');
      if (err) {
        err.textContent = '비밀번호가 맞지 않아요. 다시 입력해 주세요.';
        err.classList.add('shake');
        setTimeout(function () { err.classList.remove('shake'); }, 320);
      }
      setTimeout(function () { pinBuf = ''; paintDots(); }, 260);
    }
  }

  function paintLockRoles() {
    $$('.lock-role').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-lock-role') === ROLE);
    });
  }

  function initLock() {
    const hint = $('#pinHint');
    if (hint) hint.textContent = '힌트: ' + ((DATA.meta && DATA.meta.pin_hint) || '호스트에게 문의');

    paintLockRoles();
    $$('.lock-role').forEach(function (b) {
      b.addEventListener('click', function () {
        ROLE = b.getAttribute('data-lock-role');
        try { localStorage.setItem(K_ROLE, ROLE); } catch (e) { /* noop */ }
        paintLockRoles();
      });
    });

    let stored = null;
    try { stored = localStorage.getItem(K_UNLOCK); } catch (e) { /* noop */ }
    if (stored && stored === hashPin(String((DATA.meta && DATA.meta.pin) || '1470'))) {
      render();
    } else {
      showLock();
    }

    const keypad = $('#keypad');
    if (keypad) {
      keypad.addEventListener('click', function (e) {
        const b = e.target.closest('button[data-key]');
        if (!b) return;
        const k = b.getAttribute('data-key');
        if (k === 'del') pinBuf = pinBuf.slice(0, -1);
        else if (pinBuf.length < 4) pinBuf += k;
        paintDots();
        if (pinBuf.length === 4) setTimeout(checkPin, 90);
      });
    }

    document.addEventListener('keydown', function (e) {
      if ($('#lock').hidden) return;
      if (/^[0-9]$/.test(e.key)) {
        if (pinBuf.length < 4) pinBuf += e.key;
        paintDots();
        if (pinBuf.length === 4) setTimeout(checkPin, 90);
      } else if (e.key === 'Backspace') {
        pinBuf = pinBuf.slice(0, -1);
        paintDots();
      }
    });
  }

  /* ============================================================
     이벤트
     ============================================================ */

  function bindEvents() {
    document.addEventListener('click', function (e) {
      const chk = e.target.closest('.check-item');
      if (chk) { toggleCheck(chk); return; }

      const reset = e.target.closest('[data-reset]');
      if (reset) {
        const date = reset.getAttribute('data-reset');
        if (window.confirm(fmtKoMD(date) + ' 체크리스트를 모두 지울까요?')) {
          saveChecks(date, {});
          renderToday();
          if (TAB !== 'today') renderToday();
        }
        return;
      }

      const roleBtn = e.target.closest('.role-btn');
      if (roleBtn) {
        ROLE = roleBtn.getAttribute('data-role');
        try { localStorage.setItem(K_ROLE, ROLE); } catch (err) { /* noop */ }
        render();
        return;
      }

      const navBtn = e.target.closest('.nav-btn');
      if (navBtn) {
        TAB = navBtn.getAttribute('data-tab');
        try { localStorage.setItem(K_TAB, TAB); } catch (err) { /* noop */ }
        applyTab();
        window.scrollTo(0, 0);
        return;
      }

      const cal = e.target.closest('[data-cal]');
      if (cal) {
        CAL_SEL = cal.getAttribute('data-cal');
        renderCalendar();
        return;
      }
    });

    const lockBtn = $('#lockBtn');
    if (lockBtn) {
      lockBtn.addEventListener('click', function () {
        try { localStorage.removeItem(K_UNLOCK); } catch (e) { /* noop */ }
        showLock();
        window.scrollTo(0, 0);
      });
    }

    const retry = $('#retryBtn');
    if (retry) {
      retry.addEventListener('click', function () {
        $('#bootError').hidden = true;
        boot();
      });
    }
  }

  /* ============================================================
     시작
     ============================================================ */

  async function boot() {
    try {
      const res = await fetch('data/schedule.json?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      DATA = await res.json();
      LOADED_AT = new Date();

      const params = new URLSearchParams(window.location.search);
      const qd = params.get('date');
      QUERY_DATE = (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd)) ? qd : null;
      TODAY = QUERY_DATE || seoulToday();
      IS_PREVIEW = !!QUERY_DATE && QUERY_DATE !== seoulToday();

      INDEX = buildIndex();

      try {
        const savedRole = localStorage.getItem(K_ROLE);
        if (savedRole === 'host' || savedRole === 'cleaner') ROLE = savedRole;
        const savedTab = localStorage.getItem(K_TAB);
        if (savedTab === 'today' || savedTab === 'upcoming' || savedTab === 'all') TAB = savedTab;
      } catch (e) { /* noop */ }

      initLock();
      bindEvents();
    } catch (err) {
      if (window.console) console.error('[Dream Story] 일정을 불러오지 못했습니다.', err);
      $('#bootError').hidden = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
