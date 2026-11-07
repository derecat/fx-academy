/* ================= 行情引擎 ================= */
const Market = (() => {
  const TICK_MS = 700;          // 每次报价刷新
  const TICKS_PER_BAR = 6;      // 6 个 tick 收一根 1m K 线（加速时间）
  const DAY_TICKS = 520;        // 一个"模拟交易日"的 tick 数（约 6 分钟）

  const state = {};             // sym -> {mid, bars:{1:[],5:[],15:[],60:[]}, tick, acc}
  let tickCount = 0;
  const listeners = [];

  function rnd() { return Math.random() * 2 - 1; }
  function gauss() {
    // Box-Muller，取一个标准正态
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* 生成历史 K 线：先造 1m，再由 1m 聚合 */
  function seed(inst, n) {
    const arr = [];
    let p = inst.base * (1 + gauss() * 0.0025);
    let trend = gauss() * inst.vol * 0.22;
    for (let i = 0; i < n; i++) {
      if (i % 90 === 0) trend = gauss() * inst.vol * 0.28;
      const o = p;
      let h = o, l = o, c = o;
      for (let k = 0; k < 6; k++) {
        p += trend + gauss() * inst.vol;
        if (p > h) h = p;
        if (p < l) l = p;
        c = p;
      }
      arr.push({ t: i, o, h, l, c });
    }
    // 让最后一根收盘价贴近配置基准
    return arr;
  }

  function aggregate(bars1m, factor) {
    const out = [];
    for (let i = 0; i < bars1m.length; i += factor) {
      const slice = bars1m.slice(i, i + factor);
      if (!slice.length) break;
      out.push({
        t: out.length,
        o: slice[0].o,
        h: Math.max(...slice.map(b => b.h)),
        l: Math.min(...slice.map(b => b.l)),
        c: slice[slice.length - 1].c
      });
    }
    return out;
  }

  function init() {
    INSTRUMENTS.forEach(inst => {
      const bars = seed(inst, 1440);
      const mid = bars[bars.length - 1].c;
      state[inst.sym] = {
        mid, tick: 0, bars: { 1: bars, 5: aggregate(bars, 5), 15: aggregate(bars, 15), 60: aggregate(bars, 60) },
        drift: 0, lastBid: mid, dir: 0, dayOpen: mid
      };
    });
  }

  function get(sym) { return state[sym]; }

  function bidAsk(inst) {
    const s = state[inst.sym];
    const half = inst.spreadPip * inst.pip / 2;
    return { bid: s.mid - half, ask: s.mid + half };
  }

  /* 价格的小数位显示 */
  function fmt(inst, v) {
    return v.toFixed(inst.digits);
  }

  /* 每笔 1 手 1 点的美元价值 */
  function pipValue(inst, price) {
    const v = inst.contract * inst.pip;
    if (inst.sym.endsWith('JPY')) return v / (price || state[inst.sym].mid);
    return v;
  }

  /* 盈亏（USD）：dir 1=多 -1=空 */
  function pnl(inst, dir, lots, entry, exit) {
    const raw = (exit - entry) * dir * lots * inst.contract;
    if (inst.sym.endsWith('JPY')) return raw / exit;
    if (inst.cls === 'crypto') return raw;          // 1 手 = 1 枚，报价即美元
    return raw;
  }

  /* 保证金（USD） */
  function margin(inst, lots, price, lev) {
    const notionalUSD = (inst.sym.startsWith('USD/'))
      ? lots * inst.contract
      : lots * inst.contract * price;
    return notionalUSD / lev;
  }

  function pointsBetween(inst, a, b) {
    return (b - a) / inst.pip;
  }

  function step() {
    tickCount++;
    INSTRUMENTS.forEach(inst => {
      const s = state[inst.sym];
      // 趋势漂移缓慢变化，制造波段
      if (tickCount % 220 === 0) s.drift = gauss() * inst.vol * 0.05;
      const shock = Math.random() < 0.006 ? gauss() * inst.vol * 3.5 : 0;
      const prev = s.mid;
      // 温和均值回归：避免长时间单向漂移到不真实的价位
      const revert = (s.dayOpen - s.mid) * 0.0016;
      s.mid = s.mid + s.drift * 0.12 + revert + gauss() * inst.vol * 0.45 + shock;
      s.dir = s.mid > prev ? 1 : (s.mid < prev ? -1 : 0);

      // 更新当前 1m K 线
      const bar = s.bars[1][s.bars[1].length - 1];
      bar.c = s.mid;
      if (s.mid > bar.h) bar.h = s.mid;
      if (s.mid < bar.l) bar.l = s.mid;
      s.tick++;
      if (s.tick >= TICKS_PER_BAR) {
        s.tick = 0;
        s.bars[1].push({ t: s.bars[1].length, o: s.mid, h: s.mid, l: s.mid, c: s.mid });
        if (s.bars[1].length > 1500) s.bars[1].shift();
        rebuild(inst);
      }
    });
    listeners.forEach(fn => fn(tickCount));
  }

  function rebuild(inst) {
    const s = state[inst.sym];
    [5, 15, 60].forEach(f => { s.bars[f] = aggregate(s.bars[1], f); });
  }

  let timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(step, TICK_MS);
  }
  function onTick(fn) { listeners.push(fn); }

  function isNewDay() { return tickCount > 0 && tickCount % DAY_TICKS === 0; }
  function dayIndex() { return Math.floor(tickCount / DAY_TICKS); }

  return { init, get, bidAsk, fmt, pipValue, pnl, margin, pointsBetween, step, start, onTick, isNewDay, dayIndex, TICK_MS, TICKS_PER_BAR };
})();


