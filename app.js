/* 习惯花园 v3 —— 核心逻辑
   规则要点：
   · 打卡日以凌晨 5 点为界，一个打卡日只能打一次卡；打卡 = 满状态照料植物
   · 漏 1 个计划日即枯萎；连打卡 7 天完全复活；复活期间再漏打则进度清零
   · 连续枯萎 3 次 → 植株永久死亡移除（习惯保留，可补种）
   · 状态值按「计划日」衰减：非计划日不会掉状态，周末型习惯工作日不会假死
   · 满 7 次奖励与满绽奖励均为一次性（单调计数），取消打卡不会重复发放
   · 9×9 花园地图，一株一株手动安放；地图满了自动开辟新地图
*/
(() => {
  "use strict";

  const STORE_KEY = "habitGarden.v3";
  const OLD_KEY = "habitGarden.v2";
  const MAP_SIZE = 9;
  const CELLS = MAP_SIZE * MAP_SIZE;

  const RULES = {
    dewPerCheckIn: 2,
    streakBonusEvery: 7,
    streakBonusDew: 10,
    bloomBonusDew: 30,
    reviveTimes: 7,        // 枯萎后需要「连续照料 7 次」才能复活（按次，不按天）
    medalEvery: 30,        // 每满 30 次打卡的额外大奖
    medalDew: 50,
    archiveDays: 30,       // 归档后多少天内可以「翻案」
    streakPerDew: 5,       // 收获时每 10 天连击折算的花露
    streakPerDays: 10,
    deathAfterWilts: 3,
    // 每错过一个「计划日」的状态衰减（非计划日不衰减）
    decayWater: 70,
    decayFert: 45,
    growPest: 18,
    buyConfirmFrom: 30, // 花露 ≥ 该值的购买需二次确认
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const pad = (n) => String(n).padStart(2, "0");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ============ 日期：打卡日以 5 点为界 ============ */
  function gardenDate(now = new Date()) {
    const d = new Date(now);
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    return d;
  }
  const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => dkey(gardenDate());
  function parseKey(k) { return new Date(k + "T00:00:00"); }
  /* 距离下一个 5 点还有多久 */
  function nextResetText() {
    const now = new Date();
    const reset = new Date(now);
    reset.setHours(5, 0, 0, 0);
    if (now >= reset) reset.setDate(reset.getDate() + 1);
    const h = Math.floor((reset - now) / 3.6e6);
    const m = Math.floor(((reset - now) % 3.6e6) / 6e4);
    return `${h} 小时 ${m} 分后刷新`;
  }

  /* ============ 状态 ============ */
  function freshState() {
    return {
      dew: 0,
      totals: { income: 0, expense: 0 }, // 累计收支：独立计数，不受流水条数上限影响
      ledger: [],
      habits: [],
      maps: [],
      activeMapId: null,
      animals: [],
      tools: {},
      decorItems: [], // {uid, decorId}
      unlockedPlants: ["sprout", "daisy", "sunflower", "clover"],
      deadPlants: [],
      settings: { reminder: false, reminderTime: "20:00" },
      collection: {},   // 图鉴：{ plantId: {count, firstAt, lastAt} }
      medals: 0,        // 累计获得的勋章数
      graceUsed: false, // 首次使用的一次宽容（让第一次打卡也能拿到花露）
      seenIntro: false,
    };
  }
  function newMap(n) {
    return { id: uid(), name: `花园 ${n}`, skin: "grass", skins: ["grass"], cells: {} };
  }
  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* 坏数据 */ }
    if (!raw) raw = migrateV2();
    const s = Object.assign(freshState(), raw || {});
    if (!s.maps.length) s.maps.push(newMap(1));
    if (!s.activeMapId || !s.maps.find((m) => m.id === s.activeMapId)) s.activeMapId = s.maps[0].id;
    return s;
  }
  /* 从上一版数据迁移：老的花园卡片 → 放进 9×9 地图 */
  function migrateV2() {
    let old = null;
    try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch (e) { return null; }
    if (!old || !Array.isArray(old.habits)) return null;
    const s = freshState();
    s.dew = old.dew || 0;
    s.unlockedPlants = old.unlockedPlants || s.unlockedPlants;
    s.tools = old.tools || {};
    s.ledger = old.ledger || [];
    s.totals.income = s.ledger.filter((l) => l.delta > 0).reduce((a, b) => a + b.delta, 0);
    s.totals.expense = s.ledger.filter((l) => l.delta < 0).reduce((a, b) => a + b.delta, 0);
    s.deadPlants = old.deadPlants || [];
    s.animals = (old.animals || []).map((a) => ({ uid: uid(), catId: a.catId, assignedHabit: null, lastSim: Date.now() }));
    s.decorItems = (old.decors || []).map((d) => ({ uid: uid(), decorId: d }));
    s.habits = old.habits.map((h) => ({
      id: h.id || uid(), name: h.name, schedule: h.schedule, weekdays: h.weekdays || [],
      target: h.target, plantId: h.plantId || null, records: h.records || {},
      undo: {}, growth: h.growth || 0, water: h.water ?? 100, fert: h.fert ?? 100, pest: h.pest ?? 0,
      lastSim: Date.now(), wilted: !!h.wilted, wiltStreak: h.wiltStreak || 0,
      reviveProgress: h.reviveProgress || 0, bloomGiven: !!h.bloomGiven,
      bonusPaid: Math.floor(Object.keys(h.records || {}).length / RULES.streakBonusEvery),
      plantedAt: h.plantedAt || todayKey(),
    }));
    // 依次安放进第一张地图的空格
    let m = newMap(1);
    s.maps = [m];
    const place = (cell) => { m.cells[cell] = cell; };
    let idx = 0;
    for (const h of s.habits) {
      if (!h.plantId) continue;
      if (idx >= CELLS) { m = newMap(s.maps.length + 1); s.maps.push(m); idx = 0; }
      m.cells[idx] = { type: "plant", habitId: h.id }; idx++;
    }
    for (const it of s.decorItems) {
      if (idx >= CELLS) { m = newMap(s.maps.length + 1); s.maps.push(m); idx = 0; }
      m.cells[idx] = { type: "decor", itemUid: it.uid }; idx++;
    }
    s.activeMapId = s.maps[0].id;
    return s;
  }

  let state = load();
  /* 数据体检：修掉会变成"僵尸习惯"的坏数据（custom 频率但一天都没选），
     这种习惯既进不了今日清单、也永远不会枯萎，界面上看不出异常。 */
  function sanitize(silent) {
    let fixed = 0;
    for (const h of state.habits) {
      h.records = h.records || {};
      h.undo = h.undo || {};
      h.weekdays = h.weekdays || [];
      h.pauses = h.pauses || [];
      h.season = h.season || 1;
      h.baseTarget = h.baseTarget || h.target;
      h.since = h.since || h.plantedAt || todayKey();
      h.medalPaid = h.medalPaid || 0;
      h.bonusPaid = h.bonusPaid || 0;
      if (h.archivedAt === undefined) h.archivedAt = null;
      if (h.schedule === "custom" && !h.weekdays.length) { h.schedule = "daily"; fixed++; }
    }
    state.collection = state.collection || {};
    state.medals = state.medals || 0;
    state.settings = Object.assign({ reminder: false, reminderTime: "20:00" }, state.settings || {});
    state.lastNotified = state.lastNotified || "";
    for (const h of state.habits) {
      h.createdAt = h.createdAt || h.plantedAt || todayKey();
      h.historyFrom = h.historyFrom || h.createdAt; // 日历的历史起点，收获/补种不重置
    }
    for (const m of state.maps) { m.cells = m.cells || {}; m.skins = m.skins && m.skins.length ? m.skins : ["grass"]; }
    // 小动物归属到某一张地图（老数据默认放第一张）
    for (const a of state.animals) {
      if (!a.mapId || !state.maps.find((m) => m.id === a.mapId)) a.mapId = state.maps[0].id;
    }
    if (fixed && !silent) setTimeout(() => toast(`发现 ${fixed} 个习惯的打卡频率无效（自定义但一天都没选），已自动改为「每天」`, "bad"), 900);
    return fixed;
  }
  let baseRev = state.rev || 0; // 我们这一份数据基于的版本号
  let storageBroken = false;
  let muteSave = false; // 同步另一个窗口的改动时，不要立刻写回（否则两端会互相触发、无限循环）
  let conflictWarnedAt = 0;
  function save() {
    if (muteSave || storageBroken) return;
    try {
      // 写之前先看存储里的版本号：比手上这份新，说明另一个窗口刚写过，
      // 这一笔会把它盖掉 —— 至少要让用户知道，而不是静默丢数据。
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* 坏数据 */ }
      if (stored && typeof stored.rev === "number" && stored.rev > baseRev && Date.now() - conflictWarnedAt > 20000) {
        conflictWarnedAt = Date.now();
        notice("⚠️ 检测到另一个窗口刚修改过花园数据。本次改动以你当前窗口为准，另一个窗口的那次修改可能已被覆盖。建议同时只开一个窗口，重要数据先导出备份。");
      }
      state.rev = baseRev + 1;
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      baseRev = state.rev;
    } catch (e) {
      storageBroken = true;
      notice("⚠️ 无法保存数据：浏览器存储不可用（可能是隐私模式或空间已满）。接下来的改动可能丢失，请先导出备份。");
    }
  }
  /* 常驻提示条：替代会阻塞页面的原生 alert */
  function notice(msg) {
    const el = $("#noticeBar");
    if (!el) return toast(msg, "bad");
    el.innerHTML = `<span>${esc(msg)}</span><button type="button" class="btn btn-sm btn-ghost">知道了</button>`;
    el.hidden = false;
    el.querySelector("button").onclick = () => { el.hidden = true; };
  }

  /* ============ 提示（弹窗打开时放进弹窗内，避免被遮住） ============ */
  function toast(msg, kind = "") {
    const open = $$("dialog").filter((d) => d.open);
    const host = open.length ? open[open.length - 1] : $("#toastRegion");
    const box = host === $("#toastRegion") ? host : (host.querySelector(".toast-box") || (() => {
      const b = document.createElement("div"); b.className = "toast-box"; host.appendChild(b); return b;
    })());
    const old = box.querySelectorAll(".toast");
    if (old.length >= 3) old[0].remove();
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }
  function formError(msg) {
    const el = $("#habitError");
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  /* ============ 排期与统计 ============ */
  /* 日期键运算 */
  function keyAdd(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dkey(d);
  }
  const keyDiff = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
  /* 该习惯在这一天是否处于「暂停」区间内 */
  function pausedOn(h, d) {
    const key = typeof d === "string" ? d : dkey(d);
    return (h.pauses || []).some((p) => key >= p.from && key <= p.to);
  }
  function pauseState(h) {
    const today = todayKey();
    const p = (h.pauses || []).find((x) => today >= x.from && today <= x.to);
    return p ? { on: true, until: p.to } : { on: false, until: null };
  }
  /* 计划周期：两次计划日之间最长要等几天（每天=1，工作日=3，周末=6，每周一次=7）。
     状态流失按它缩放，保证「到下次该打卡时刚好见底」 */
  const gapCache = new Map(); // 只放在内存里，不写进存档；频率一变就自动失效
  function cycleGap(h) {
    const sig = `${h.schedule}|${(h.weekdays || []).join(",")}`;
    const hit = gapCache.get(h.id);
    if (hit && hit.sig === sig) return hit.gap;
    let max = 1;
    for (let w = 0; w < 7; w++) {
      const base = new Date(2026, 0, 4 + w); // 2026-01-04 是周日，覆盖整周
      if (!isScheduled(h, base)) continue;
      let gap = 7;
      for (let i = 1; i <= 7; i++) {
        if (isScheduled(h, new Date(2026, 0, 4 + w + i))) { gap = i; break; }
      }
      if (gap > max) max = gap;
    }
    gapCache.set(h.id, { sig, gap: max });
    return max;
  }
  /* 每周要打卡几次（把"目标 N 次"折算成大概多少周） */
  function perWeek(h) {
    switch (h.schedule) {
      case "daily": return 7;
      case "weekdays": return 5;
      case "weekends": return 2;
      case "custom": return (h.weekdays || []).length || 1;
    }
    return 7;
  }
  /* 毕业：达到目标后免枯萎、免衰减，等用户决定升阶还是收获 */
  const isGraduated = (h) => !!h.plantId && !h.wilted && (h.growth || 0) >= h.target;
  const isArchived = (h) => !!h.archivedAt;
  const seasonBadge = (h) => ((h.season || 1) > 1 ? `✦${h.season}` : "");
  /* 升阶目标阶梯：21 → 30 → 60 → 110 → 160 … */
  function nextTarget(cur, season) {
    if (season <= 1) return cur;
    if (season === 2) return cur >= 30 ? cur + 10 : 30;   // 21→30，30→40
    if (season === 3) return cur >= 60 ? cur + 30 : 60;   // 30→60，40→60
    return cur + 50;
  }

  function isScheduled(h, d) {
    const w = d.getDay();
    switch (h.schedule) {
      case "daily": return true;
      case "weekdays": return w >= 1 && w <= 5;
      case "weekends": return w === 0 || w === 6;
      case "custom": return (h.weekdays || []).includes(w);
    }
    return false;
  }
  const lastRecordKey = (h) => {
    const ks = Object.keys(h.records).sort();
    return ks.length ? ks[ks.length - 1] : null;
  };
  function streak(h) {
    const d = gardenDate();
    if (isScheduled(h, d) && !h.records[dkey(d)] && !pausedOn(h, d)) d.setDate(d.getDate() - 1);
    let n = 0;
    for (let i = 0; i < 3650; i++) {
      const key = dkey(d);
      if (h.since && key < h.since) break;      // 收获/重新开始后，连击从新一轮算起
      if (pausedOn(h, d)) { d.setDate(d.getDate() - 1); continue; } // 暂停期间连击冻结
      if (isScheduled(h, d)) { if (h.records[key]) n++; else break; }
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  /* 统计 (from, to) 之间（不含 to）的计划日数量 —— 用于枯萎判定 */
  function scheduledBetween(h, fromDate, toExclusive) {
    return countScheduled(h, fromDate, (d) => d < toExclusive);
  }
  /* 统计 (from, to] 之间的计划日数量 —— 用于状态衰减，含当日 */
  function scheduledThrough(h, fromDate, toInclusive) {
    return countScheduled(h, fromDate, (d) => d <= toInclusive);
  }
  function countScheduled(h, fromDate, keep) {
    let n = 0;
    const d = new Date(fromDate);
    d.setDate(d.getDate() + 1);
    let guard = 0;
    while (keep(d) && guard++ < 400) {
      if (isScheduled(h, d) && !pausedOn(h, d)) n++; // 暂停的日子不算漏打
      d.setDate(d.getDate() + 1);
    }
    return n;
  }
  const totalCheckIns = (h) => Object.keys(h.records).length;

  /* ============ 枯萎 / 复活 / 死亡 ============ */
  function checkWilt(h) {
    if (!h.plantId || isArchived(h)) return;
    if (isGraduated(h)) return;             // 满绽毕业 = 免枯萎
    if (pauseState(h).on) return;            // 暂停中不判枯萎
    let ref = lastRecordKey(h);
    if (!ref || (h.plantedAt && h.plantedAt > ref)) ref = h.plantedAt;
    if (!ref) return;
    const today = gardenDate(); today.setHours(0, 0, 0, 0);
    const missed = scheduledBetween(h, parseKey(ref), today);
    if (h.wilted) {
      if (missed >= 1) h.reviveProgress = 0; // 复活期间再漏打 → 从头照料
      return;
    }
    if (missed >= 1) wiltEvent(h);
  }
  function wiltEvent(h) {
    h.wilted = true;
    h.reviveProgress = 0;
    h.wiltStreak = (h.wiltStreak || 0) + 1;
    if (h.wiltStreak >= RULES.deathAfterWilts) {
      const plant = PLANT_BY_ID[h.plantId];
      state.deadPlants.push({ habitName: h.name, plantName: plant ? plant.name : h.plantId, date: todayKey() });
      removeCellOf(h.id);
      // 归档：习惯不再要求打卡；30 天内可以「翻案」恢复
      h.snapshot = {
        plantId: h.plantId, growth: h.growth, wilted: false, wiltStreak: h.wiltStreak - 1,
        reviveProgress: 0, water: h.water, fert: h.fert, pest: h.pest,
        bloomGiven: h.bloomGiven, bonusPaid: h.bonusPaid, medalPaid: h.medalPaid, season: h.season,
      };
      h.archivedAt = todayKey();
      h.plantId = null; h.wilted = false; h.wiltStreak = 0; h.growth = 0; h.reviveProgress = 0;
      h.water = 100; h.fert = 100; h.pest = 0;
      toast(`💔 「${h.name}」的${plant ? plant.name : "植物"}连续枯萎三次，永久枯死了。这个习惯已归档（${RULES.archiveDays} 天内可以翻案）。`, "bad");
    } else {
      toast(`🥀 「${h.name}」漏打了，植物枯萎了。连续照料 ${RULES.reviveTimes} 次才能救活（第 ${h.wiltStreak} 次枯萎，3 次将永久死亡）`, "bad");
    }
  }

  /* ============ 毕业之后：升阶 / 收获 / 归档翻案 ============ */
  /* 继续升阶：植物形态升级，目标进入下一季，重新开始会被枯萎的周期 */
  function seasonUp(h) {
    h.season = (h.season || 1) + 1;
    h.target = nextTarget(h.target, h.season);
    h.growth = 0;
    h.bloomGiven = false;
    h.wilted = false; h.wiltStreak = 0; h.reviveProgress = 0;
    h.water = 100; h.fert = 100; h.pest = 0; h.lastSim = Date.now();
    save(); render();
    // 升阶保留连击：习惯并没有断，只是目标更难了（只有「收获」才会清零连击）
    toast(`✦ 「${h.name}」升到第 ${h.season} 季，目标 ${h.target} 次，植物长得更壮了（连击保留）`, "good");
    openPlantDialog(h.id);
  }
  /* 收获入册：记进图鉴、连击折算花露、连击清零，随后立刻选新株 */
  function applyHarvest(h) {
    const plant = PLANT_BY_ID[h.plantId];
    const st = streak(h);
    const bonus = Math.floor(st / RULES.streakPerDays) * RULES.streakPerDew;
    const c = state.collection[h.plantId] || { count: 0, firstAt: todayKey(), lastAt: null };
    c.count += 1; c.lastAt = todayKey();
    if (!c.firstAt) c.firstAt = todayKey();
    state.collection[h.plantId] = c;
    if (bonus > 0) gain(bonus, `收获「${plant ? plant.name : "植物"}」连击 ${st} 天折算`);
    h.growth = 0;
    h.season = 1;
    h.target = h.baseTarget || h.target;
    h.bloomGiven = false; h.wilted = false; h.wiltStreak = 0; h.reviveProgress = 0;
    h.water = 100; h.fert = 100; h.pest = 0; h.lastSim = Date.now();
    h.since = todayKey();
    h.plantedAt = todayKey();
    toast(`🏆 收获「${plant ? plant.name : "植物"}」！图鉴 +1（已集 ${Object.keys(state.collection).length}/${PLANT_CATALOG.length}）${bonus ? `，连击 ${st} 天折算 +${bonus}💧` : ""}`, "good");
  }
  /* 归档翻案：恢复到枯萎前的状态（30 天内） */
  function unarchive(h) {
    const left = RULES.archiveDays - keyDiff(h.archivedAt, todayKey());
    if (left < 0 || !h.snapshot) return toast("已经超过 30 天，不能翻案了，只能重新开始", "bad");
    Object.assign(h, h.snapshot);
    h.archivedAt = null;
    h.snapshot = null;
    h.lastSim = Date.now();
    save(); render();
    toast(`🕊 「${h.name}」已翻案，植物回来了（还剩 ${left} 天翻案期）`, "good");
  }
  /* 重新开始：清空植物，保留历史打卡记录，连击重算 */
  function restartHabit(h) {
    h.plantId = null;
    h.growth = 0; h.wilted = false; h.wiltStreak = 0; h.reviveProgress = 0;
    h.bloomGiven = false; h.season = 1; h.target = h.baseTarget || h.target;
    h.water = 100; h.fert = 100; h.pest = 0; h.lastSim = Date.now();
    h.since = todayKey(); h.plantedAt = todayKey();
    h.archivedAt = null; h.snapshot = null;
    save();
    openHabitDialog(h, true);
  }

  /* ============ 状态值随时间推演 ============ */
  function simulate() {
    const now = Date.now();
    const alive = state.habits.filter((h) => h.plantId);
    const today = gardenDate(); today.setHours(0, 0, 0, 0);
    let dirty = false; // 只有「动物换了照顾对象」这种持久化信息才需要写盘
    // 每株植物在哪张地图上（小动物只照顾自己所属地图里的植物）
    const mapOfHabit = {};
    for (const m of state.maps) {
      for (const k in m.cells) {
        const c = m.cells[k];
        if (c && c.type === "plant") mapOfHabit[c.habitId] = m.id;
      }
    }

    for (const h of alive) {
      if (!h.lastSim) { h.lastSim = now; continue; }
      // 毕业的植物免衰减；暂停中的日子也不算流失
      if (isGraduated(h) || isArchived(h)) { h.lastSim = now; continue; }
      const from = gardenDate(new Date(h.lastSim)); from.setHours(0, 0, 0, 0);
      let days = 0;
      const d = new Date(from);
      d.setDate(d.getDate() + 1);
      let guard = 0;
      while (d <= today && guard++ < 400) {          // 按「自然日」累计
        if (!pausedOn(h, d)) days++;
        d.setDate(d.getDate() + 1);
      }
      if (days > 0) {
        // 流失速度按习惯自己的计划周期缩放：到下次该打卡时刚好见底
        const g = cycleGap(h);
        h.water = clamp(h.water - (RULES.decayWater / g) * days, 0, 100);
        h.fert = clamp(h.fert - (RULES.decayFert / g) * days, 0, 100);
        h.pest = clamp(h.pest + (RULES.growPest / g) * days, 0, 100);
      }
      h.lastSim = now;
    }

    for (const a of state.animals) {
      const cat = ANIMAL_BY_ID[a.catId];
      if (!cat) continue;
      // 这只动物能照顾的范围 = 它所属地图上的植物
      const scope = alive.filter((h) => mapOfHabit[h.id] === a.mapId);
      const servicing = (h) => cat.tasks.some((t) =>
        t === "water" ? h.water < 90 : t === "fert" ? h.fert < 90 : h.pest > 10);
      let cur = scope.find((x) => x.id === a.assignedHabit);
      if (!cur && a.assignedHabit) { a.assignedHabit = null; dirty = true; } // 被移到别的地图了
      if (!cur || !servicing(cur)) {
        const next = pickAssignment(cat, scope.filter(servicing)) ?? (cur ? cur.id : pickAssignment(cat, scope));
        if (next !== a.assignedHabit) { a.assignedHabit = next; dirty = true; }
      }
      const hours = Math.min(96, (now - (a.lastSim || now)) / 3.6e6);
      if (hours <= 0) continue;
      const h = alive.find((x) => x.id === a.assignedHabit);
      if (h) {
        for (const t of cat.tasks) {
          if (t === "water") h.water = clamp(h.water + cat.rate * hours, 0, 100);
          if (t === "fert") h.fert = clamp(h.fert + cat.rate * hours, 0, 100);
          if (t === "pest") h.pest = clamp(h.pest - cat.rate * hours, 0, 100);
        }
      }
      a.lastSim = now;
    }
    if (dirty) save();
  }
  /* 挑一株最缺照顾的（随机扰动，避免总挑同一株）*/
  function pickAssignment(cat, habits) {
    if (!habits.length) return null;
    const need = (h) => cat.tasks.reduce((s, t) => s + (t === "pest" ? h.pest / 100 : 1 - h[t] / 100), 0);
    return habits.slice().sort((a, b) => (need(b) + Math.random() * 0.3) - (need(a) + Math.random() * 0.3))[0].id;
  }

  /* ============ 生长阶段 ============ */
  const STAGES = [
    { name: "种子", min: 0 },
    { name: "发芽", min: 0.05 },
    { name: "生长", min: 0.3 },
    { name: "含苞", min: 0.6 },
    { name: "盛开", min: 1 },
  ];
  function stageOf(h) {
    const p = (h.growth || 0) / h.target;
    let s = STAGES[0];
    for (const st of STAGES) if (p >= st.min) s = st;
    return s;
  }

  /* ============ 打卡 ============ */
  /* 打卡前先给这株植物拍个快照，取消打卡时按快照逐字段还原。
     这样「打卡↔取消」既不会刷出任何东西（完全对称），也不会出现
     "取消打卡却把复活结果留下来" 的规则漏洞。 */
  const SNAP_FIELDS = ["growth", "wilted", "wiltStreak", "reviveProgress", "water", "fert", "pest", "bloomGiven", "bonusPaid"];
  function snapshot(h) {
    const s = {};
    for (const f of SNAP_FIELDS) s[f] = h[f];
    return s;
  }
  function checkIn(h) {
    const key = todayKey();
    if (h.records[key]) return;
    if (isArchived(h)) return toast("这个习惯已归档，先「重新开始」或「翻案」才能打卡", "bad");
    if (pauseState(h).on) return toast(`「${h.name}」正在暂停中，暂停期间不能打卡`, "bad");
    h.undo = h.undo || {};
    h.undo[key] = { snap: snapshot(h), dew: 0 }; // dew 记录本次真正发出去了多少
    const rec = h.undo[key];
    const grant = (amount, reason) => {
      gain(amount, reason);
      rec.dew += amount;
    };

    h.records[key] = true;
    h.water = 100; h.fert = 100; h.pest = 0; // 打卡 = 满状态照料

    // 防刷：今天新建的习惯，今天的打卡不发花露（否则"建一个→打卡→删掉"可以白拿花露）。
    // 第一次使用留一次宽容，让新用户的第一下打卡也有正反馈。
    const bornToday = (h.createdAt || h.plantedAt || todayKey()) >= todayKey();
    const canEarn = !bornToday || !state.graceUsed;
    let msg = `✅ 打卡成功`;
    if (canEarn) {
      if (bornToday) state.graceUsed = true;
      msg += ` +${RULES.dewPerCheckIn}💧`;
      grant(RULES.dewPerCheckIn, `打卡「${h.name}」`);
    } else {
      msg += "（今天刚种下的习惯不发花露，明天起正常）";
    }

    if (h.wilted && h.plantId) {
      h.reviveProgress = (h.reviveProgress || 0) + 1;
      if (h.reviveProgress >= RULES.reviveTimes) {
        h.wilted = false; h.wiltStreak = 0; h.reviveProgress = 0;
        msg += " 🌿 植物完全复活了！";
      } else {
        msg += ` 🌱 复活进度 ${h.reviveProgress}/${RULES.reviveTimes}`;
      }
    } else if (h.plantId) {
      const graduated = isGraduated(h);
      if (!graduated) {
        const stat = (h.water + h.fert + (100 - h.pest)) / 300;
        const want = 0.5 + 0.7 * stat;
        h.growth = Math.min(h.target, (h.growth || 0) + want); // 生长封顶在目标
      }
      const total = totalCheckIns(h);
      // 每 7 次 +10
      const milestone = Math.floor(total / RULES.streakBonusEvery);
      if (milestone > (h.bonusPaid || 0)) {
        const times = milestone - (h.bonusPaid || 0);
        h.bonusPaid = milestone;
        grant(RULES.streakBonusDew * times, `「${h.name}」满 ${milestone * RULES.streakBonusEvery} 次坚持奖励`);
        msg += `，满 ${milestone * RULES.streakBonusEvery} 次 +${RULES.streakBonusDew * times}💧`;
      }
      // 每满 30 次的大奖：+50 花露 + 一枚勋章
      const medal = Math.floor(total / RULES.medalEvery);
      if (medal > (h.medalPaid || 0)) {
        const times = medal - (h.medalPaid || 0);
        h.medalPaid = medal;
        state.medals = (state.medals || 0) + times;
        grant(RULES.medalDew * times, `「${h.name}」满 ${medal * RULES.medalEvery} 次大奖`);
        msg += ` 🏅 满 ${medal * RULES.medalEvery} 次大奖 +${RULES.medalDew * times}💧`;
      }
      if (!graduated && h.growth >= h.target && !h.bloomGiven) {
        h.bloomGiven = true;
        grant(RULES.bloomBonusDew, `「${h.name}」植物满绽`);
        msg += ` 🌸 植物满绽绽放！+${RULES.bloomBonusDew}💧（已毕业，请选择升阶或收获）`;
      } else if (graduated) {
        msg += " 🎓 已毕业，打卡只为花露";
      }
    }
    // 快照只用于当天取消，超过 120 天的剪掉，避免无限增长
    const cutoff = dkey(new Date(Date.now() - 120 * 864e5));
    for (const k in h.undo) if (k < cutoff) delete h.undo[k];

    toast(msg, "good");
    save(); render();
  }
  function unCheckIn(h) {
    const key = todayKey();
    if (!h.records[key]) return;
    delete h.records[key];
    const rec = h.undo && h.undo[key];
    if (rec) {
      // 逐字段还原到打卡前，并收回本次发出的全部花露（含里程碑与满绽奖励）
      for (const f of SNAP_FIELDS) h[f] = rec.snap[f];
      const back = rec.dew || 0;
      state.dew = Math.max(0, state.dew - back);
      state.totals.income -= back;
      ledger(-back, `取消打卡「${h.name}」`);
      delete h.undo[key];
      toast(`已取消今日打卡${back ? `，收回 ${back} 💧（状态与进度已完全还原）` : "（状态与进度已完全还原）"}`);
    } else {
      // 兼容旧数据（没有快照时至少收回基础花露）
      state.dew = Math.max(0, state.dew - RULES.dewPerCheckIn);
      state.totals.income -= RULES.dewPerCheckIn;
      ledger(-RULES.dewPerCheckIn, `取消打卡「${h.name}」`);
      toast("已取消今日打卡");
    }
    save(); render();
  }
  function gain(amount, reason) {
    state.dew += amount;
    state.totals.income += amount;
    ledger(amount, reason);
  }
  function ledger(delta, reason) {
    state.ledger.push({ d: todayKey(), delta, reason });
    // 只保留最新 100 条流水（累计收支由 totals 单独记录，不受裁剪影响）
    if (state.ledger.length > 100) state.ledger = state.ledger.slice(-100);
  }

  /* ============ 小动物园丁造型 ============ */
  function animalSVG(catId, face) {
    const f = face < 0 ? -1 : 1;
    const body = {
      earthworm: `<path d="M6 30 q7 -12 16 -6 q9 6 17 -3" stroke="#e2907c" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M11 26 q5 -7 11 -4 M20 27 q6 -4 11 -1" stroke="#c96f5c" stroke-width="1.6" fill="none" opacity=".7"/>
        <ellipse cx="4" cy="34" rx="9" ry="3" fill="#8d6e42"/>`,
      snail: `<g transform="translate(60 0) scale(-1 1)"><path d="M4 32 q4 -9 16 -9 h20" stroke="#d9a06a" stroke-width="7" fill="none" stroke-linecap="round"/>
        <circle cx="17" cy="17" r="11" fill="#b06a3c"/>
        <path d="M17 9 a8.6 8.6 0 0 1 8 8 a8.6 8.6 0 0 1 -8 8.4" stroke="#8d5432" stroke-width="2" fill="none"/>
        <line x1="36" y1="21" x2="41" y2="12" stroke="#d9a06a" stroke-width="2"/><circle cx="42" cy="11" r="2" fill="#d9a06a"/>
        <line x1="32" y1="20" x2="35" y2="10" stroke="#d9a06a" stroke-width="2"/><circle cx="35.6" cy="9" r="2" fill="#d9a06a"/></g>`,
      ladybug: `<circle cx="30" cy="22" r="12.6" fill="#d8453a"/>
        <path d="M30 10 a12.6 12.6 0 0 1 0 25" fill="none" stroke="#7c2018" stroke-width="1.6"/>
        <circle cx="17" cy="21" r="6.4" fill="#3a2f2b"/>
        <line x1="12" y1="14" x2="8" y2="9" stroke="#3a2f2b" stroke-width="2"/><line x1="17" y1="12" x2="16" y2="7" stroke="#3a2f2b" stroke-width="2"/>
        <circle cx="36" cy="15" r="2.6" fill="#3a2f2b"/><circle cx="41" cy="24" r="2.6" fill="#3a2f2b"/>
        <circle cx="34" cy="31" r="2.4" fill="#3a2f2b"/><circle cx="25" cy="32" r="2.4" fill="#3a2f2b"/>
        <line x1="24" y1="33" x2="21" y2="37" stroke="#3a2f2b" stroke-width="2"/><line x1="38" y1="33" x2="41" y2="37" stroke="#3a2f2b" stroke-width="2"/>`,
      bee: `<ellipse cx="28" cy="24" rx="15" ry="10.6" fill="#f2c94c"/>
        <path d="M22 14.6 q-1 10 0 19 M31 13.8 q-1 11 0 21" stroke="#3a2f2b" stroke-width="4.4" fill="none"/>
        <circle cx="13" cy="20" r="6.6" fill="#3a2f2b"/>
        <ellipse cx="24" cy="9" rx="8" ry="5" fill="#dfeaf5" opacity=".9" transform="rotate(-24 24 9)"/>
        <ellipse cx="33" cy="10" rx="8" ry="5" fill="#dfeaf5" opacity=".9" transform="rotate(14 33 10)"/>
        <path d="M43 24 l6 2 -6 2Z" fill="#3a2f2b"/>`,
      frog: `<path d="M8 34 q0 -18 22 -18 q22 0 22 18Z" fill="#66bb6a"/>
        <circle cx="17" cy="15" r="6.4" fill="#66bb6a"/><circle cx="43" cy="15" r="6.4" fill="#66bb6a"/>
        <circle cx="17" cy="14" r="3" fill="#fff"/><circle cx="17" cy="14" r="1.6" fill="#263238"/>
        <circle cx="43" cy="14" r="3" fill="#fff"/><circle cx="43" cy="14" r="1.6" fill="#263238"/>
        <ellipse cx="30" cy="27" rx="13" ry="5.4" fill="#e8f5e9" opacity=".85"/>
        <path d="M12 33 q18 5 36 0" stroke="#4c9a55" stroke-width="2" fill="none"/>`,
      bird: `<ellipse cx="28" cy="24" rx="15" ry="11" fill="#a1887f"/>
        <circle cx="14" cy="17" r="7.4" fill="#8d6e63"/>
        <path d="M7 16 l-6 2.6 6 2.4Z" fill="#e8a33c"/>
        <circle cx="12" cy="15.4" r="1.6" fill="#263238"/>
        <path d="M28 20 q10 -2 16 6 q-9 4 -16 -1Z" fill="#8d6e63"/>
        <line x1="24" y1="34" x2="21" y2="38" stroke="#e8a33c" stroke-width="2.2"/>
        <line x1="32" y1="34" x2="32" y2="38" stroke="#e8a33c" stroke-width="2.2"/>`,
      hedgehog: `<g transform="translate(60 0) scale(-1 1)"><path d="M6 34 q0 -20 24 -20 q22 0 22 20Z" fill="#8d6e4a"/>
        <path d="M8 22 L14 8 L20 20 L27 5 L33 19 L40 7 L46 20 L52 12 L54 24 q-24 8 -46 -2Z" fill="#6d5236"/>
        <circle cx="49" cy="27" r="7.4" fill="#c99b64"/>
        <circle cx="51" cy="25.4" r="1.5" fill="#263238"/>
        <ellipse cx="55" cy="29" rx="3.4" ry="2.4" fill="#3a2f2b"/></g>`,
      butterfly: `<g transform="rotate(-8 30 22)">
        <ellipse cx="18" cy="14" rx="13" ry="9.6" fill="#7986cb" transform="rotate(-28 18 14)"/>
        <ellipse cx="42" cy="14" rx="13" ry="9.6" fill="#9fa8da" transform="rotate(28 42 14)"/>
        <ellipse cx="20" cy="30" rx="9" ry="6.6" fill="#9fa8da" transform="rotate(-16 20 30)"/>
        <ellipse cx="40" cy="30" rx="9" ry="6.6" fill="#7986cb" transform="rotate(16 40 30)"/>
        <circle cx="18" cy="12" r="2.6" fill="#fff" opacity=".85"/><circle cx="42" cy="12" r="2.6" fill="#fff" opacity=".85"/>
        <rect x="28" y="8" width="4.6" height="28" rx="2.3" fill="#4a3b52"/>
        <line x1="29" y1="8" x2="25" y2="2" stroke="#4a3b52" stroke-width="1.8"/><line x1="31" y1="8" x2="35" y2="2" stroke="#4a3b52" stroke-width="1.8"/>
      </g>`,
    }[catId] || "";
    return `<svg class="animal-svg" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g transform="scale(${f} 1) translate(-60 0)">${body}</g>
    </svg>`;
  }

  /* ============ 装饰手绘造型（与植株同一画法） ============ */
  function decorSVG(id) {
    const W = '<svg class="decor-svg" viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
    switch (id) {
      case "bench": // 小长凳
        return W + `
          <ellipse cx="60" cy="112" rx="34" ry="5" fill="#3e2f23" opacity=".14"/>
          <rect x="22" y="76" width="76" height="13" rx="6" fill="#c99b64"/>
          <rect x="22" y="72" width="76" height="9" rx="4.5" fill="#dcb27c"/>
          <path d="M30 76 h58 M34 79 h50" stroke="#b08d5e" stroke-width="1.2" opacity=".7"/>
          <rect x="30" y="89" width="9" height="21" rx="3.4" fill="#a97c4e"/>
          <rect x="81" y="89" width="9" height="21" rx="3.4" fill="#a97c4e"/>
          <rect x="30" y="89" width="3.4" height="21" rx="1.6" fill="#8d6e4a" opacity=".6"/>
          <rect x="81" y="89" width="3.4" height="21" rx="1.6" fill="#8d6e4a" opacity=".6"/>
        </svg>`;
      case "windchime": // 风铃：立杆挂三节陶铃
        return W + `
          <rect x="78" y="34" width="7" height="72" rx="3.4" fill="#8d6e4a"/>
          <rect x="78" y="34" width="2.8" height="72" fill="#a5825a" opacity=".7"/>
          <rect x="34" y="40" width="47" height="6" rx="3" fill="#a5825a"/>
          <line x1="44" y1="46" x2="44" y2="62" stroke="#c9b28a" stroke-width="1.8"/>
          <line x1="57" y1="46" x2="57" y2="72" stroke="#c9b28a" stroke-width="1.8"/>
          <line x1="70" y1="46" x2="70" y2="56" stroke="#c9b28a" stroke-width="1.8"/>
          <path d="M36 62 q8 4 16 0 l-2.4 15 q-5.6 3 -11.2 0Z" fill="#d98f4e"/>
          <ellipse cx="44" cy="62" rx="8" ry="2.6" fill="#b06a3c"/>
          <path d="M49 72 q8 4 16 0 l-2.4 17 q-5.6 3.2 -11.2 0Z" fill="#e0995c"/>
          <ellipse cx="57" cy="72" rx="8" ry="2.6" fill="#b06a3c"/>
          <path d="M62 56 q8 4 16 0 l-2.2 14 q-5.8 3 -11.6 0Z" fill="#d98f4e"/>
          <ellipse cx="70" cy="56" rx="8" ry="2.6" fill="#b06a3c"/>
          <circle cx="44" cy="79" r="1.8" fill="#8d5a2e"/><circle cx="57" cy="91" r="1.8" fill="#8d5a2e"/>
        </svg>`;
      case "firefly": // 萤火虫：几点带光晕的碎光
        return W + `
          <g class="firefly-glow">
            <circle cx="38" cy="58" r="10" fill="#fff7c2" opacity=".22"/><circle cx="38" cy="58" r="3.2" fill="#ffe98a"/>
            <circle cx="72" cy="40" r="12" fill="#fff7c2" opacity=".18"/><circle cx="72" cy="40" r="3.6" fill="#ffe98a"/>
            <circle cx="60" cy="86" r="9" fill="#fff7c2" opacity=".2"/><circle cx="60" cy="86" r="2.8" fill="#ffe98a"/>
          </g>
          <ellipse cx="39" cy="61" rx="3.4" ry="1.8" fill="#6b5a3a" transform="rotate(-24 39 61)"/>
          <ellipse cx="73" cy="43" rx="3.4" ry="1.8" fill="#6b5a3a" transform="rotate(18 73 43)"/>
        </svg>`;
      case "fence": // 矮篱笆一段
        return W + `
          <ellipse cx="60" cy="112" rx="40" ry="5" fill="#3e2f23" opacity=".12"/>
          <rect x="12" y="66" width="96" height="5" rx="2.4" fill="#b08d5e"/>
          <rect x="12" y="84" width="96" height="5" rx="2.4" fill="#b08d5e"/>
          <rect x="22" y="56" width="8" height="48" rx="3.4" fill="#8d6e4a"/>
          <rect x="56" y="56" width="8" height="48" rx="3.4" fill="#8d6e4a"/>
          <rect x="90" y="56" width="8" height="48" rx="3.4" fill="#8d6e4a"/>
          <rect x="22" y="56" width="3" height="48" fill="#a5825a" opacity=".6"/>
          <rect x="56" y="56" width="3" height="48" fill="#a5825a" opacity=".6"/>
        </svg>`;
      case "pond": // 小池塘
        return W + `
          <ellipse cx="60" cy="96" rx="52" ry="20" fill="#8a6844" opacity=".5"/>
          <ellipse cx="60" cy="94" rx="48" ry="17" fill="#7db8cc"/>
          <ellipse cx="58" cy="92" rx="40" ry="12.6" fill="#94c8d8"/>
          <ellipse cx="46" cy="90" rx="12" ry="4.6" fill="#5aa586"/>
          <ellipse cx="74" cy="98" rx="10" ry="4" fill="#5aa586"/>
          <circle cx="47" cy="89" r="2" fill="#f2c94c"/>
          <path d="M92 78 q4 -10 10 -14 M97 80 q5 -8 12 -10" stroke="#5f8a68" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        </svg>`;
      case "greenhouse": // 小温室
        return W + `
          <rect x="20" y="70" width="80" height="34" rx="4" fill="#cfe8f2"/>
          <path d="M14 72 L60 40 L106 72Z" fill="#bfe0ee"/>
          <path d="M14 72 L60 40 L106 72Z" fill="none" stroke="#8fae86" stroke-width="3"/>
          <rect x="14" y="70" width="92" height="5" fill="#8fae86"/>
          <rect x="20" y="70" width="80" height="34" fill="none" stroke="#8fae86" stroke-width="3"/>
          <line x1="60" y1="70" x2="60" y2="104" stroke="#8fae86" stroke-width="2" opacity=".8"/>
          <line x1="40" y1="70" x2="40" y2="104" stroke="#8fae86" stroke-width="1.6" opacity=".55"/>
          <line x1="80" y1="70" x2="80" y2="104" stroke="#8fae86" stroke-width="1.6" opacity=".55"/>
          <line x1="37" y1="56" x2="83" y2="56" stroke="#fff" stroke-width="2" opacity=".7"/>
          <rect x="48" y="84" width="24" height="20" rx="2" fill="#e8a86a"/>
          <rect x="48" y="84" width="24" height="20" fill="none" stroke="#8fae86" stroke-width="2.4"/>
        </svg>`;
    }
    return W + "</svg>";
  }

  /* ============ 苗圃底图绘制 v2：中央 9×9 草坪 + 每皮肤不同的丰富外围 ============ */
  /* 种植区占画面中央 72%，外围一圈画篱笆和风景；格线与摆放格子同一套坐标，永远对齐 */
  const PLOT = { x: 126, y: 126, w: 648, h: 648 }; // 900 视野里的种植区
  const NURSERY_COLORS = {
    grass:  { g1: "#a8cf92", g2: "#8fbf7a", line: "#7fae6c", fence: "#b08d5e", wood: "#8d6e4a" },
    soil:   { g1: "#cfa878", g2: "#b58a5c", line: "#a37c50", fence: "#8d6e4a", wood: "#6d5236" },
    moss:   { g1: "#93b08a", g2: "#759470", line: "#65835f", fence: "#7a6a50", wood: "#5f5240" },
    sand:   { g1: "#eed9a8", g2: "#dcc287", line: "#c9ad74", fence: "#b98f5c", wood: "#96703f" },
    pond:   { g1: "#9ecfdd", g2: "#79b4c8", line: "#63a2b8", fence: "#a98a60", wood: "#87683f" },
    snow:   { g1: "#eef4f8", g2: "#d5e4ee", line: "#c2d5e2", fence: "#9fb2c2", wood: "#7f94a6" },
    meadow: { g1: "#f2cede", g2: "#e0b3cf", line: "#d0a0bf", fence: "#c0998a", wood: "#a07a6a" },
    night:  { g1: "#46536e", g2: "#333e55", line: "#2a3346", fence: "#5a5348", wood: "#443e35" },
  };
  function propFlower(x, y, petal, core, sc) {
    sc = sc || 1;
    return '<g transform="translate(' + x + " " + y + ') scale(' + sc + ')">'
      + '<line x1="0" y1="0" x2="0" y2="-9" stroke="#5f8a4e" stroke-width="1.6"/>'
      + '<ellipse cx="-3.4" cy="-3" rx="3" ry="1.8" fill="#6f9c58" transform="rotate(-30 -3.4 -3)"/>'
      + '<circle cx="0" cy="-12" r="4.6" fill="' + petal + '"/>'
      + '<circle cx="0" cy="-12" r="1.9" fill="' + core + '"/></g>';
  }
  function propGrassTuft(x, y, c, sc) {
    sc = sc || 1;
    return '<g transform="translate(' + x + " " + y + ') scale(' + sc + ')" stroke="' + c + '" stroke-width="2" fill="none" stroke-linecap="round">'
      + '<path d="M0 0 q1.5 -7 0 -11 M5 0 q3 -6 7 -9 M-5 0 q-3 -6 -7 -9"/></g>';
  }
  function propMushroom(x, y, cap, sc) {
    sc = sc || 1;
    return '<g transform="translate(' + x + " " + y + ') scale(' + sc + ')">'
      + '<rect x="-2.6" y="-8" width="5.2" height="8" rx="2.4" fill="#efe6d2"/>'
      + '<path d="M-8 -7 q8 -12 16 0 q-8 4 -16 0Z" fill="' + cap + '"/>'
      + '<circle cx="-3" cy="-9.4" r="1.3" fill="#fff" opacity=".85"/>'
      + '<circle cx="3.4" cy="-8.6" r="1.1" fill="#fff" opacity=".85"/></g>';
  }
  function propStone(x, y, c1, c2, sc) {
    sc = sc || 1;
    return '<g transform="translate(' + x + " " + y + ') scale(' + sc + ')">'
      + '<ellipse cx="0" cy="0" rx="9" ry="6" fill="' + c1 + '"/>'
      + '<ellipse cx="-2" cy="-1.6" rx="5.4" ry="3.2" fill="' + c2 + '"/></g>';
  }
  function propTree(x, y, leaf1, leaf2, trunk, sc) {
    sc = sc || 1;
    return '<g transform="translate(' + x + " " + y + ') scale(' + sc + ')">'
      + '<rect x="-4" y="-16" width="8" height="18" rx="3" fill="' + trunk + '"/>'
      + '<circle cx="0" cy="-30" r="17" fill="' + leaf2 + '"/>'
      + '<circle cx="-11" cy="-22" r="12" fill="' + leaf1 + '"/>'
      + '<circle cx="11" cy="-23" r="12.5" fill="' + leaf1 + '"/>'
      + '<circle cx="1" cy="-33" r="9" fill="' + leaf1 + '" opacity=".9"/></g>';
  }
  function propPine(x, y, leaf, trunk, sc) {
    sc = sc || 1;
    return '<g transform="translate(' + x + " " + y + ') scale(' + sc + ')">'
      + '<rect x="-3" y="-8" width="6" height="9" rx="2" fill="' + trunk + '"/>'
      + '<path d="M0 -46 L13 -24 L-13 -24Z" fill="' + leaf + '"/>'
      + '<path d="M0 -34 L15 -12 L-15 -12Z" fill="' + leaf + '"/></g>';
  }
  function propFence(x1, y1, x2, y2, wood) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(len / 54));
    const ux = dx / len, uy = dy / len;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const px = x1 + ux * (len * i / n), py = y1 + uy * (len * i / n);
      out.push('<rect x="' + (px - 2.6).toFixed(1) + '" y="' + (py - 11).toFixed(1) + '" width="5.2" height="22" rx="2.4" fill="' + wood + '"/>');
    }
    for (const off of [-5, 4]) {
      if (dx) out.push('<rect x="' + Math.min(x1, x2) + '" y="' + (Math.min(y1, y2) + off - 2.6).toFixed(1) + '" width="' + len.toFixed(1) + '" height="5.2" fill="' + wood + '" opacity=".92"/>');
      else out.push('<rect x="' + (Math.min(x1, x2) + off - 2.6).toFixed(1) + '" y="' + Math.min(y1, y2) + '" width="5.2" height="' + len.toFixed(1) + '" fill="' + wood + '" opacity=".92"/>');
    }
    return out.join("");
  }
  function nurseryScenery(skinId, c) {
    const P = PLOT;
    const s = [];
    const themes = {
      grass: function () {
        s.push(propTree(56, 74, "#4e8a4a", "#63a457", "#7c5b3a", 1.5),
          propTree(838, 72, "#549257", "#68ab5c", "#7c5b3a", 1.25),
          propTree(60, 836, "#4e8a4a", "#5d9a52", "#7c5b3a", 1.15),
          propTree(842, 838, "#549257", "#63a457", "#7c5b3a", 1.4),
          propMushroom(130, 58, "#d8756a", 1.2), propMushroom(788, 52, "#e08a5e", 1),
          propStone(56, 470, "#b9b3a4", "#d3cebe", 1.3), propStone(848, 430, "#b9b3a4", "#d3cebe", 1.1),
          propFlower(470, 46, "#fff", "#f2c94c", 1.2), propFlower(430, 862, "#f8a5c2", "#fff", 1.2));
      },
      soil: function () {
        s.push(propTree(56, 76, "#9e9455", "#b3a765", "#7c5b3a", 1.4), propMushroom(838, 66, "#c9a06a", 1.2),
          propStone(60, 470, "#a99878", "#c4b598", 1.5), propStone(846, 440, "#a99878", "#c4b598", 1.2),
          propGrassTuft(468, 42, "#8d7a4e", 1.4), propGrassTuft(300, 862, "#8d7a4e", 1.3));
      },
      moss: function () {
        s.push(propTree(58, 74, "#5d8a68", "#6f9a76", "#5f5240", 1.45), propStone(840, 74, "#8d9a8f", "#aeb8ac", 1.5),
          propStone(58, 838, "#8d9a8f", "#aeb8ac", 1.2), propMushroom(846, 842, "#a8b59a", 1.1),
          propGrassTuft(468, 44, "#5d7a5f", 1.4), propGrassTuft(468, 862, "#5d7a5f", 1.3));
      },
      sand: function () {
        s.push('<g transform="translate(58 74) scale(1.5)">'
          + '<rect x="-7" y="-20" width="14" height="26" rx="7" fill="#5f9e63"/>'
          + '<rect x="-18" y="-14" width="14" height="8" rx="4" fill="#5f9e63"/>'
          + '<rect x="4" y="-16" width="14" height="8" rx="4" fill="#6fae70"/></g>',
          propTree(842, 80, "#c8b06a", "#d8c27c", "#8a6844", 1.3),
          propStone(58, 470, "#d9c9a0", "#ecdfbe", 1.4), propStone(846, 450, "#d9c9a0", "#ecdfbe", 1.1),
          propGrassTuft(468, 44, "#b9a468", 1.3), propGrassTuft(200, 862, "#b9a468", 1.2));
      },
      pond: function () {
        s.push('<ellipse cx="66" cy="450" rx="60" ry="190" fill="#7db8cc" opacity=".95"/>'
          + '<ellipse cx="834" cy="450" rx="60" ry="190" fill="#7db8cc" opacity=".95"/>'
          + '<ellipse cx="58" cy="380" rx="16" ry="7" fill="#5aa586"/><circle cx="62" cy="378" r="2.6" fill="#f2c94c"/>'
          + '<ellipse cx="80" cy="540" rx="14" ry="6" fill="#5aa586"/>'
          + '<ellipse cx="842" cy="400" rx="15" ry="6.4" fill="#5aa586"/><circle cx="846" cy="398" r="2.4" fill="#f2c94c"/>'
          + '<ellipse cx="820" cy="520" rx="13" ry="5.6" fill="#5aa586"/>'
          + '<path d="M60 470 q-10 -22 -2 -40 M64 470 q12 -20 22 -34" stroke="#5f8a68" stroke-width="2.4" fill="none"/>');
      },
      snow: function () {
        s.push(propPine(58, 84, "#5d8a68", "#7c5b3a", 1.5), propPine(842, 78, "#63946c", "#7c5b3a", 1.35),
          propPine(60, 844, "#5d8a68", "#7c5b3a", 1.2),
          '<g transform="translate(840 830) scale(1.3)"><circle cx="0" cy="-8" r="9" fill="#fff"/><circle cx="0" cy="-20" r="6.6" fill="#fff"/>'
          + '<circle cx="-2.2" cy="-21.6" r="1" fill="#444"/><circle cx="2.2" cy="-21.6" r="1" fill="#444"/>'
          + '<path d="M0 -19 l3 1.4 -3 1.4Z" fill="#e8833a"/></g>',
          propStone(468, 42, "#eef2f6", "#ffffff", 1.4), propGrassTuft(300, 866, "#c2d5e2", 1.2));
      },
      meadow: function () {
        s.push(propTree(56, 74, "#5d9a68", "#6fac76", "#7c5b3a", 1.4), propTree(840, 76, "#6fac76", "#7fb684", "#7c5b3a", 1.3));
        const spots = [[150, 50, "#fff"], [250, 40, "#f8a5c2"], [560, 44, "#fff"], [700, 52, "#f8a5c2"],
          [60, 500, "#f8a5c2"], [846, 520, "#fff"], [180, 860, "#fff"], [520, 862, "#f8a5c2"], [760, 854, "#fff"]];
        for (const sp of spots) s.push(propFlower(sp[0], sp[1], sp[2], "#f2c94c", 1.3));
      },
      night: function () {
        s.push('<circle cx="806" cy="64" r="26" fill="#f6f1d8" opacity=".95"/>'
          + '<circle cx="792" cy="56" r="22" fill="' + c.g1 + '"/>');
        const stars = [[140, 60], [320, 42], [520, 56], [660, 40], [60, 140], [860, 180], [40, 620], [868, 640]];
        for (const st of stars) s.push('<circle cx="' + st[0] + '" cy="' + st[1] + '" r="2.2" fill="#f6f1d8" opacity=".9"/>');
        s.push('<g transform="translate(58 80) scale(1.4)"><rect x="-4" y="-16" width="8" height="18" rx="3" fill="#443e35"/>'
          + '<circle cx="0" cy="-30" r="15" fill="#3a4a3f"/><circle cx="-10" cy="-23" r="10" fill="#425544"/></g>');
        const flies = [[210, 52, "#7ee0a0"], [600, 46, "#7ee0a0"], [866, 470, "#7ee0a0"], [46, 500, "#7ee0a0"]];
        for (const f of flies) s.push('<circle cx="' + f[0] + '" cy="' + f[1] + '" r="3.4" fill="' + f[2] + '" opacity=".95"/>'
          + '<circle cx="' + f[0] + '" cy="' + f[1] + '" r="7" fill="' + f[2] + '" opacity=".25"/>');
      },
    };
    (themes[skinId] || themes.grass)();

    const inset = 10;
    s.push(propFence(P.x - inset, P.y - inset, P.x + P.w + inset, P.y - inset, c.fence));
    s.push(propFence(P.x - inset, P.y + P.h + inset, P.x + P.w + inset, P.y + P.h + inset, c.fence));
    s.push(propFence(P.x - inset, P.y - inset, P.x - inset, P.y + P.h + inset, c.fence));
    s.push(propFence(P.x + P.w + inset, P.y - inset, P.x + P.w + inset, P.y + P.h + inset, c.fence));
    return s.join("");
  }
  /* 900×900 视野：中央种植区为连续草坪（微微修剪条纹），格线与摆放格子同一坐标 */
  function nurserySVG(skin) {
    const c = NURSERY_COLORS[skin.id] || NURSERY_COLORS.grass;
    const P = PLOT;
    let s = '<rect width="900" height="900" fill="' + c.g1 + '"/>';
    s += '<rect x="' + P.x + '" y="' + P.y + '" width="' + P.w + '" height="' + P.h + '" rx="26" fill="' + c.g1 + '"/>';
    for (let i = 0; i < 9; i++) {
      if (i % 2 === 0) continue;
      s += '<rect x="' + (P.x + (P.w / 9) * i) + '" y="' + P.y + '" width="' + (P.w / 9) + '" height="' + P.h + '" fill="' + c.g2 + '" opacity=".5"/>';
    }
    for (let i = 1; i < 9; i++) {
      s += '<line x1="' + (P.x + (P.w / 9) * i) + '" y1="' + (P.y + 6) + '" x2="' + (P.x + (P.w / 9) * i) + '" y2="' + (P.y + P.h - 6) + '" stroke="' + c.line + '" stroke-width="1.4" opacity=".4"/>';
      s += '<line x1="' + (P.x + 6) + '" y1="' + (P.y + (P.h / 9) * i) + '" x2="' + (P.x + P.w - 6) + '" y2="' + (P.y + (P.h / 9) * i) + '" stroke="' + c.line + '" stroke-width="1.4" opacity=".4"/>';
    }
    let seed = 7;
    const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const edge = i % 4, t = rnd();
      const x = edge === 0 ? P.x + 8 + t * (P.w - 16) : edge === 1 ? P.x + 8 + t * (P.w - 16)
        : edge === 2 ? P.x + 8 : P.x + P.w - 8;
      const y = edge === 0 ? P.y + 8 : edge === 1 ? P.y + P.h - 8 : P.y + 8 + t * (P.h - 16);
      s += propGrassTuft(x.toFixed(1), y.toFixed(1), c.line, 0.8 + rnd() * 0.5);
    }
    s += nurseryScenery(skin.id, c);
    return s;
  }

  /* ============ 植物绘制 ============ */
  function plantSVG(species, h, small) {
    const stageIdx = h.plantId ? STAGES.indexOf(stageOf(h)) : 0;
    // 种子/发芽阶段：所有品种统一画一颗可爱小苗（土丘+弯茎+两片子叶），
    // 随生长变大；品种造型从「生长」阶段开始显现——避免成年叶丛缩成乱叶棍
    if (stageIdx <= 1) {
      const g = Math.min(1, (h.growth || 0) / (h.target || 21));
      const sc = (stageIdx === 0 ? 0.68 : 0.95) + 0.25 * g;
      return wrap(`<g transform="translate(60 107) scale(${sc.toFixed(2)})">
        <ellipse cx="0" cy="5" rx="17" ry="5" fill="#8d6e42"/>
        <ellipse cx="0" cy="2.4" rx="13" ry="4" fill="#a5825a"/>
        <path d="M0 0 q-2 -9 1 -15" stroke="#5d9a4e" stroke-width="3.6" fill="none" stroke-linecap="round"/>
        <ellipse cx="-7.5" cy="-18.5" rx="8" ry="5.6" fill="#7cb85c" transform="rotate(-36 -7.5 -18.5)"/>
        <ellipse cx="7.5" cy="-19.5" rx="8" ry="5.6" fill="#93c96e" transform="rotate(32 7.5 -19.5)"/>
        <circle cx="0.8" cy="-19" r="1.7" fill="#437c3a"/>
      </g>`, 0, small);
    }
    const health = h.plantId ? (h.water + h.fert + (100 - h.pest)) / 300 : 1;
    const reviveP = h.wilted ? (h.reviveProgress || 0) / RULES.reviveTimes : 1;
    const grayAmt = h.wilted ? Math.max(0.3, 1 - reviveP * 0.85) : (1 - health) * 0.75;
    const s = Math.min(1, 0.45 + 0.55 * ((h.growth || 0) / h.target) + (stageIdx >= 4 ? 0.15 : 0));
    const gray = (c) => {
      const n = parseInt(c.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const mix = (x) => Math.round(x + (150 - x) * grayAmt);
      return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
    };
    const c1 = gray(species.c1), c2 = gray(species.c2);
    const leaf = gray("#66a944"), stem = gray("#4c8a3c");
    const H = Math.round(70 * s);
    const top = 100 - H;
    const droop = h.wilted ? Math.min(20, 10 + (1 - reviveP) * 14) : 0;
    // 含苞(3) 只露花苞/半开，盛开(4) 才完全绽放
    const budding = stageIdx === 3;
    const bloom = stageIdx >= 4;
    const fs = (v) => (budding ? v * 0.55 : v); // 花苞整体缩小

    const budOf = (cx, cy) => `<ellipse cx="${cx}" cy="${cy}" rx="${fs(7)}" ry="${fs(9)}" fill="${c2}"/>
      <path d="M${cx - 3} ${cy - fs(6)} q3 -${fs(6)} 6 0" stroke="${stem}" stroke-width="1.5" fill="none" opacity=".7"/>`;

    let head = "";
    switch (species.shape) {
      case "seed":
        head = bloom || budding
          ? `<circle cx="60" cy="${top + 4}" r="${fs(7 * s + 4)}" fill="${c1}"/>`
          : `<ellipse cx="60" cy="98" rx="7" ry="9" fill="#b5895a"/>`;
        break;
      case "daisy":
        head = bloom ? petals(60, top + 2, 8 * s + 3, 8, c1, c2) : budOf(60, top + 2);
        break;
      case "sunflower":
        head = bloom ? petals(60, top + 2, 9 * s + 4, 12, c1, c2, "#8d6e63") : budOf(60, top + 2);
        break;
      case "rose":
        head = bloom
          ? `<circle cx="60" cy="${top + 4}" r="${8 * s + 3}" fill="${c1}"/>
             <path d="M60 ${top + 4} m-5 0 a5 5 0 1 1 5 5 a4 4 0 1 0 -4 -4" fill="${c2}" opacity=".8"/>`
          : budOf(60, top + 3);
        break;
      case "tulip":
        head = bloom
          ? `<path d="M50 ${top + 12} q0 -12 10 -14 q10 2 10 14 q-4 6 -10 6 q-6 0 -10 -6Z" fill="${c1}"/>
             <path d="M52 ${top + 10} q3 -8 8 -9M68 ${top + 10} q-3 -8 -8 -9" stroke="${c2}" stroke-width="2" fill="none"/>`
          : budOf(60, top + 3);
        break;
      case "bell":
        head = bloom
          ? `<path d="M60 ${top} l-5 10 q5 4 10 0Z" fill="${c1}"/>
             <circle cx="48" cy="${top + 10}" r="5" fill="${c1}"/><circle cx="72" cy="${top + 12}" r="5" fill="${c1}"/>`
          : budOf(60, top + 5);
        break;
      case "lavender": {
        const n = budding ? 3 : 5;
        head = `<g>${Array.from({ length: n }, (_, i) =>
          `<ellipse cx="60" cy="${top + 4 + i * 7 * s}" rx="${fs(5 * s + 2 - i * 0.4)}" ry="${fs(4)}" fill="${i % 2 ? c1 : c2}"/>`).join("")}</g>`;
        break;
      }
      case "blossom": {
        const cy = top + 12;
        const R = 13 + 15 * s;
        const florets = [];
        if (bloom) {
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + 0.5;
            const rr = R * (0.5 + 0.5 * ((i % 3) / 2));
            florets.push(`<circle cx="${(60 + Math.cos(a) * rr).toFixed(1)}" cy="${(cy + Math.sin(a) * rr * 0.78).toFixed(1)}" r="${(4.5 * s + 2.5).toFixed(1)}" fill="${i % 2 ? c1 : c2}"/>`);
          }
        }
        return wrap(`
          <path d="M60 105 V${cy}" stroke="#8d6e63" stroke-width="${4 + 2 * s}" fill="none" stroke-linecap="round"/>
          <path d="M60 ${cy + 14} q-12 -4 -16 -12M60 ${cy + 24} q12 -4 16 -12" stroke="#8d6e63" stroke-width="2.5" fill="none"/>
          ${bloom ? florets.join("") : `<ellipse cx="60" cy="${cy}" rx="${R}" ry="${R * 0.78}" fill="${leaf}" opacity=".85"/>`}
          ${budding ? `<circle cx="60" cy="${cy}" r="${4 * s + 2}" fill="${c1}"/>` : `<circle cx="60" cy="${cy}" r="${3 * s + 2}" fill="${bloom ? "#f7d354" : leaf}"/>`}
        `, droop, small);
      }
      case "bush": {
        const cy = 100 - H * 0.82;
        const r = 11 + 11 * s;
        const dots = [];
        if (bloom) {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.3;
            dots.push(`<circle cx="${(60 + Math.cos(a) * r * 0.6).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.5).toFixed(1)}" r="${(4 * s + 2).toFixed(1)}" fill="${i % 2 ? c1 : c2}"/>`);
          }
        }
        return wrap(`
          <path d="M60 105 V${cy + 6}" stroke="${stem}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="60" cy="${cy}" rx="${r * 1.3}" ry="${r}" fill="${leaf}"/>
          <ellipse cx="46" cy="${cy + 9}" rx="${r * 0.75}" ry="${r * 0.6}" fill="${leaf}" opacity=".85"/>
          <ellipse cx="74" cy="${cy + 9}" rx="${r * 0.75}" ry="${r * 0.6}" fill="${leaf}" opacity=".85"/>
          ${budding ? `<circle cx="60" cy="${cy - 4}" r="${3.5 * s + 2}" fill="${c2}"/>` : ""}
          ${dots.join("")}
        `, droop, small);
      }
      case "hydrangea":
        head = bloom
          ? `<g>${[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i / 6) * Math.PI * 2;
              return `<circle cx="${60 + Math.cos(a) * 12}" cy="${top + 6 + Math.sin(a) * 9}" r="${6 * s + 2}" fill="${i % 2 ? c1 : c2}"/>`;
            }).join("")}<circle cx="60" cy="${top + 6}" r="${6 * s + 2}" fill="${c1}"/></g>`
          : budOf(60, top + 4);
        break;
      case "cluster":
        head = bloom
          ? `<g>${[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const a = (i / 7) * Math.PI * 2;
              return `<circle cx="${60 + Math.cos(a) * 10}" cy="${top + 6 + Math.sin(a) * 8}" r="3.5" fill="${i % 2 ? c1 : c2}"/>`;
            }).join("")}</g>`
          : budOf(60, top + 4);
        break;
      case "round":
        head = bloom
          ? `<g>${[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i / 6) * Math.PI * 2;
              return `<ellipse cx="${60 + Math.cos(a) * 8}" cy="${top + 6 + Math.sin(a) * 6}" rx="${7 * s}" ry="${6 * s}" fill="${i % 2 ? c1 : c2}" opacity=".95"/>`;
            }).join("")}<circle cx="60" cy="${top + 6}" r="${4 * s}" fill="${c2}"/></g>`
          : budOf(60, top + 4);
        break;
      case "iris":
        head = bloom
          ? `<g><path d="M60 ${top + 14} q-12 -4 -14 -18 q10 0 14 10Z" fill="${c1}"/>
             <path d="M60 ${top + 14} q12 -4 14 -18 q-10 0 -14 10Z" fill="${c2}"/>
             <path d="M60 ${top + 14} q-2 -14 0 -20" stroke="${c1}" stroke-width="3"/></g>`
          : budOf(60, top + 4);
        break;
      case "lily":
        head = bloom
          ? `<g>${[0, 1, 2, 3, 4].map((i) => {
              const a = (i / 5) * Math.PI * 2;
              return `<ellipse cx="${60 + Math.cos(a) * 10}" cy="${top + 6 + Math.sin(a) * 7}" rx="4.5" ry="9" fill="${i % 2 ? c1 : c2}" transform="rotate(${(i / 5) * 180} 60 ${top + 6})"/>`;
            }).join("")}</g>`
          : budOf(60, top + 4);
        break;
      case "orchid":
        head = bloom
          ? `<g><ellipse cx="60" cy="${top + 2}" rx="5" ry="7" fill="${c2}"/>
             <ellipse cx="51" cy="${top + 9}" rx="6" ry="4" fill="${c1}" transform="rotate(-25 51 ${top + 9})"/>
             <ellipse cx="69" cy="${top + 9}" rx="6" ry="4" fill="${c1}" transform="rotate(25 69 ${top + 9})"/>
             <ellipse cx="57" cy="${top + 14}" rx="5" ry="3" fill="${c2}"/><ellipse cx="63" cy="${top + 14}" rx="5" ry="3" fill="${c2}"/></g>`
          : budOf(60, top + 4);
        break;
      case "dandelion":
        head = bloom
          ? `<g>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const a = (i / 8) * Math.PI * 2;
              return `<line x1="60" y1="${top + 6}" x2="${60 + Math.cos(a) * 11}" y2="${top + 6 + Math.sin(a) * 11}" stroke="${c2}" stroke-width="1.2"/>
                <circle cx="${60 + Math.cos(a) * 11}" cy="${top + 6 + Math.sin(a) * 11}" r="1.8" fill="${c1}"/>`;
            }).join("")}</g>`
          : budOf(60, top + 4);
        break;
      case "cactus": {
        const cw = 10 * s + 4;
        return wrap(`
          <path d="M${60 - cw} 105 V${top + 20} q0 -${14 * s + 4} ${cw * 2} 0 V105Z" fill="${c1}"/>
          <path d="M${60 - cw} ${top + 34} h-8 q-6 0 -6 -10M${60 + cw} ${top + 40} h8 q6 0 6 -10" stroke="${c1}" stroke-width="7" fill="none" stroke-linecap="round"/>
          ${bloom ? `<circle cx="60" cy="${top + 14}" r="6" fill="${c2}"/>` : budding ? `<circle cx="60" cy="${top + 14}" r="3.5" fill="${c2}"/>` : ""}`, droop, small);
      }
      case "succulent":
        return wrap(`<g>${[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return `<ellipse cx="${60 + Math.cos(a) * 8 * s}" cy="${98 + Math.sin(a) * 5 * s}" rx="${7 * s + 3}" ry="${5 * s + 2}" fill="${i % 2 ? c1 : c2}" transform="rotate(${a * 57} 60 98)"/>`;
        }).join("")}${bloom ? `<circle cx="60" cy="98" r="4" fill="${c1}"/>` : ""}</g>`, droop, small);
      case "bamboo":
        return wrap(`
          <g stroke="${c1}" stroke-width="${6 * s + 2}" fill="none">
            <path d="M60 105 L60 ${top}" />
            <path d="M44 105 L44 ${top + 26}M76 105 L76 ${top + 34}" stroke-width="${5 * s + 1}" opacity=".85"/>
          </g>
          <path d="M44 ${top + 30} q-12 2 -14 12M44 ${top + 38} q12 2 14 12M76 ${top + 40} q-12 2 -14 12M76 ${top + 48} q12 2 14 12" stroke="${c1}" stroke-width="2" fill="none"/>
          ${bloom || budding ? `<ellipse cx="60" cy="${top - 4}" rx="${fs(4)}" ry="${fs(6)}" fill="${c2}"/>` : ""}`, droop, small);
      case "vine": {
        const pairs = Math.max(1, Math.min(3, Math.round(((h.growth || 0) / h.target) * 3 + 0.7)));
        head = `<path d="M60 100 q0 -20 0 -${H}" stroke="${stem}" stroke-width="4" fill="none"/>
          ${Array.from({ length: pairs }, (_, i) => `<path d="M60 ${top + 18 + i * 16} q-13 -2 -16 -13 q12 -1 16 13Z" fill="${leaf}"/>
            <path d="M60 ${top + 26 + i * 16} q13 -2 16 -13 q-12 -1 -16 13Z" fill="${leaf}"/>`).join("")}
          ${bloom ? `<path d="M60 ${top} q-6 8 0 14 q6 -6 0 -14Z" fill="${c1}"/>
            <circle cx="48" cy="${top + 10}" r="5" fill="${c1}"/><circle cx="72" cy="${top + 14}" r="5" fill="${c1}"/>`
            : budding ? `<circle cx="60" cy="${top + 2}" r="5" fill="${c1}"/>` : ""}`;
        return wrap(head, droop, small);
      }
      case "clover":
        return wrap(`<g>${[[54, 96], [66, 96], [54, 86], [66, 86]].map(([cx, cy]) =>
          `<g fill="${leaf}">${[0, 120, 240].map((a) =>
            `<ellipse cx="${cx}" cy="${cy - 5}" rx="4" ry="6" transform="rotate(${a} ${cx} ${cy})"/>`).join("")}</g>`).join("")}
          ${bloom ? `<circle cx="60" cy="${top + 16}" r="4" fill="${c2}"/>` : budding ? `<circle cx="60" cy="${top + 16}" r="3" fill="${c2}"/>` : ""}</g>`, droop, small);
      case "sensitive":
        return wrap(`<path d="M60 105 V${top + 10}" stroke="${stem}" stroke-width="4"/>
          ${[0, 1, 2, 3, 4].map((i) =>
            `<path d="M60 ${top + 12 + i * 13} l-14 -6M60 ${top + 12 + i * 13} l14 -6" stroke="${stem}" stroke-width="2"/>
             <ellipse cx="42" cy="${top + 4 + i * 13}" rx="8" ry="4" fill="${leaf}"/>
             <ellipse cx="78" cy="${top + 4 + i * 13}" rx="8" ry="4" fill="${leaf}"/>`).join("")}
          ${bloom || budding ? `<circle cx="60" cy="${top}" r="${fs(5)}" fill="${c1}"/>` : ""}`, droop, small);
      case "venus": {
        // 捕蝇草：短茎 + 两张张开的捕虫夹（绿夹、红心、边缘尖刺）
        const trap = (x, y, sc, flip) => `<g transform="translate(${x} ${y}) scale(${flip ? -sc : sc} ${sc})">
          <path d="M0 0 q9 -15 23 -7 q-3 13 -23 7Z" fill="${c1}"/>
          <path d="M0 0 q12 6 23 3 q-6 9 -23 -3Z" fill="${c2}"/>
          <ellipse cx="11.5" cy="-0.6" rx="7.4" ry="3.6" fill="#c62828" opacity=".92"/>
          <path d="M2.4 -2.6 l1.5 -3.6 M7.6 -4.4 l1.2 -3.8 M13 -4.8 l1 -3.6" stroke="${c1}" stroke-width="1.2" fill="none" stroke-linecap="round"/>
        </g>`;
        head = `<path d="M60 106 q-2 -14 -1 -22" stroke="${stem}" stroke-width="4" fill="none" stroke-linecap="round"/>
          <path d="M59 84 q-9 -3 -14 3" stroke="${stem}" stroke-width="3" fill="none"/>
          <path d="M59 84 q9 -3 14 3" stroke="${stem}" stroke-width="3" fill="none"/>
          ${trap(46, 87, (0.85 + 0.45 * s).toFixed(2), false)}
          ${trap(74, 87, (0.85 + 0.45 * s).toFixed(2), true)}
          <path d="M60 106 q-15 3 -18 13 M60 106 q15 3 18 13" stroke="${leaf}" stroke-width="3" fill="none"/>`;
        break;
      }
      case "nepenthes": {
        // 猪笼草：弯垂的藤茎挂着带盖的捕虫笼
        const jug = (x, y, sc) => `<g transform="translate(${x} ${y}) scale(${sc})">
          <path d="M0 0 q0 5 -3 9 q-8 4 -7 13 q1 9 9 9 q8 0 9 -9 q1 -9 -5 -13 q-2 -4 -3 -9Z" fill="${c1}"/>
          <ellipse cx="-1" cy="9" rx="8" ry="3" fill="${c2}"/>
          <path d="M-9 9 q8 -4 17 0" stroke="#fff" stroke-width="1.2" opacity=".5" fill="none"/>
          <ellipse cx="2" cy="6.4" rx="6.4" ry="2.8" fill="${c2}" transform="rotate(-14 2 6.4)"/>
          <path d="M0 5.4 q4 -5 9 -5.4" stroke="${c1}" stroke-width="2" fill="none"/>
          <circle cx="3" cy="22" r="1.4" fill="${c2}" opacity=".7"/>
        </g>`;
        head = `<path d="M60 106 q-3 -26 3 -42" stroke="${stem}" stroke-width="3.6" fill="none" stroke-linecap="round"/>
          <path d="M62 84 q11 0 14 8" stroke="${stem}" stroke-width="2.6" fill="none"/>
          ${jug(76, 92, (0.8 + 0.4 * s).toFixed(2))}
          <path d="M61 66 q-11 -2 -14 8" stroke="${stem}" stroke-width="2.4" fill="none"/>
          ${jug(46, 78, (0.62 + 0.3 * s).toFixed(2))}
          <path d="M58 96 q-14 0 -16 10 M62 92 q13 -2 15 8" stroke="${leaf}" stroke-width="2.8" fill="none"/>`;
        break;
      }
      case "grass":
      default:
        head = `<g>${[0, 1, 2, 3, 4, 5].map((i) => {
          const x = 60 + (i - 2.5) * 7;
          return `<path d="M${x} 104 q${(i - 2.5) * 4} -${H * 0.6} ${(i - 2.5) * 6} -${H * 0.75}" stroke="${i % 2 ? c1 : leaf}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
        }).join("")}${bloom || budding ? `<circle cx="60" cy="${top + 8}" r="${fs(4.5)}" fill="${c2}"/>` : ""}</g>`;
        break;
    }
    const body = `
      <path d="M60 105 q-3 -${H * 0.5} 0 -${H}" stroke="${stem}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M60 ${105 - H * 0.35} q-14 -2 -17 -14 q13 -1 17 14Z" fill="${leaf}"/>
      <path d="M60 ${105 - H * 0.55} q14 -2 17 -14 q-13 -1 -17 14Z" fill="${leaf}"/>
      ${head}`;
    return wrap(body, droop, small);
  }
  function petals(cx, cy, r, n, c1, c2, center) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      s += `<ellipse cx="${cx + Math.cos(a) * r * 0.7}" cy="${cy + Math.sin(a) * r * 0.7}" rx="${r * 0.55}" ry="${r * 0.4}" fill="${i % 2 ? c1 : c2}" transform="rotate(${(a * 180) / Math.PI} ${cx + Math.cos(a) * r * 0.7} ${cy + Math.sin(a) * r * 0.7})"/>`;
    }
    return s + `<circle cx="${cx}" cy="${cy}" r="${r * 0.45}" fill="${center || "#f7d354"}"/>`;
  }
  function wrap(inner, droop, small) {
    // 地图格子里的植物用更紧的取景（去掉四周大片留白），小格里也看得清；
    // 地图上不画阴影（苗圃就是地面），列表卡片和详情页保留阴影
    const vb = small ? "24 4 72 116" : "0 0 120 130";
    const shadow = small ? "" : '<ellipse cx="60" cy="110" rx="32" ry="6" fill="#3e2f23" opacity=".16"/>';
    return `<svg class="plant-svg${small ? " is-small" : ""}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${shadow}
      <g transform="rotate(${droop} 60 105)">${inner}</g>
    </svg>`;
  }

  /* ============ 地图 ============ */
  const activeMap = () => state.maps.find((m) => m.id === state.activeMapId) || state.maps[0];
  const cellOf = (habitId) => {
    for (const m of state.maps) for (const k in m.cells) {
      const c = m.cells[k];
      if (c && c.type === "plant" && c.habitId === habitId) return { map: m, cell: +k };
    }
    return null;
  };
  const itemCell = (itemUid) => {
    for (const m of state.maps) for (const k in m.cells) {
      const c = m.cells[k];
      if (c && c.type === "decor" && c.itemUid === itemUid) return { map: m, cell: +k };
    }
    return null;
  };
  function removeCellOf(habitId) {
    for (const m of state.maps) for (const k in m.cells) {
      const c = m.cells[k];
      if (c && c.type === "plant" && c.habitId === habitId) delete m.cells[k];
    }
  }
  const freeCellIn = (m) => {
    for (let i = 0; i < CELLS; i++) if (!m.cells[i]) return i;
    return -1;
  };
  const mapIsFull = (m) => freeCellIn(m) === -1;
  /* 放不下就自动开辟新地图 */
  function ensureRoom() {
    let m = activeMap();
    if (!mapIsFull(m)) return m;
    m = newMap(state.maps.length + 1);
    state.maps.push(m);
    state.activeMapId = m.id;
    toast(`🗺 「${state.maps[state.maps.length - 2].name}」已经满了，为你开辟了「${m.name}」`, "good");
    return m;
  }
  let placing = null; // {kind:'plant'|'decor', habitId?, itemUid?, decorId?}
  let view = "list"; // 主页面只有列表；'map' 仅在花园覆盖层打开时

  /* 花园覆盖层开关：主页面只有列表，花园要点「进入花园」才看到 */
  function setGardenOpen(open, silent) {
    $("#gardenOverlay").hidden = !open;
    view = open ? "map" : "list";
    if (open) {
      render();
      $("#gardenOverlay").scrollTop = 0;
    } else if (placing) {
      placing = null; // 离开花园就取消安放，避免回列表后状态悬空
      toast("已退出花园，安放已取消", "");
    }
    if (!silent) render();
  }
  /* 进入安放模式：自动打开花园 + 确保有空位 */
  function startPlacing(p, hint) {
    placing = p;
    setGardenOpen(true, true);
    ensureRoom();
    render();
    if (hint) toast(hint, "good");
  }

  /* ============ 渲染 ============ */
  function render() {
    simulate();
    for (const h of state.habits) checkWilt(h);
    $("#dewDisplay").textContent = `💧 ${state.dew}`;
    $("#todayKeyLabel").textContent = `${gardenDate().getMonth() + 1} 月 ${gardenDate().getDate()} 日 · ${nextResetText()}`;
    renderToday();
    renderMap();
    renderTray();
    renderList();
    renderSkinPicker();
    $("#gardenOverlay").hidden = view !== "map";
  }

  function renderToday() {
    const list = $("#todayList");
    const gd = gardenDate();
    const due = state.habits.filter((h) => isScheduled(h, gd) && !isArchived(h));
    let done = 0;
    list.innerHTML = "";
    if (!state.habits.length) {
      list.innerHTML = `<div class="empty">花园还空着，点右上角「＋ 种下习惯」开始吧 🌱</div>`;
    } else if (!due.length) {
      list.innerHTML = `<div class="empty">今天没有计划中的打卡，休息也是坚持的一部分 🌙</div>`;
    }
    for (const h of due) {
      const ok = !!h.records[todayKey()];
      if (ok) done++;
      const plant = h.plantId ? PLANT_BY_ID[h.plantId] : null;
      const el = document.createElement("div");
      const paused = pauseState(h).on;
      const bornToday = (h.createdAt || h.plantedAt || "") >= todayKey();
      el.className = "today-item" + (ok ? " done" : "") + (plant ? "" : " no-plant") + (paused ? " paused" : "");
      el.innerHTML = `
        <button class="check-btn" type="button" aria-pressed="${ok}"
          aria-label="${ok ? "取消" : ""}打卡「${esc(h.name)}」">${ok ? "✓" : ""}</button>
        <span class="name">${esc(h.name)}</span>
        <span class="meta">${paused
          ? `⏸ 暂停中 · ${pauseState(h).until} 恢复（期间不用打卡）`
          : isGraduated(h)
            ? `🎓 已毕业 · 打卡只为花露 · 🔥${streak(h)}`
            : plant
              ? `${plant.name} · 🔥${streak(h)}${(h.season || 1) > 1 ? ` · 第 ${h.season} 季` : ""}${bornToday && !ok ? " · 🌱 今日新种，打卡暂不发花露" : ""}`
              : `🥀 还没有植物 · 打卡只记习惯，<button class="link-btn replay-btn" type="button">种一株</button>`}</span>`;
      el.querySelector(".check-btn").disabled = paused && !ok; // 未打卡的暂停日禁用；已打卡仍可取消
      el.querySelector(".check-btn").onclick = () => (ok ? unCheckIn(h) : checkIn(h));
      const rb = el.querySelector(".replay-btn");
      if (rb) rb.onclick = (ev) => { ev.stopPropagation(); openHabitDialog(h, true); };
      list.appendChild(el);
    }
    $("#todaySummary").textContent = due.length ? `（${done}/${due.length}）` : "";
  }

  function renderMap() {
    const m = activeMap();
    const wrap = $("#gardenMap");
    const skin = SKIN_BY_ID[m.skin] || MAP_SKINS[0];
    // 苗圃底图：程序手绘（土垄与 9×9 格子同一套坐标，永远对得齐）
    wrap.style.background = skin.bg;
    wrap.style.boxShadow = "none";
    wrap.style.setProperty("--tile", "transparent");
    wrap.style.setProperty("--line", "transparent");
    wrap.classList.toggle("is-placing", !!placing);
    wrap.classList.toggle("has-base", true);
    // 正面平视网格（植物大战僵尸花园式）：9×9 直排，行越靠前层级越高
    const gridPos = (i) => {
      const r = Math.floor(i / MAP_SIZE), c = i % MAP_SIZE;
      return {
        x: ((PLOT.x + ((c + 0.5) / MAP_SIZE) * PLOT.w) / 900) * 100,
        y: ((PLOT.y + ((r + 0.5) / MAP_SIZE) * PLOT.h) / 900) * 100,
        depth: r,
      };
    };
    wrap.innerHTML = `<svg class="nursery-layer" viewBox="0 0 900 900" preserveAspectRatio="none" aria-hidden="true">${nurserySVG(skin)}</svg>`;
    for (let i = 0; i < CELLS; i++) {
      const c = m.cells[i];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell" + (c ? " is-taken" : "");
      cell.dataset.cell = i;
      if (c && c.type === "plant") {
        const h = state.habits.find((x) => x.id === c.habitId);
        if (!h) { delete m.cells[i]; } // 坏数据：格子指向不存在的习惯，清掉但依然占一个格位
        else {
          const plant = h.plantId ? PLANT_BY_ID[h.plantId] : null;
          const workers = state.animals.filter((a) => a.assignedHabit === h.id);
          const extra = workers.length > 2 ? `<sup>+${workers.length - 2}</sup>` : "";
          const ps = pauseState(h);
          const state0 = h.wilted ? `枯萎中 ${h.reviveProgress || 0}/${RULES.reviveTimes}`
            : ps.on ? `暂停到 ${ps.until}`
            : isGraduated(h) ? "已毕业（免枯萎）"
            : "生长中";
          cell.className = "cell is-taken";
          const workerSprites = workers.slice(0, 2).map((a, wi) =>
            `<span class="worker-sprite ${wi % 2 ? "right" : "left"}" style="animation-delay:${(wi * 0.9).toFixed(1)}s"
              title="${ANIMAL_BY_ID[a.catId]?.name || ""}正在照料">${animalSVG(a.catId, wi % 2 ? 1 : -1)}</span>`).join("");
          cell.innerHTML = `${plant ? plantSVG(plant, h, true) : "💀"}
            ${workerSprites}
            ${workers.length > 2 ? `<span class="cell-workers">+${workers.length - 2}</span>` : ""}
            ${h.wilted ? '<span class="cell-flag">🥀</span>'
              : isGraduated(h) ? `<span class="cell-flag">🎓${(h.season || 1) > 1 ? `<sup>${h.season}</sup>` : ""}</span>`
              : ps.on ? '<span class="cell-flag">⏸</span>' : ""}`;
          cell.setAttribute("aria-label", `${h.name}，${plant ? plant.name : "植物已枯死"}，${state0}`);
          cell.title = `${h.name}｜${plant ? plant.name : "已枯死"}｜${state0}${workers.length ? `｜${workers.length} 只小动物在照料` : ""}`;
          cell.onclick = () => (placing ? placeAt(i) : openPlantDialog(h.id));
          wrap.appendChild(cell);
          continue;
        }
      } else if (c && c.type === "decor") {
        const item = state.decorItems.find((x) => x.uid === c.itemUid);
        const d = item ? DECOR_CATALOG.find((x) => x.id === item.decorId) : null;
        if (!d) { delete m.cells[i]; } // 坏数据：装饰不存在
        else {
          cell.className = "cell is-taken";
          cell.innerHTML = `<span class="cell-decor-svg">${decorSVG(d.id)}</span>`;
          cell.setAttribute("aria-label", `${d.name}（装饰）`);
          cell.title = `${d.name}（装饰，点击可收回）`;
          cell.onclick = () => (placing ? placeAt(i) : openDecorMenu(i));
          wrap.appendChild(cell);
          continue;
        }
      }
      // 空格子（含刚被清理掉的坏格子，保持 9×9 不错位）
      cell.className = "cell";
      cell.innerHTML = placing ? '<span class="cell-plus">＋</span>' : "";
      cell.setAttribute("aria-label", "空格子");
      cell.onclick = () => {
        if (placing) return placeAt(i);
        // 有待安放的东西才提示怎么放，否则这个空格就是空的，不打扰
        const pending = state.habits.some((x) => x.plantId && !cellOf(x.id)) ||
          state.decorItems.some((it) => !itemCell(it.uid));
        if (pending) toast("先在下方「待安放」里选一株植物或一件装饰，再点这里的空格", "bad");
      };
      wrap.appendChild(cell);
    }
    // 给每个格子按直排网格定位（与苗圃土垄同一套坐标）
    for (const el of wrap.children) {
      if (!el.dataset || el.dataset.cell === undefined) continue; // 跳过苗圃 SVG 层
      const pos = gridPos(Number(el.dataset.cell));
      el.classList.add("grid-cell");
      el.style.left = pos.x.toFixed(2) + "%";
      el.style.top = pos.y.toFixed(2) + "%";
      el.style.zIndex = String(10 + pos.depth);
    }
    // 地图标签
    $("#mapTabs").innerHTML = state.maps.map((mm) => {
      const used = Object.keys(mm.cells).length;
      return `<button type="button" class="map-tab ${mm.id === m.id ? "is-active" : ""}" data-map="${mm.id}">
        ${esc(mm.name)} <small>${used}/${CELLS}</small></button>`;
    }).join("") + `<button type="button" class="map-tab map-add" id="addMapBtn" title="新建一张空地图">＋</button>`;
    // 切换地图时保留"正在安放"状态（这样才能把植物挪到另一张地图上）
    $$("#mapTabs [data-map]").forEach((b) => b.onclick = () => {
      state.activeMapId = b.dataset.map; save(); render();
      if (placing) toast("已切到这张地图，继续点一个空格完成安放", "good");
    });
    $("#addMapBtn").onclick = () => {
      const mm = newMap(state.maps.length + 1);
      state.maps.push(mm); state.activeMapId = mm.id;
      save(); render();
      toast(`🗺 已新建「${mm.name}」${placing ? "，继续点一个空格完成安放" : ""}`, "good");
    };
    // 改名 / 删除当前地图
    const delBtn = $("#deleteMapBtn");
    delBtn.disabled = state.maps.length <= 1;
    delBtn.title = state.maps.length <= 1 ? "至少要保留一张地图" : `删除「${m.name}」`;
    delBtn.onclick = () => {
      if (state.maps.length <= 1) return toast("至少要保留一张地图", "bad");
      const plants = Object.values(m.cells).filter((c) => c && c.type === "plant").length;
      const decors = Object.values(m.cells).filter((c) => c && c.type === "decor").length;
      const staff = state.animals.filter((a) => a.mapId === m.id).length;
      askConfirm(
        `删除「${m.name}」？`,
        `地图不能被恢复。${plants ? `上面的 ${plants} 株植物` : "上面的植物"}会转入下方「待安放」等重新安置${decors ? `，${decors} 件装饰同样转入待安放` : ""}${staff ? `；${staff} 位园丁会被派到其他花园` : ""}。`,
        () => {
          state.maps = state.maps.filter((x) => x.id !== m.id);
          const first = state.maps[0];
          // 在别处没家的园丁改派到剩下的第一张地图
          for (const a of state.animals) {
            if (a.mapId === m.id || !state.maps.find((x) => x.id === a.mapId)) {
              a.mapId = first.id; a.assignedHabit = null;
            }
          }
          state.activeMapId = first.id;
          placing = null;
          save(); render();
          toast(`🗑 已删除「${m.name}」${plants ? `，${plants} 株植物已转入待安放` : ""}`, plants ? "bad" : "");
        });
    };
    $("#placeHint").hidden = !placing;
    if (placing) {
      const nm = state.habits.find((h) => h.id === placing.habitId)?.name;
      if (placing.kind === "decor") {
        $("#placeHint").textContent = `正在安放「${DECOR_CATALOG.find((d) => d.id === placing.decorId)?.name}」：点击一个空格放下`;
      } else {
        const onMap = !!cellOf(placing.habitId);
        $("#placeHint").textContent = onMap
          ? `正在移动「${nm}」：点击目标格子`
          : `正在种下「${nm}」：点击一个空格把它种下`;
      }
    }
  }

  function renderSkinPicker() {
    const m = activeMap();
    $("#skinPicker").innerHTML = MAP_SKINS.filter((s) => m.skins.includes(s.id)).map((s) =>
      `<button type="button" class="skin-dot ${s.id === m.skin ? "is-active" : ""}" data-skin="${s.id}"
        title="${s.name}" style="background:${s.bg}"></button>`).join("");
    $$("#skinPicker [data-skin]").forEach((b) => b.onclick = () => {
      m.skin = b.dataset.skin; save(); render();
      toast(`🎨 已换成「${SKIN_BY_ID[m.skin].name}」`, "good");
    });
  }

  function renderTray() {
    const tray = $("#tray");
    const unplaced = state.habits.filter((h) => h.plantId && !cellOf(h.id));
    const placedDecors = new Set();
    for (const m of state.maps) for (const k in m.cells) {
      const c = m.cells[k];
      if (c && c.type === "decor") placedDecors.add(c.itemUid);
    }
    const unplacedDecors = state.decorItems.filter((it) => !placedDecors.has(it.uid));
    if (placing) {
      tray.innerHTML = `<span class="tray-hint">点地图上的空格放下，或 <button class="link-btn" id="cancelPlace">取消</button></span>`;
      $("#cancelPlace").onclick = () => { placing = null; render(); };
      return;
    }
    // 没有待安放的东西就不显示任何说明（用户要求：不要这句注释）
    if (!unplaced.length && !unplacedDecors.length) {
      tray.innerHTML = "";
      tray.hidden = true;
      return;
    }
    tray.hidden = false;
    tray.innerHTML = `<span class="tray-hint">待安放：</span>` +
      unplaced.map((h) => {
        const p = PLANT_BY_ID[h.plantId];
        return `<button type="button" class="tray-item" data-tray-habit="${h.id}">
          <span class="tray-icon">${plantIcon(h.plantId)}</span>${p ? p.name : "植物"}·${esc(h.name)}</button>`;
      }).join("") +
      unplacedDecors.map((it) => {
        const d = DECOR_CATALOG.find((x) => x.id === it.decorId);
        return `<button type="button" class="tray-item" data-tray-decor="${it.uid}">${d ? d.emoji + d.name : "装饰"}</button>`;
      }).join("");
    $$("#tray [data-tray-habit]").forEach((b) => b.onclick = () =>
      startPlacing({ kind: "plant", habitId: b.dataset.trayHabit }));
    $$("#tray [data-tray-decor]").forEach((b) => b.onclick = () =>
      startPlacing({ kind: "decor", itemUid: b.dataset.trayDecor, decorId: state.decorItems.find((x) => x.uid === b.dataset.trayDecor)?.decorId }));
  }

  function placeAt(cellIdx) {
    const m = activeMap();
    if (m.cells[cellIdx]) return toast("这个格子已经有东西了", "bad");
    if (placing.kind === "plant") {
      removeCellOf(placing.habitId);
      m.cells[cellIdx] = { type: "plant", habitId: placing.habitId };
      toast(`🌱 已把「${state.habits.find((h) => h.id === placing.habitId).name}」安放在这里`, "good");
    } else if (placing.kind === "decor") {
      m.cells[cellIdx] = { type: "decor", itemUid: placing.itemUid };
      toast("🪑 装饰已放下", "good");
    }
    placing = null;
    save();
    ensureRoom(); // 满了自动开新地图
    render();
  }

  function openDecorMenu(cellIdx) {
    const m = activeMap();
    const c = m.cells[cellIdx];
    if (!c || c.type !== "decor") return;
    const d = DECOR_CATALOG.find((x) => x.id === state.decorItems.find((i) => i.uid === c.itemUid)?.decorId);
    if (confirm(`「${d ? d.name : "装饰"}」\n\n确定：收回这件装饰（放回待安放）\n取消：先不动它`)) {
      delete m.cells[cellIdx];
      save(); render();
      toast("已收回装饰");
    }
  }

  function renderList() {
    const grid = $("#gardenGrid");
    grid.innerHTML = "";
    if (!state.habits.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">还没有植物。每个习惯都会在花园里长成一株属于它的植物。</div>`;
      return;
    }
    for (const h of state.habits) {
      const plant = h.plantId ? PLANT_BY_ID[h.plantId] : null;
      const stage = plant ? stageOf(h) : null;
      const shown = Math.min(h.growth || 0, h.target);
      const pct = plant ? Math.min(100, Math.round((shown / h.target) * 100)) : 0;
      const workers = state.animals.filter((a) => a.assignedHabit === h.id);
      const cell = cellOf(h.id);
      const ps = pauseState(h);
      const grad = isGraduated(h);
      const arch = isArchived(h);
      const card = document.createElement("div");
      card.className = "plant-card" + (h.wilted ? " wilted" : "") + (grad ? " bloomed" : "") + (arch ? " archived" : "");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${h.name}，${plant ? plant.name + "，" + stage.name : "植物已枯死"}，点击查看详情`);
      // 标签按优先级排序，最多同时显示 2 个（其余信息进悬浮提示与详情页）
      const allTags = [];
      if (arch) allTags.push('<span class="tag arch-tag">🗄 已归档</span>');
      if (h.wilted) allTags.push(`<span class="tag wilt-tag">🥀 枯萎 ${h.reviveProgress || 0}/${RULES.reviveTimes}</span>`);
      if (ps.on) allTags.push(`<span class="tag pause-tag">⏸ 暂停到 ${ps.until}</span>`);
      if (!arch && plant && !cell) allTags.push('<span class="tag unplaced-tag">📍 未安放</span>');
      if (!arch && !plant) allTags.push('<span class="tag dead-tag">💀 需补种</span>');
      if (grad) allTags.push(`<span class="tag bloom-tag">🎓 已毕业${(h.season || 1) > 1 ? ` ✦${h.season}` : ""}</span>`);
      const extraTags = allTags.length - 2;
      if (extraTags > 0) card.title = `还有 ${extraTags} 个状态标签，点开查看详情`;
      card.innerHTML = `
        ${allTags.slice(0, 2).join("")}
        <div class="pot">${plant ? plantSVG(plant, h) : `<svg class="plant-svg" viewBox="0 0 120 130"><path d="M52 104 l8 -16M68 104 l-8 -16M60 104 l0 -12" stroke="#9e9e9e" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`}</div>
        <h4>${esc(h.name)}</h4>
        <div class="stage-label">${plant ? `${plant.name} · ${stage.name}` : (arch ? "植物已枯死" : "还没有植物")}${arch ? " · 已归档" : cell ? ` · ${esc(cell.map.name)}` : ""}</div>
        ${plant ? statChips(h) : ""}
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="plant-stats"><span>${plant ? `${Math.round(shown)}/${h.target} 生长` : "—"}</span><span>🔥${streak(h)}</span></div>
        <div class="workers">${workers.map((a) => `<span title="${ANIMAL_BY_ID[a.catId]?.name || ""}正在照料">${ANIMAL_BY_ID[a.catId]?.emoji || ""}</span>`).join("")}</div>`;
      if (arch) {
        const left = RULES.archiveDays - keyDiff(h.archivedAt, todayKey());
        const bar = document.createElement("div");
        bar.className = "arch-actions";
        bar.innerHTML = left >= 0
          ? `<span>还剩 ${left} 天翻案期</span><button class="btn btn-sm btn-primary" type="button">翻案</button><button class="btn btn-sm btn-ghost" type="button">重新开始</button>`
          : `<span>已超过翻案期</span><button class="btn btn-sm btn-primary" type="button">重新开始</button>`;
        const btns = bar.querySelectorAll("button");
        if (left >= 0) {
          btns[0].onclick = (ev) => { ev.stopPropagation(); unarchive(h); };
          btns[1].onclick = (ev) => { ev.stopPropagation(); restartHabit(h); };
        } else btns[0].onclick = (ev) => { ev.stopPropagation(); restartHabit(h); };
        card.appendChild(bar);
      }
      card.onclick = () => openPlantDialog(h.id);
      card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlantDialog(h.id); } };
      grid.appendChild(card);
    }
  }

  const statChips = (h) => `
    <div class="stat-chips">
      <span class="chip ${h.water < 30 ? "low" : ""}" title="水分">💧${Math.round(h.water)}</span>
      <span class="chip ${h.fert < 30 ? "low" : ""}" title="养分">🌱${Math.round(h.fert)}</span>
      <span class="chip ${h.pest > 50 ? "low" : ""}" title="虫害">🐛${Math.round(h.pest)}</span>
    </div>`;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ============ 植物详情 ============ */
  function openPlantDialog(habitId) {
    const h = state.habits.find((x) => x.id === habitId);
    if (!h) return;
    if (isArchived(h)) return toast("这个习惯已归档，可以在列表视图里「翻案」或「重新开始」", "bad");
    const plant = h.plantId ? PLANT_BY_ID[h.plantId] : null;
    const dlg = $("#plantDialog");
    const bars = (label, val, bad) => `
      <div class="meter"><span>${label}</span>
        <div class="meter-track"><div class="meter-fill ${bad ? "bad" : ""}" style="width:${Math.round(val)}%"></div></div>
        <b>${Math.round(val)}</b></div>`;
    const cell = cellOf(h.id);
    $("#plantDetail").innerHTML = `
      <div class="pd-visual">${plant ? plantSVG(plant, h) : "💀"}</div>
      <div class="pd-info">
        <p class="pd-habit">这是你「${esc(h.name)}」习惯的植株${(h.season || 1) > 1 ? `（第 ${h.season} 季）` : ""}</p>
        <h3>${plant ? esc(plant.name) : "植物已枯死"}</h3>
        ${plant && plant.cat === "花"
          ? `<p class="pd-intro">${esc(plant.lang[0])}</p><p class="pd-lang">💌 ${esc(plant.lang[1])}</p>`
          : plant ? `<p class="pd-lang">${esc(plant.lang[1])}</p>`
            : `<p class="pd-lang">连续枯萎三次，它永远地留在了昨天。为「${esc(h.name)}」重新种一株吧。</p>
               <button class="btn btn-primary" id="replantBtn" type="button">重新种植</button>`}
        ${plant ? `
        <p class="pd-where">位置：${cell ? `${esc(cell.map.name)} 第 ${Math.floor(cell.cell / MAP_SIZE) + 1} 行第 ${(cell.cell % MAP_SIZE) + 1} 列` : "尚未安放到地图"}
          ${(h.season || 1) > 1 ? ` · 第 ${h.season} 季` : ""}
          ${pauseState(h).on ? ` · ⏸ 暂停到 ${pauseState(h).until}` : ""}</p>
        ${isGraduated(h) ? `<p class="pd-graduated">🎓 已毕业（${h.target} 次目标达成）：不再枯萎、不掉状态</p>` : ""}
        ${h.wilted ? `<p class="wilt-note">🥀 枯萎中：连续打卡复活（${h.reviveProgress || 0}/${RULES.reviveTimes}），第 ${h.wiltStreak || 1} 次枯萎，第 3 次将永久死亡</p>` : ""}
        ${bars("💧 水分", h.water, h.water < 30)}
        ${bars("🌱 养分", h.fert, h.fert < 30)}
        ${bars("🐛 虫害", h.pest, h.pest > 50)}
        <div class="pd-tools">
          ${TOOL_CATALOG.map((t) => `
            <button class="btn btn-sm tool-btn" type="button" data-tool="${t.id}" ${!state.tools[t.id] ? "disabled" : ""}>
              ${t.emoji}${t.name} ×${state.tools[t.id] || 0}</button>`).join("")}
        </div>
        <p class="pd-hint">打卡会自动满状态照料；道具立即回满对应值。</p>` : ""}
      </div>`;
    const rb = $("#replantBtn");
    if (rb) rb.onclick = () => { dlg.close(); openHabitDialog(h, true); };
    // 毕业（满绽）后：让用户选升阶或收获
    const grad = isGraduated(h);
    $("#graduateActions").hidden = !grad;
    $("#graduateHint").hidden = !grad;
    if (grad) {
      $("#seasonUpBtn").textContent = `继续升阶（下一季 ${nextTarget(h.target, (h.season || 1) + 1)} 次）`;
      $("#seasonUpBtn").onclick = () => { dlg.close(); seasonUp(h); };
      $("#harvestBtn").onclick = () => {
        const st = streak(h);
        const bonus = Math.floor(st / RULES.streakPerDays) * RULES.streakPerDew;
        dlg.close();
        openHabitDialog(h, true, "harvest");
        toast(`🏆 收获会记入图鉴，连击 ${st} 天折算 +${bonus}💧 后清零；选好新植株就完成`, "good");
      };
    }
    $("#moveFromPlantBtn").hidden = !plant;
    $("#moveFromPlantBtn").onclick = () => {
      dlg.close();
      startPlacing({ kind: "plant", habitId: h.id }, "点击地图上一个空格，把这株植物移过去");
    };
    $("#editFromPlantBtn").onclick = () => { dlg.close(); openHabitDialog(h); };
    dlg.querySelectorAll(".tool-btn").forEach((b) => b.onclick = () => useTool(b.dataset.tool, h));
    dlg.showModal();
  }

  function useTool(toolId, h) {
    const tool = TOOL_CATALOG.find((t) => t.id === toolId);
    if (!tool) return;
    if (!(state.tools[toolId] > 0)) return toast("先去商店购买这个道具", "bad");
    state.tools[toolId]--;
    if (tool.target === "water") h.water = 100;
    if (tool.target === "fert") h.fert = 100;
    if (tool.target === "pest") h.pest = 0;
    toast(`${tool.emoji} 已对「${h.name}」使用${tool.name}`, "good");
    save();
    openPlantDialog(h.id);
    render();
  }

  /* ============ 习惯对话框 ============ */
  const habitDialog = $("#habitDialog");
  function fillPlantSelect(sel, selected) {
    sel.innerHTML = "";
    for (const p of PLANT_CATALOG) {
      const unlocked = state.unlockedPlants.includes(p.id);
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = unlocked ? `${p.name}${p.cat === "花" ? " 🌸" : ""}` : `${p.name}（💧${p.cost} 商店解锁）`;
      sel.appendChild(o);
    }
    sel.value = selected || "sprout";
  }
  let harvestMode = null; // 收获流程：选好新株才真正结算
  function openHabitDialog(habit, replantMode, mode) {
    formError("");
    harvestMode = mode === "harvest" ? (habit ? habit.id : null) : null;
    fillPlantSelect($("#habitPlant"), habit && habit.plantId ? habit.plantId : "sprout");
    $("#dialogTitle").textContent = habit
      ? (harvestMode ? `收获「${habit.name}」，再种一株新的`
        : replantMode || !habit.plantId ? `为「${habit.name}」重新种植` : "编辑习惯")
      : "种下一个新习惯";
    $("#habitId").value = habit ? habit.id : "";
    $("#habitName").value = habit ? habit.name : "";
    $("#habitSchedule").value = habit ? habit.schedule : "daily";
    $("#weekdayPicker").hidden = !(habit && habit.schedule === "custom");
    $$("#weekdayPicker input").forEach((c) => { c.checked = habit ? (habit.weekdays || []).includes(Number(c.value)) : false; });
    const selT = $("#habitTarget");
    if (habit && ![...selT.options].some((o) => Number(o.value) === habit.target)) {
      const o = document.createElement("option");
      o.value = habit.target;
      o.textContent = `${habit.target} 次（当前季）`;
      selT.appendChild(o);
    }
    selT.value = habit ? habit.target : 21;
    selT.disabled = !!(habit && habit.plantId && !harvestMode); // 已种下的季节目标不可手改（收获时也禁用）
    // 暂停只在"已经种下的习惯"里出现：新建时不该有（第一次种下谈不上暂停）
    const canPause = !!(habit && habit.plantId && !harvestMode);
    $("#pauseField").hidden = !canPause;
    const ps = habit ? pauseState(habit) : { on: false };
    $$("#pausePicker input").forEach((r) => {
      r.checked = r.value === "0";
      if (canPause && ps.on && habit.pauseChosen === Number(r.value)) r.checked = true;
    });
    $("#pauseNote").textContent = ps.on
      ? `正在暂停中，${ps.until} 恢复。重新选一个天数会从现在起重新计算。`
      : "暂停期间不会判枯萎、不掉状态、连击冻结，但也不能打卡。";
    refreshTargetEstimate();
    $("#deleteHabitBtn").hidden = !habit;
    $("#replantHint").hidden = !(habit && (replantMode || !habit.plantId));
    $("#saveHabitBtn").textContent = habit
      ? (harvestMode ? "收获并种下" : habit.plantId ? "保存" : "重新种下")
      : "种下";
    habitDialog.showModal();
  }
  $("#addHabitBtn").onclick = () => openHabitDialog(null);
  habitDialog.addEventListener("close", () => { harvestMode = null; });

  /* 目标 N 次 → 按频率折算大约多少周 */
  function estimateWeeks(h, times) {
    const pw = Math.max(1, perWeek(h));
    const weeks = times / pw;
    if (weeks <= 1.05) return "按你的频率，大约 1 周就能达成";
    const months = weeks / 4.35;
    return `按你的频率（每周 ${pw} 次），大约 ${weeks < 8 ? `${Math.round(weeks)} 周` : `${months.toFixed(1)} 个月`}达成`;
  }
  function refreshTargetEstimate() {
    const el = $("#targetEstimate");
    if (!el) return;
    const fake = {
      schedule: $("#habitSchedule").value,
      weekdays: $$("#weekdayPicker input:checked").map((c) => Number(c.value)),
    };
    const id = $("#habitId").value;
    const cur = state.habits.find((x) => x.id === id);
    const times = Number($("#habitTarget").value);
    const season = cur && cur.plantId ? (cur.season || 1) : 1;
    el.textContent = `${estimateWeeks(fake, times)}${season > 1 ? ` · 这是第 ${season} 季` : ""}`;
  }
  $("#habitTarget").onchange = refreshTargetEstimate;
  $("#habitPlant").onchange = refreshTargetEstimate;
  $("#weekdayPicker").onchange = refreshTargetEstimate;
  $("#habitSchedule").onchange = (e) => {
    $("#weekdayPicker").hidden = e.target.value !== "custom";
    refreshTargetEstimate();
  };

  $("#habitForm").onsubmit = (e) => {
    e.preventDefault();
    formError("");
    const id = $("#habitId").value;
    const weekdays = $$("#weekdayPicker input:checked").map((c) => Number(c.value));
    if ($("#habitSchedule").value === "custom" && !weekdays.length) return formError("自定义频率至少要选一天。");
    const name = $("#habitName").value.trim();
    if (!name) return formError("给这个习惯起个名字吧。");
    const plantId = $("#habitPlant").value;
    if (!state.unlockedPlants.includes(plantId)) {
      const p = PLANT_BY_ID[plantId];
      if (state.dew < p.cost) return formError(`花露不足：解锁「${p.name}」需要 💧${p.cost}，你现在有 💧${state.dew}。可以去商店或用打卡慢慢攒。`);
      state.dew -= p.cost;
      state.totals.expense -= p.cost;
      if (p.cost > 0) ledger(-p.cost, `解锁植物「${p.name}」`);
      state.unlockedPlants.push(plantId);
      toast(`🔓 花露 -${p.cost}，「${p.name}」已解锁`, "good");
    }
    // 暂停设置：只在"编辑已种下的习惯"时才有这一栏
    const pauseShown = !$("#pauseField").hidden;
    const pauseDays = pauseShown ? Number(($$("#pausePicker input:checked")[0] || {}).value || 0) : 0;
    const pauseRange = pauseDays > 0 ? { from: todayKey(), to: keyAdd(todayKey(), pauseDays - 1) } : null;
    if (id) {
      const h = state.habits.find((x) => x.id === id);
      if (pauseShown) {
        const existing = (h.pauses || []).find((p) => p.to >= todayKey()); // 仍在生效的暂停
        if (pauseRange && existing) {
          // 已在暂停中改时长：以原开始日为基准重算 N 天（可延长也可缩短）
          existing.to = keyAdd(existing.from, pauseDays - 1);
          h.pauseChosen = pauseDays;
          if (existing.to < todayKey()) {
            h.pauses = h.pauses.filter((p) => p.to >= todayKey());
            h.pauseChosen = 0;
            toast(`▶ 暂停天数缩短，「${h.name}」已立即恢复照料`, "good");
          } else {
            toast(`⏸ 「${h.name}」暂停已调整为 ${existing.to} 恢复`, "good");
          }
        } else if (pauseRange && !existing) {
          h.pauses = (h.pauses || []).filter((p) => p.to >= pauseRange.from);
          h.pauses.push(pauseRange);
          h.pauseChosen = pauseDays;
          toast(`⏸ 「${h.name}」已暂停到 ${pauseRange.to}`, "good");
        } else if (!pauseRange && existing) {
          h.pauses = h.pauses.filter((p) => p.to < todayKey()); // 取消暂停
          h.pauseChosen = 0;
          toast(`▶ 「${h.name}」已恢复照料`, "good");
        }
      }
      const replant = !h.plantId || !!harvestMode;
      if (harvestMode) applyHarvest(h); // 收获在这里才真正结算（中途取消等于没发生）
      // 目标值：收获/补种 → 回到最初档位；普通编辑 → 下拉里的值（读到空值就保持原目标，
      // 防止高季数的目标（如 110）不在下拉选项里时被写成 0）
      let targetVal;
      if (replant) targetVal = h.baseTarget || h.target || 21;
      else {
        const n = Number($("#habitTarget").value);
        targetVal = (Number.isFinite(n) && n > 0) ? n : h.target;
      }
      Object.assign(h, { name, schedule: $("#habitSchedule").value, weekdays, target: targetVal, plantId });
      if (replant) {
        h.growth = 0; h.wilted = false; h.wiltStreak = 0; h.reviveProgress = 0;
        h.water = 100; h.fert = 100; h.pest = 0; h.lastSim = Date.now();
        h.bloomGiven = false; h.undo = {}; h.plantedAt = todayKey();
        h.bonusPaid = Math.floor(totalCheckIns(h) / RULES.streakBonusEvery);
        if (cellOf(h.id)) {
          toast(`🌱 新的${PLANT_BY_ID[plantId].name}已在原位种下`, "good");
        } else {
          startPlacing({ kind: "plant", habitId: h.id }, `🌱 新的${PLANT_BY_ID[plantId].name}备好了：点一个空格把它种下去`);
        }
      } else toast("习惯已更新");
    } else {
      const h = {
        id: uid(), name, schedule: $("#habitSchedule").value, weekdays,
        target: Number($("#habitTarget").value), baseTarget: Number($("#habitTarget").value),
        season: 1, since: todayKey(),
        pauses: pauseRange ? [pauseRange] : [],
        pauseChosen: pauseRange ? pauseDays : 0,
        plantId, records: {}, undo: {}, growth: 0, water: 100, fert: 100, pest: 0,
        lastSim: Date.now(), wilted: false, wiltStreak: 0, reviveProgress: 0,
        bloomGiven: false, bonusPaid: 0, medalPaid: 0, archivedAt: null, snapshot: null,
        plantedAt: todayKey(), createdAt: todayKey(), historyFrom: todayKey(),
      };
      state.habits.push(h);
      // 尊重"手动选格子"：不自动占格，直接进入安放模式，点一下地图空格即可种下
      startPlacing({ kind: "plant", habitId: h.id }, "🌱 种子已备好：点地图上任意一个空格把它种下去");
    }
    save();
    habitDialog.close();
    render();
  };

  $("#deleteHabitBtn").onclick = () => {
    const h = state.habits.find((x) => x.id === $("#habitId").value);
    if (!h) return;
    askConfirm(`移除习惯「${h.name}」？`, "打卡记录、植物和地图上的位置都会一起消失。", () => {
      removeCellOf(h.id);
      state.habits = state.habits.filter((x) => x.id !== h.id);
      save(); habitDialog.close(); render();
      toast("习惯已删除");
    });
  };

  /* ============ 选择地图（买小动物时自动询问 / 手动改归属） ============ */
  const mapPickDialog = $("#mapPickDialog");
  let mapPickCb = null;
  function pickMap(title, desc, cb, presetId) {
    $("#mapPickTitle").textContent = title;
    $("#mapPickDesc").textContent = desc || "";
    $("#mapPickSelect").innerHTML = state.maps.map((m) => {
      const used = Object.keys(m.cells).length;
      return `<option value="${m.id}" ${m.id === (presetId || activeMap().id) ? "selected" : ""}>${esc(m.name)}（${used}/${CELLS}）</option>`;
    }).join("");
    mapPickCb = cb;
    mapPickDialog.showModal();
  }
  $("#mapPickOk").onclick = () => {
    const cb = mapPickCb; mapPickCb = null;
    const id = $("#mapPickSelect").value;
    mapPickDialog.close();
    if (cb) cb(id);
  };
  $("#mapPickCancel").onclick = () => { mapPickCb = null; mapPickDialog.close(); };

  /* 商店/托盘里用的品种小图标：用该品种「盛开」时的真实画法，所以每种长得都不一样 */
  function plantIcon(plantId) {
    const sp = PLANT_BY_ID[plantId];
    if (!sp) return "";
    return plantSVG(sp, { plantId, growth: 100, target: 100, water: 100, fert: 100, pest: 0, wilted: false }, true);
  }

  /* ============ 商店 ============ */
  const shopDialog = $("#shopDialog");
  $("#shopBtn").onclick = () => { renderShop(); shopDialog.showModal(); };
  function renderShop() {
    const m = activeMap();
    $("#shopDew").textContent = `💧 ${state.dew}`;
    $("#shopSkinMapName").textContent = m.name;
    // 花露不够时给出明确说明，不让用户对着一片灰按钮发愣
    const cheapest = Math.min(...PLANT_CATALOG.filter((p) => !state.unlockedPlants.includes(p.id)).map((p) => p.cost),
      ...ANIMAL_CATALOG.map((a) => a.cost), ...TOOL_CATALOG.map((t) => t.cost), ...DECOR_CATALOG.map((d) => d.cost),
      ...MAP_SKINS.filter((s) => !m.skins.includes(s.id)).map((s) => s.cost), Infinity);
    const hint = $("#shopHint");
    if (state.dew === 0) {
      hint.textContent = "💧 花露为 0，暂时买不了东西：每打一次卡 +2 花露，坚持还会有额外奖励。";
      hint.hidden = false;
    } else if (Number.isFinite(cheapest) && state.dew < cheapest) {
      hint.textContent = `💧 当前 ${state.dew} 花露，还差一点（最便宜的还要 ${cheapest}）：打卡可以继续攒。`;
      hint.hidden = false;
    } else hint.hidden = true;
    $("#shopPlants").innerHTML = PLANT_CATALOG.filter((p) => p.cost > 0).map((p) => `
      <div class="shop-item ${state.unlockedPlants.includes(p.id) ? "owned" : ""}">
        <div class="shop-icon">${plantIcon(p.id)}</div>
        <div class="shop-copy"><b>${esc(p.name)}</b><small>${esc(shortMeaning(p))}</small></div>
        ${state.unlockedPlants.includes(p.id) ? `<span class="owned-mark">已解锁</span>` :
          `<button class="btn btn-sm btn-primary" type="button" data-buy-plant="${p.id}" ${state.dew < p.cost ? "disabled" : ""}>💧${p.cost}</button>`}
      </div>`).join("");
    const cnt = (id) => state.animals.filter((a) => a.catId === id).length;
    // 我的园丁：可以自由改派到任意地图
    const staff = state.animals.map((a) => {
      const cat = ANIMAL_BY_ID[a.catId] || {};
      const t = state.habits.find((h) => h.id === a.assignedHabit);
      return `<div class="shop-item staff-item">
        <div class="shop-emoji">${cat.emoji || "🐾"}</div>
        <div class="shop-copy">
          <b>${esc(cat.name || "小动物")}</b>
          <small>${t ? `正在照料「${esc(t.name)}」` : "待命中（这张地图暂时没有需要照顾的植物）"}</small>
          <select data-animal-map="${a.uid}" aria-label="改派 ${esc(cat.name || "")} 到哪张地图">
            ${state.maps.map((mm) => `<option value="${mm.id}" ${mm.id === a.mapId ? "selected" : ""}>去 ${esc(mm.name)}</option>`).join("")}
          </select>
        </div>
      </div>`;
    }).join("");
    $("#shopAnimals").innerHTML =
      `<h4 class="shop-sub">我的园丁（${state.animals.length} 位）</h4>` +
      (staff || `<p class="hint">还没有园丁。雇佣一只小动物，它会在地图上一直照顾植物。</p>`) +
      `<h4 class="shop-sub">雇佣新园丁</h4>` +
      ANIMAL_CATALOG.map((a) => `
      <div class="shop-item">
        <div class="shop-emoji">${a.emoji}</div>
        <div class="shop-copy"><b>${esc(a.name)}</b><small>${esc(a.desc)}<br>${a.tasks.map(taskName).join("+")}，约 +${(a.rate * 24).toFixed(0)}/天　已有 ×${cnt(a.id)}</small></div>
        <button class="btn btn-sm btn-primary" type="button" data-buy-animal="${a.id}" ${state.dew < a.cost ? "disabled" : ""}>💧${a.cost}</button>
      </div>`).join("");
    $$("#shopAnimals [data-animal-map]").forEach((sel) => {
      sel.onchange = () => {
        const a = state.animals.find((x) => x.uid === sel.dataset.animalMap);
        if (!a) return;
        a.mapId = sel.value;
        a.assignedHabit = null; // 换地图后重新认领
        const mm = state.maps.find((x) => x.id === a.mapId);
        save(); render(); renderShop();
        toast(`${ANIMAL_BY_ID[a.catId]?.emoji || ""} ${ANIMAL_BY_ID[a.catId]?.name || "园丁"}已改派到「${mm ? mm.name : ""}」`, "good");
      };
    });
    $("#shopTools").innerHTML = TOOL_CATALOG.map((t) => `
      <div class="shop-item">
        <div class="shop-emoji">${t.emoji}</div>
        <div class="shop-copy"><b>${esc(t.name)}</b><small>${esc(t.desc)}（持有 ×${state.tools[t.id] || 0}）</small></div>
        <button class="btn btn-sm btn-primary" type="button" data-buy-tool="${t.id}" ${state.dew < t.cost ? "disabled" : ""}>💧${t.cost}</button>
      </div>`).join("");
    $("#shopDecors").innerHTML = DECOR_CATALOG.map((d) => {
      const owned = state.decorItems.filter((i) => i.decorId === d.id).length;
      return `<div class="shop-item">
        <div class="shop-icon">${decorSVG(d.id)}</div>
        <div class="shop-copy"><b>${esc(d.name)}</b><small>${esc(d.desc)}${owned ? `（已有 ×${owned}）` : ""}</small></div>
        <button class="btn btn-sm btn-primary" type="button" data-buy-decor="${d.id}" ${state.dew < d.cost ? "disabled" : ""}>💧${d.cost}</button>
      </div>`;
    }).join("");
    $("#shopSkins").innerHTML = MAP_SKINS.map((s) => {
      const owned = m.skins.includes(s.id);
      const active = m.skin === s.id;
      return `<div class="shop-item ${active ? "owned" : ""}">
        <div class="shop-swatch" style="background:${s.bg}"></div>
        <div class="shop-copy"><b>${esc(s.name)}</b><small>${s.cost ? `用于「${esc(m.name)}」的地面皮肤` : "默认皮肤"}</small></div>
        ${active ? `<span class="owned-mark">使用中</span>` : owned
          ? `<button class="btn btn-sm" type="button" data-use-skin="${s.id}">换上</button>`
          : `<button class="btn btn-sm btn-primary" type="button" data-buy-skin="${s.id}" ${state.dew < s.cost ? "disabled" : ""}>💧${s.cost}</button>`}
      </div>`;
    }).join("");
    $$("#shopDialog [data-buy-plant]").forEach((b) => b.onclick = () => buyPlant(b.dataset.buyPlant));
    $$("#shopDialog [data-buy-animal]").forEach((b) => b.onclick = () => buyAnimal(b.dataset.buyAnimal));
    $$("#shopDialog [data-buy-tool]").forEach((b) => b.onclick = () => buyTool(b.dataset.buyTool));
    $$("#shopDialog [data-buy-decor]").forEach((b) => b.onclick = () => buyDecor(b.dataset.buyDecor));
    $$("#shopDialog [data-buy-skin]").forEach((b) => b.onclick = () => buySkin(b.dataset.buySkin));
    $$("#shopDialog [data-use-skin]").forEach((b) => b.onclick = () => {
      m.skin = b.dataset.useSkin; save(); renderShop(); render();
      toast(`🎨 已换成「${SKIN_BY_ID[m.skin].name}」`, "good");
    });
  }
  const taskName = (t) => ({ water: "浇水", fert: "施肥", pest: "除虫" }[t] || t);

  function spend(cost, reason) {
    if (state.dew < cost) { toast("花露不足", "bad"); return false; }
    state.dew -= cost;
    state.totals.expense -= cost;
    ledger(-cost, reason);
    return true;
  }
  /* 较贵的购买先确认，避免误点 */
  function confirmBuy(name, cost, run) {
    if (cost < RULES.buyConfirmFrom) return run();
    askConfirm(`花 💧${cost} 买「${name}」？`, `买完花露剩 💧${state.dew - cost}。`, run);
  }
  function buyPlant(id) {
    const p = PLANT_BY_ID[id];
    confirmBuy(p.name, p.cost, () => {
      if (!spend(p.cost, `解锁植物「${p.name}」`)) return;
      state.unlockedPlants.push(id);
      toast(`🔓 已解锁「${p.name}」，新建习惯或补种时可选`, "good");
      save(); renderShop(); render();
    });
  }
  function buyAnimal(id) {
    const a = ANIMAL_BY_ID[id];
    const hire = (mapId) => {
      if (!spend(a.cost, `雇佣${a.name}`)) return;
      state.animals.push({ uid: uid(), catId: id, assignedHabit: null, mapId, lastSim: Date.now() });
      const mm = state.maps.find((x) => x.id === mapId);
      toast(`${a.emoji} ${a.name}入驻「${mm ? mm.name : ""}」，会自己挑一株需要照顾的植物`, "good");
      save(); render(); renderShop(); // 先 render 让它认领植物，再刷新商店里的名册
    };
    if (state.maps.length >= 2) {
      // 多张地图时直接用「选地图」弹窗当确认（说明里写清价格），避免两个弹窗连着弹
      pickMap(`${a.emoji} ${a.name}去哪个花园？`,
        `花 💧${a.cost}，买完剩 💧${Math.max(0, state.dew - a.cost)}。它只照顾自己所在花园里的植物，之后可以在商店里随时改派。`,
        hire);
      return;
    }
    confirmBuy(a.name, a.cost, () => hire(state.maps[0].id));
  }
  function buyTool(id) {
    const t = TOOL_CATALOG.find((x) => x.id === id);
    if (!spend(t.cost, `购买${t.name}`)) return;
    state.tools[id] = (state.tools[id] || 0) + 1;
    toast(`${t.emoji} 已购买${t.name}，在植物详情里使用`, "good");
    save(); renderShop(); render();
  }
  function buyDecor(id) {
    const d = DECOR_CATALOG.find((x) => x.id === id);
    confirmBuy(d.name, d.cost, () => {
      if (!spend(d.cost, `购买装饰「${d.name}」`)) return;
      state.decorItems.push({ uid: uid(), decorId: id });
      toast(`${d.emoji} ${d.name}已买下，去下方「待安放」把它放进格子`, "good");
      save(); renderShop(); render();
    });
  }
  function buySkin(id) {
    const s = SKIN_BY_ID[id];
    const m = activeMap();
    confirmBuy(`${s.name}（${m.name}）`, s.cost, () => {
      if (!spend(s.cost, `为「${m.name}」购买皮肤「${s.name}」`)) return;
      m.skins.push(id); m.skin = id;
      toast(`🎨 「${m.name}」换上了「${s.name}」`, "good");
      save(); renderShop(); render();
    });
  }
  $$(".shop-tab").forEach((t) => {
    t.onclick = () => {
      $$(".shop-tab").forEach((x) => x.classList.remove("is-active"));
      t.classList.add("is-active");
      $$(".shop-pane").forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
      // 皮肤说明只在「地图皮肤」分类里出现
      $("#skinNote").hidden = t.dataset.tab !== "skins";
    };
  });

  /* ============ 统计 ============ */
  const statsDialog = $("#statsDialog");
  $("#statsBtn").onclick = () => { renderStats(); statsDialog.showModal(); };
  $("#statsHabitSel").onchange = (e) => renderStats(e.target.value);

  function renderStats(keepHabitId) {
    const WEEKS = 12;
    const sel = $("#statsHabitSel");
    // 只渲染选中的那一个习惯的日历：习惯再多也不会无限堆积
    const curId = keepHabitId || sel.value || (state.habits[0] && state.habits[0].id) || "";
    sel.innerHTML = state.habits.length
      ? state.habits.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join("")
      : `<option value="">（还没有习惯）</option>`;
    sel.value = state.habits.find((h) => h.id === curId) ? curId : (state.habits[0] ? state.habits[0].id : "");
    const h = state.habits.find((x) => x.id === sel.value);

    if (!h) {
      $("#statsCals").innerHTML = "<p class='empty'>还没有习惯，先种下一个吧。</p>";
      $("#statsHabitMeta").textContent = "";
    } else {
      // 以「本周日」结尾、从 12 周前的周一开头，保证每列 = 一周（周一→周日）
      const today = gardenDate(); today.setHours(0, 0, 0, 0);
      const mondayIdx = (today.getDay() + 6) % 7; // 周一=0 … 周日=6
      const end = new Date(today);
      end.setDate(end.getDate() + (6 - mondayIdx));      // 本周日
      const start = new Date(end);
      start.setDate(start.getDate() - (WEEKS * 7 - 1));  // 12 周前的周一
      const born = h.historyFrom ? parseKey(h.historyFrom) : (h.plantedAt ? parseKey(h.plantedAt) : null);
      const cells = [];
      const d = new Date(start);
      for (let i = 0; i < WEEKS * 7; i++) {
        const key = dkey(d);
        let cls = "na", title = key;
        if (d > today) { cls = "future"; title = key + "（还没到）"; }
        else if (born && d < born) { cls = "na"; title = key + "（还没种下）"; }
        else if (h.records[key]) { cls = "on"; title = key + " 已打卡"; }
        else if (isScheduled(h, d)) { cls = "off"; title = key + " 漏打"; }
        else title = key + "（非计划日）";
        cells.push(`<i class="${cls}" title="${title}"></i>`);
        d.setDate(d.getDate() + 1);
      }
      $("#statsCals").innerHTML = `<div class="cal"><div class="cal-grid">${cells.join("")}</div></div>`;
      const done = Object.keys(h.records).length;
      $("#statsHabitMeta").textContent =
        `共打卡 ${done} 次 · 连续 ${streak(h)} 天 · ${PLANT_BY_ID[h.plantId]?.name || "植物已枯死"}${h.plantedAt ? ` · ${h.plantedAt} 种下` : ""}`;
    }

    const roster = state.animals.slice(0, 12).map((a) => {
      const cat = ANIMAL_BY_ID[a.catId];
      const t = state.habits.find((x) => x.id === a.assignedHabit);
      return `<li>${cat?.emoji || ""} ${cat?.name || ""} —— ${t ? `正在照料「${esc(t.name)}」` : "在花园里待命"}</li>`;
    }).join("");
    const deaths = state.deadPlants.slice(-8).reverse().map((d) =>
      `<li>💀 ${esc(d.plantName)}（${esc(d.habitName)}）于 ${d.date} 枯逝</li>`).join("");
    $("#statsReport").innerHTML = `
      <div class="report-cards">
        <div><small>累计收入</small><b>+${state.totals.income} 💧</b></div>
        <div><small>累计支出</small><b>${Math.abs(state.totals.expense)} 💧</b></div>
        <div><small>当前结余</small><b>${state.dew} 💧</b></div>
        <div><small>园丁</small><b>${state.animals.length} 位</b></div>
      </div>
      <h4>🛠 园丁名册${state.animals.length > 12 ? `（显示前 12 位）` : ""}</h4>
      <ul class="roster">${roster || "<li>暂无小动物，去商店看看吧。</li>"}</ul>
      ${deaths ? `<h4>💔 枯逝记录（最近 8 条 / 共 ${state.deadPlants.length} 条）</h4><ul class="roster">${deaths}</ul>` : ""}
      <h4>📜 最近流水</h4>
      <ul class="roster ledger-list" id="ledgerList">${ledgerRows(8)}</ul>
      ${state.ledger.length > 8 ? `<button class="btn btn-ghost btn-sm" id="ledgerMore" type="button">
        查看全部 ${state.ledger.length} 笔</button>` : ""}`;
    const more = $("#ledgerMore");
    if (more) more.onclick = () => {
      $("#ledgerList").innerHTML = ledgerRows(state.ledger.length);
      $("#ledgerList").classList.add("is-full");
      more.remove();
    };
  }
  function ledgerRows(n) {
    const rows = state.ledger.slice(-n).reverse().map((l) =>
      `<li>${l.d}　${l.delta > 0 ? "+" : ""}${l.delta} 💧　${esc(l.reason)}</li>`).join("");
    return rows || "<li>还没有记录。</li>";
  }

  /* ============ 统一确认框（替代原生 confirm） ============ */
  let confirmRun = null;
  function askConfirm(title, msg, run) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = msg;
    confirmRun = run;
    $("#confirmDialog").showModal();
  }
  $("#confirmOk").onclick = () => {
    const run = confirmRun; confirmRun = null;
    $("#confirmDialog").close();
    if (run) run();
  };
  $("#confirmCancel").onclick = () => { confirmRun = null; $("#confirmDialog").close(); };

  /* ============ 花园图鉴 ============ */
  const collectionDialog = $("#collectionDialog");
  $("#collectionBtn").onclick = () => { renderCollection(); collectionDialog.showModal(); };
  function renderCollection() {
    const got = Object.keys(state.collection).length;
    $("#collectionCount").textContent = `已集 ${got} / ${PLANT_CATALOG.length} 种`;
    const medals = state.medals || 0;
    $("#medalStrip").innerHTML = medals
      ? `<span class="medal">🏅</span><span>累计获得 <b>${medals}</b> 枚勋章（每满 ${RULES.medalEvery} 次打卡 +${RULES.medalDew} 花露）</span>`
      : `<span class="medal dim">🏅</span><span class="muted">还没有勋章：每满 ${RULES.medalEvery} 次打卡得一枚（+${RULES.medalDew} 花露）</span>`;
    $("#collectionGrid").innerHTML = PLANT_CATALOG.map((p) => {
      const c = state.collection[p.id];
      const unlocked = state.unlockedPlants.includes(p.id);
      const cur = state.habits.find((h) => h.plantId === p.id);
      return `<button type="button" class="col-cell ${c ? "got" : ""} ${unlocked ? "" : "locked"}" data-col="${p.id}">
        <span class="col-icon">${plantIcon(p.id)}</span>
        <span class="col-name">${esc(p.name)}</span>
        <span class="col-meta">${c ? `收获 ${c.count} 次` : unlocked ? "还没收获" : `💧${p.cost} 解锁`}</span>
        ${cur ? '<span class="col-live">在养</span>' : ""}
      </button>`;
    }).join("");
    $$("#collectionGrid [data-col]").forEach((b) => b.onclick = () => {
      const p = PLANT_BY_ID[b.dataset.col];
      const c = state.collection[p.id];
      $("#collectionTip").innerHTML = `<b>${esc(p.name)}</b>${c ? `（已收获 ${c.count} 次，首次 ${c.firstAt}）` : ""}<br>${esc(p.lang[0])}<br>💌 ${esc(p.lang[1])}`;
    });
  }

  /* ============ 数据管理 ============ */
  const dataDialog = $("#dataDialog");
  $("#dataBtn").onclick = function () {
    $("#reminderToggle").checked = !!state.settings.reminder;
    $("#reminderTime").value = state.settings.reminderTime || "20:00";
    dataDialog.showModal();
  };
  $("#reminderToggle").onchange = async function (e) {
    if (e.target.checked) {
      if (typeof Notification === "undefined") {
        e.target.checked = false;
        return toast("这个浏览器不支持通知", "bad");
      }
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") {
        e.target.checked = false;
        return toast("通知权限被拒绝：请在浏览器地址栏旁的权限设置里允许通知", "bad");
      }
      state.settings.reminder = true;
      state.lastNotified = "";
      save();
      toast("🔔 已开启每日提醒", "good");
    } else {
      state.settings.reminder = false;
      save();
      toast("已关闭每日提醒");
    }
  };
  $("#reminderTime").onchange = function (e) {
    state.settings.reminderTime = e.target.value || "20:00";
    save();
  };
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `habit-garden-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $("#exportBtn").onclick = exportData;
  $("#exportBtn2").onclick = exportData;
  $("#importBtn").onclick = () => $("#importFile").click();
  $("#importFile").onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let d;
      try { d = JSON.parse(r.result); } catch { return toast("这个文件不是合法的 JSON", "bad"); }
      if (!d || !Array.isArray(d.habits)) return toast("文件内容不像花园备份（缺少 habits 字段）", "bad");
      const bad = d.habits.filter((h) => h.plantId && !PLANT_BY_ID[h.plantId]).length;
      dataDialog.close();
      askConfirm("导入备份会覆盖当前数据", `当前 ${state.habits.length} 个习惯、💧${state.dew} 花露将被替换${bad ? `；另有 ${bad} 个习惯的植物在当前版本不存在，会退化为"待补种"` : ""}。`, () => {
        state = Object.assign(freshState(), d);
        baseRev = 0; // 导入的数据是新的基线，避免误报并发冲突
        if (!state.maps.length) state.maps.push(newMap(1));
        if (!state.maps.find((m) => m.id === state.activeMapId)) state.activeMapId = state.maps[0].id;
        sanitize(true);
        save(); render();
        toast("备份已导入", "good");
      });
    };
    r.readAsText(f);
  };
  $("#resetBtn").onclick = () => {
    askConfirm("清空所有数据？", "习惯、植物、地图、小动物、花露全部清空，无法恢复。", () => {
      state = freshState();
      baseRev = 0;
      state.maps.push(newMap(1));
      state.activeMapId = state.maps[0].id;
      save(); render(); dataDialog.close();
      toast("已重新开始");
    });
  };

  /* ============ 花园入口 ============ */
  $("#openGardenBtn").onclick = () => setGardenOpen(true);
  $("#closeGardenBtn").onclick = () => setGardenOpen(false);
  $$("[data-close]").forEach((b) => { b.onclick = () => b.closest("dialog").close(); });

  /* ============ 跨标签页同步（防止另一个窗口覆盖数据） ============ */
  let lastSyncToast = 0;
  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY || !e.newValue) return;
    muteSave = true; // 同步期间不要写回，否则两个窗口会来回触发
    try {
      state = Object.assign(freshState(), JSON.parse(e.newValue));
      baseRev = state.rev || 0; // 跟上对方版本，正常来回同步不会误报冲突
      if (!state.maps.length) state.maps.push(newMap(1));
      if (!state.maps.find((m) => m.id === state.activeMapId)) state.activeMapId = state.maps[0].id;
      render();
      if (Date.now() - lastSyncToast > 4000) {
        lastSyncToast = Date.now();
        toast("另一个窗口改了花园，已同步过来", "good");
      }
    } catch { /* 忽略坏数据 */ } finally { muteSave = false; }
  });

  /* ============ 每日打卡提醒 ============ */
  function dueHabits() {
    const gd = gardenDate();
    return state.habits.filter((h) => !isArchived(h) && isScheduled(h, gd)
      && !h.records[todayKey()] && !pauseState(h).on);
  }
  function notifyDue() {
    if (!state.settings.reminder) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const now = new Date();
    const hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
    if (hm < state.settings.reminderTime) return;
    const due = dueHabits();
    if (!due.length || state.lastNotified === todayKey()) return;
    state.lastNotified = todayKey();
    save();
    try {
      const n = new Notification("习惯花园 · 该照料啦", {
        body: "还有 " + due.length + " 个习惯今天没打卡：" + due.map((h) => h.name).join("、"),
        icon: "icon-192.png", tag: "habit-garden-daily",
      });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) { /* 通知失败不打扰 */ }
  }
  setInterval(notifyDue, 60 * 1000);

  /* ============ PWA ============ */
  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) { /* 忽略 */ }
  }

  /* ============ 启动 ============ */
  sanitize();
  for (const h of state.habits) checkWilt(h);
  save();
  render();
  if (!state.seenIntro) {
    state.seenIntro = true; save();
    setTimeout(() => toast("👋 点地图格子看植物详情与花语；点「待安放」把植物放进格子", "good"), 600);
  }
  setInterval(render, 5 * 60 * 1000);
})();