/* ================= 账户引擎 ================= */
const Account = (() => {
  const KEY = 'fx_academy_v1';
  const START_BALANCE = 10000;
  const LEVERAGE = 100;
  const STOP_OUT = 50;        // 保证金比例 < 50% 强平
  const WARN = 100;

  let S = {
    balance: START_BALANCE,
    leverage: LEVERAGE,
    positions: [],
    pending: [],
    history: [],
    lessons: {},
    flags: { leverageLab: 0, liqLab: false },
    stats: { trades: 0, wins: 0, losses: 0, maxDD: 0, peak: START_BALANCE },
    createdAt: Date.now()
  };
  let seq = 1;
  const subs = [];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p.balance === 'number') {
        S = Object.assign(S, p);
        S.flags = Object.assign({ leverageLab: 0, liqLab: false }, S.flags || {});
        S.lessons = S.lessons || {};
        seq = (S.positions.length + S.history.length + S.pending.length + 10);
      }
    } catch (e) { console.warn('load failed', e); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }
  function emit() { subs.forEach(f => f()); }
  function on(fn) { subs.push(fn); }
  function inst(sym) { return INSTRUMENTS.find(i => i.sym === sym); }

  function reset() {
    S = {
      balance: START_BALANCE, leverage: LEVERAGE,
      positions: [], pending: [], history: [],
      lessons: {}, flags: { leverageLab: 0, liqLab: false },
      stats: { trades: 0, wins: 0, losses: 0, maxDD: 0, peak: START_BALANCE },
      createdAt: Date.now()
    };
    save(); emit();
  }

  /* --- 实时汇总 --- */
  function equity() {
    let f = 0;
    S.positions.forEach(p => {
      const i = inst(p.sym), m = Market.get(p.sym).mid;
      f += Market.pnl(i, p.dir, p.lots, p.entry, m);
    });
    return S.balance + f;
  }
  function usedMargin() {
    let m = 0;
    S.positions.forEach(p => { m += p.margin; });
    return m;
  }
  function freeMargin() { return equity() - usedMargin(); }
  function marginLevel() {
    const um = usedMargin();
    if (um <= 0) return Infinity;
    return equity() / um * 100;
  }
  function floatPnl() { return S.positions.reduce((a, p) => a + p.upnl, 0); }

  /* --- 下单 --- */
  function open({ sym, dir, lots, sl, tp, type, price }) {
    const i = inst(sym);
    const { bid, ask } = Market.bidAsk(i);
    const entry = type === 'market' ? (dir > 0 ? ask : bid) : price;
    const mg = Market.margin(i, lots, entry, S.leverage);

    if (mg > freeMargin()) return { ok: false, msg: `可用保证金不足（需要 $${mg.toFixed(2)}）` };

    // 校验止损止盈方向
    if (sl != null) {
      const okSL = dir > 0 ? sl < entry : sl > entry;
      if (!okSL) return { ok: false, msg: '止损方向不对：多单止损必须低于开仓价' };
    }
    if (tp != null) {
      const okTP = dir > 0 ? tp > entry : tp < entry;
      if (!okTP) return { ok: false, msg: '止盈方向不对：多单止盈必须高于开仓价' };
    }

    if (type === 'market') {
      S.positions.push({
        id: 'P' + (seq++), sym, dir, lots, entry,
        sl: sl ?? null, tp: tp ?? null, margin: mg,
        openAt: Date.now(), upnl: 0, openDay: Market.dayIndex()
      });
      S.stats.trades++;
      save(); emit();
      return { ok: true, msg: '已开仓' };
    }
    // 挂单
    S.pending.push({
      id: 'L' + (seq++), sym, dir, lots, price,
      sl: sl ?? null, tp: tp ?? null, type: 'limit', at: Date.now()
    });
    save(); emit();
    return { ok: true, msg: '挂单已提交' };
  }

  function close(id, ratio = 1, fillPx, why) {
    const idx = S.positions.findIndex(p => p.id === id);
    if (idx < 0) return;
    const p = S.positions[idx];
    const i = inst(p.sym);
    const { bid, ask } = Market.bidAsk(i);
    let px = p.dir > 0 ? bid : ask;
    if (fillPx != null) {
      // 止损/止盈按触发价成交；若跳空越过，按实际市价（更差的价格）
      px = p.dir > 0 ? Math.min(fillPx, px) : Math.max(fillPx, px);
    }

    if (ratio >= 1) {
      const pl = Market.pnl(i, p.dir, p.lots, p.entry, px);
      S.balance += pl;
      S.history.unshift({
        sym: p.sym, dir: p.dir, lots: p.lots, entry: p.entry, exit: px,
        pnl: pl, at: Date.now(), openAt: p.openAt, sl: p.sl, tp: p.tp,
        why: why || '手动', dur: (Date.now() - p.openAt) / 1000
      });
      if (pl >= 0) S.stats.wins++; else S.stats.losses++;
      S.positions.splice(idx, 1);
    } else {
      const part = Math.max(0.01, Math.round(p.lots * ratio * 100) / 100);
      const pl = Market.pnl(i, p.dir, part, p.entry, px);
      S.balance += pl;
      p.lots = Math.round((p.lots - part) * 100) / 100;
      p.margin = Market.margin(i, p.lots, p.entry, S.leverage);
      S.history.unshift({
        sym: p.sym, dir: p.dir, lots: part, entry: p.entry, exit: px,
        pnl: pl, at: Date.now(), openAt: p.openAt, sl: p.sl, tp: p.tp, why: why || '手动',
        dur: (Date.now() - p.openAt) / 1000, partial: true
      });
      if (pl >= 0) S.stats.wins++; else S.stats.losses++;
      if (p.lots <= 0.001) S.positions.splice(idx, 1);
    }
    if (S.history.length > 200) S.history.length = 200;
    save(); emit();
  }

  function cancelPending(id) {
    S.pending = S.pending.filter(x => x.id !== id);
    save(); emit();
  }

  function modify(id, sl, tp) {
    const p = S.positions.find(x => x.id === id);
    if (!p) return;
    if (sl !== undefined) p.sl = sl;
    if (tp !== undefined) p.tp = tp;
    save(); emit();
  }

  /* --- 每个 tick：更新浮盈亏、触发止损止盈/挂单/强平 --- */
  let pendingClose = [];   // 本 tick 要执行的平仓（含原因）
  function tickRealtime() {
    pendingClose = [];
    const i0 = Market.dayIndex();

    S.positions.forEach(p => {
      const i = inst(p.sym);
      const { bid, ask } = Market.bidAsk(i);
      const mark = p.dir > 0 ? bid : ask;   // 平仓价
      p.upnl = Market.pnl(i, p.dir, p.lots, p.entry, mark);
      p.mark = mark;

      if (p.sl != null) {
        const hit = p.dir > 0 ? bid <= p.sl : ask >= p.sl;
        if (hit) pendingClose.push({ id: p.id, why: '止损', px: p.sl });
      }
      if (!pendingClose.find(x => x.id === p.id) && p.tp != null) {
        const hit = p.dir > 0 ? bid >= p.tp : ask <= p.tp;
        if (hit) pendingClose.push({ id: p.id, why: '止盈', px: p.tp });
      }
    });

    // 挂单触发
    S.pending.forEach(od => {
      const i = inst(od.sym);
      const { bid, ask } = Market.bidAsk(i);
      const touch = od.dir > 0 ? ask <= od.price : bid >= od.price;
      if (touch) {
        const mg = Market.margin(i, od.lots, od.price, S.leverage);
        if (mg <= freeMargin()) {
          S.positions.push({
            id: 'P' + (seq++), sym: od.sym, dir: od.dir, lots: od.lots, entry: od.price,
            sl: od.sl, tp: od.tp, margin: mg, openAt: Date.now(), upnl: 0, openDay: i0
          });
          od.__done = true;
          S.stats.trades++;
        }
      }
    });
    if (S.pending.some(o => o.__done)) {
      S.pending = S.pending.filter(o => !o.__done);
      save();
    }

    // 执行本 tick 已触发的止损/止盈（先落袋，避免与强平互相覆盖）
    if (pendingClose.length) {
      pendingClose.forEach(c => close(c.id, 1, c.px, c.why));
      pendingClose = [];
    }

    // 强平：净值跌破维持保证金线，从亏损最大的仓位开始平
    let guard = 0;
    while (S.positions.length && marginLevel() < STOP_OUT && guard++ < 20) {
      const sorted = [...S.positions].sort((a, b) => a.upnl - b.upnl);
      pendingClose.push({ id: sorted[0].id, why: '强平', px: null });
      close(sorted[0].id, 1, null, '强平');
    }
    // 负余额保护：模拟真实平台的负余额归零机制
    if (S.balance < 0) {
      S.history.unshift({ sym: '—', dir: 0, lots: 0, entry: 0, exit: 0,
        pnl: -S.balance, at: Date.now(), openAt: Date.now(), dur: 0, note: '负余额归零' });
      S.balance = 0;
    }
    emit();
    return pendingClose;
  }

  function execCloses(list) {
    list.forEach(c => close(c.id, 1, c.px, c.why));
  }

  /* --- 隔夜利息 --- */
  function applySwap() {
    let total = 0;
    S.positions.forEach(p => {
      const i = inst(p.sym);
      const sw = (p.dir > 0 ? i.swapLong : i.swapShort) * p.lots * 3; // 按 3 天计，模拟周三
      total += sw;
    });
    if (S.positions.length) {
      S.balance += total;
      save(); emit();
    }
    return total;
  }

  /* --- 教学标记 --- */
  function markLesson(id) {
    if (S.lessons[id]) return false;
    S.lessons[id] = Date.now();
    save(); emit();
    return true;
  }
  function bumpFlag(k, v) {
    if (k === 'leverageLab') S.flags.leverageLab = Math.max(S.flags.leverageLab, v);
    else S.flags[k] = v;
    save(); emit();
  }

  function lessonDone(l) {
    try { return !!l.check(S); } catch (e) { return false; }
  }

  function review() {
    const hs = S.history;
    const wins = hs.filter(h => h.pnl > 0);
    const losses = hs.filter(h => h.pnl <= 0);
    const grossW = wins.reduce((a, h) => a + h.pnl, 0);
    const grossL = Math.abs(losses.reduce((a, h) => a + h.pnl, 0));
    const pf = grossL > 0 ? grossW / grossL : (grossW > 0 ? 99 : 0);
    const avgWin = wins.length ? grossW / wins.length : 0;
    const avgLoss = losses.length ? grossL / losses.length : 0;
    const noSL = hs.filter(h => h.sl === null || h.sl === undefined).length;
    const best = hs.reduce((a, h) => Math.max(a, h.pnl), 0);
    const worst = hs.reduce((a, h) => Math.min(a, h.pnl), 0);
    return { n: hs.length, winRate: hs.length ? wins.length / hs.length * 100 : 0,
      pf, avgWin, avgLoss, noSL, best, worst, net: S.balance - START_BALANCE };
  }

  return { get S() { return S; }, load, save, emit, on, reset, open, close, cancelPending, modify,
    equity, usedMargin, freeMargin, marginLevel, floatPnl, tickRealtime, execCloses, applySwap,
    markLesson, bumpFlag, lessonDone, review, inst, START_BALANCE, LEVERAGE, STOP_OUT, WARN };
})();
