/* ================= 基础工具 ================= */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = v => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = v => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const signMoney = v => (v >= 0 ? '+' : '') + money(v);
const pct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

let toastT = null;
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on' + (kind ? ' ' + kind : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = 'toast' + (kind ? ' ' + kind : ''); }, 2100);
}

/* ================= 应用状态 ================= */
const UI = {
  tab: 'market',
  sym: 'EUR/USD',
  tf: 1,
  filter: 'all',
  posSeg: 'open',
  rows: {},           // sym -> DOM refs
  order: null         // 当前下单草稿
};

/* ================= 模态框 ================= */
function openSheet(title, bodyHTML, footHTML) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = bodyHTML;
  $('#sheetFoot').innerHTML = footHTML || '';
  $('#modal').classList.add('on');
  $('#sheetBody').scrollTop = 0;
}
function closeSheet() {
  $('#modal').classList.remove('on');
  $('#sheetBody').innerHTML = '';
  $('#sheetFoot').innerHTML = '';
}
$$('[data-close]').forEach(b => b.addEventListener('click', closeSheet));

/* ================= 顶栏 ================= */
function renderTop() {
  const S = Account.S;
  const eq = Account.equity();
  $('#equityTop').textContent = money(eq);
  $('#equityTop').className = 'acct-v ' + (eq >= Account.START_BALANCE ? '' : 'dn');
  const ml = Account.marginLevel();
  const el = $('#marginLvTop');
  if (!isFinite(ml)) { el.textContent = '保证金比例 —'; el.className = ''; }
  else {
    el.textContent = '保证金比例 ' + (ml > 9999 ? '>9999' : ml.toFixed(0)) + '%';
    el.className = ml < Account.STOP_OUT ? 'dn' : (ml < Account.WARN ? '' : 'up');
  }
  const n = S.positions.length + S.pending.length;
  const badge = $('#posBadge');
  if (n > 0) { badge.hidden = false; badge.textContent = n; } else badge.hidden = true;
}

/* ================= 行情列表 ================= */
function pickSym(s) {
  UI.sym = s;
  Chart.set(UI.sym, UI.tf);
  renderTrade();
}

function buildMarket() {
  const wrap = $('#mktList');
  wrap.innerHTML = '';
  UI.rows = {};
  INSTRUMENTS.forEach(inst => {
    const row = document.createElement('button');
    row.className = 'row';
    row.dataset.sym = inst.sym;
    row.innerHTML = `
      <div class="row-flag ${inst.cls}">${inst.flag}</div>
      <div class="row-mid">
        <b>${inst.sym}</b>
        <span>${inst.name} · 点差 <em>${inst.spreadPip}</em></span>
      </div>
      <div class="row-right">
        <span class="row-px">—</span>
        <span class="row-chg">—</span>
      </div>`;
    row.addEventListener('click', () => { pickSym(inst.sym); switchTab('trade'); });
    wrap.appendChild(row);
    UI.rows[inst.sym] = {
      el: row,
      px: row.querySelector('.row-px'),
      chg: row.querySelector('.row-chg'),
      last: null
    };
  });
  updateMarket(true);
  applyFilter();
}

function updateMarket(force) {
  INSTRUMENTS.forEach(inst => {
    const r = UI.rows[inst.sym];
    if (!r) return;
    const st = Market.get(inst.sym);
    const { bid, ask } = Market.bidAsk(inst);
    const midStr = Market.fmt(inst, st.mid);
    if (r.last !== midStr) {
      r.px.textContent = midStr;
      r.px.className = 'row-px ' + (st.dir > 0 ? 'up' : st.dir < 0 ? 'dn' : '');
      if (!force && r.last !== null) {
        const moved = parseFloat(midStr) - parseFloat(r.last);
        if (Math.abs(moved) >= inst.pip * 0.6) {
          r.el.classList.remove('tick-up', 'tick-dn');
          void r.el.offsetWidth;
          r.el.classList.add(moved > 0 ? 'tick-up' : 'tick-dn');
        }
      }
      r.last = midStr;
    }
    const dp = (bid - st.dayOpen) / inst.pip;
    r.chg.textContent = (dp >= 0 ? '+' : '') + dp.toFixed(1) + ' 点';
    r.chg.className = 'row-chg ' + (dp >= 0 ? 'up' : 'dn');
  });
}

function applyFilter() {
  $$('#mktSeg button').forEach(b => b.classList.toggle('on', b.dataset.f === UI.filter));
  INSTRUMENTS.forEach(inst => {
    const r = UI.rows[inst.sym];
    if (!r) return;
    r.el.style.display = (UI.filter === 'all' || inst.cls === UI.filter) ? '' : 'none';
  });
}

/* ================= 交易页 ================= */
function inst() { return INSTRUMENTS.find(i => i.sym === UI.sym); }

function renderTrade(force) {
  const i = inst();
  const st = Market.get(UI.sym);
  const { bid, ask } = Market.bidAsk(i);

  $('#tSym').textContent = i.sym;
  $('#tName').textContent = i.name;
  $('#tPrice').textContent = Market.fmt(i, st.mid);
  $('#tPrice').className = '';

  const dp = (st.mid - st.dayOpen) / i.pip;
  const chEl = $('#tChg');
  chEl.textContent = (dp >= 0 ? '+' : '') + dp.toFixed(1) + ' 点';
  chEl.className = 'q-chg ' + (dp >= 0 ? 'up' : 'dn');

  $('#tSpread').textContent = i.spreadPip;
  $('#tPipVal').textContent = '$' + Market.pipValue(i, st.mid).toFixed(2);

  $('#bidPx').textContent = Market.fmt(i, bid);
  $('#askPx').textContent = Market.fmt(i, ask);
  $('#sprdPx').textContent = i.spreadPip + '点';
  $('#sellBtnPx').textContent = Market.fmt(i, bid);
  $('#buyBtnPx').textContent = Market.fmt(i, ask);

  // 0.01 手的保证金与点值
  const mg = Market.margin(i, 0.01, ask, Account.S.leverage);
  $('#miniInfo').innerHTML =
    `<span>0.01 手 ≈ 保证金 <b>${money(mg)}</b></span>
     <span>每点 <b>$${(Market.pipValue(i, st.mid) * 0.01).toFixed(2)}</b></span>`;

  // 本品种持仓条
  const ps = Account.S.positions.filter(p => p.sym === UI.sym);
  const strip = $('#posStrip');
  if (!ps.length) {
    strip.innerHTML = '';
  } else {
    strip.innerHTML = ps.map(p => {
      const pl = p.upnl || 0;
      return `<div class="strip-item" data-pid="${p.id}">
        <span class="tag ${p.dir > 0 ? 'long' : 'short'}">${p.dir > 0 ? '多' : '空'}</span>
        <span class="sp">${p.lots.toFixed(2)} 手 @ ${Market.fmt(i, p.entry)}</span>
        <span class="pnl ${pl >= 0 ? 'up' : 'dn'}">${signMoney(pl)}</span>
      </div>`;
    }).join('');
  }
}

/* ================= 下单面板 ================= */
function openOrder(dir) {
  const i = inst();
  const st = Market.get(UI.sym);
  const { bid, ask } = Market.bidAsk(i);
  let entry = dir > 0 ? ask : bid;
  UI.order = { dir, lots: 0.1, slOn: false, slPts: 30, tpOn: false, tpPts: 60, type: 'market' };

  const pv = Market.pipValue(i, st.mid);

  const body = `
    <div class="ordtype" id="ordType">
      <button class="on" data-t="market">市价单</button>
      <button data-t="limit">限价单</button>
    </div>
    <div class="est" id="ordEst"></div>
    <div id="ordWarn"></div>

    <div class="field" id="ordLimitBox" style="display:none">
      <label>委托价 <b id="ordLimitRef">—</b></label>
      <div class="stepper">
        <button data-lp="-10">−</button>
        <input class="input" id="ordLimit" inputmode="decimal">
        <button data-lp="10">+</button>
      </div>
      <div class="hint-line" id="ordLimitHint"></div>
    </div>

    <div class="field">
      <label>手数 <b id="ordLotsLbl">0.10 手</b></label>
      <div class="stepper">
        <button data-lots="-0.01">−</button>
        <input class="input" id="ordLots" value="0.10" inputmode="decimal">
        <button data-lots="0.01">+</button>
      </div>
      <div class="quick" id="ordQuick">
        <button data-q="0.01">0.01</button>
        <button data-q="0.1">0.10</button>
        <button data-q="0.5">0.50</button>
        <button data-q="1">1.00</button>
      </div>
    </div>

    <div class="switch-row">
      <div>
        <div class="sr-t">止损 SL</div>
        <div class="sr-d">亏到设定的点数自动平仓</div>
      </div>
      <div class="sw" id="swSL"></div>
    </div>
    <div id="ordSLBox" style="display:none">
      <div class="field" style="margin-top:10px">
        <label>止损点数 · 触发价 <b id="slPxTxt">—</b></label>
        <div class="stepper">
          <button data-sl="-5">−</button>
          <input class="input" id="ordSL" value="30" inputmode="numeric">
          <button data-sl="5">+</button>
        </div>
        <div class="quick" id="slQuick">
          <button data-sq="10">10 点</button>
          <button data-sq="20">20 点</button>
          <button data-sq="30">30 点</button>
          <button data-sq="50">50 点</button>
        </div>
      </div>
      <div class="warn-box info" id="slInfo"></div>
    </div>

    <div class="switch-row">
      <div>
        <div class="sr-t">止盈 TP</div>
        <div class="sr-d">赚到设定的点数自动平仓</div>
      </div>
      <div class="sw" id="swTP"></div>
    </div>
    <div id="ordTPBox" style="display:none">
      <div class="field" style="margin-top:10px">
        <label>止盈点数 · 触发价 <b id="tpPxTxt">—</b></label>
        <div class="stepper">
          <button data-tp="-10">−</button>
          <input class="input" id="ordTP" value="60" inputmode="numeric">
          <button data-tp="10">+</button>
        </div>
      </div>
    </div>

    <div class="warn-box" id="riskBar" style="display:none">
      <i>⚠</i><span>这笔单<b>没有止损</b>。理论最大亏损不受限制——价格可以一直走，直到吃光你的保证金。</span>
    </div>
  `;

  const foot = `
    <button class="btn ${dir > 0 ? 'btn-buy' : 'btn-sell'}" id="ordSubmit">
      ${dir > 0 ? '买入' : '卖出'} ${i.sym} · <span id="ordBtnPx">${Market.fmt(i, entry)}</span>
    </button>
  `;

  openSheet(`${dir > 0 ? '买入' : '卖出'} ${i.sym}`, body, foot);

  const refresh = () => {
    const o = UI.order;
    const live = Market.get(i.sym);
    const lb = Market.bidAsk(i);
    if (o.type === 'market') entry = o.dir > 0 ? lb.ask : lb.bid;
    const pvNow = Market.pipValue(i, live.mid);
    const mg = Market.margin(i, o.lots, entry, Account.S.leverage);
    const free = Account.freeMargin();
    const maxLoss = o.slOn ? o.slPts * pvNow * o.lots : null;
    const maxWin = o.tpOn ? o.tpPts * pvNow * o.lots : null;
    const riskPct = maxLoss != null ? maxLoss / Account.equity() * 100 : null;

    $('#ordLotsLbl').textContent = o.lots.toFixed(2) + ' 手';
    $('#ordLots').value = o.lots.toFixed(2);
    $$('#ordQuick button').forEach(b => b.classList.toggle('on', Math.abs(parseFloat(b.dataset.q) - o.lots) < 1e-9));

    $('#ordEst').innerHTML = `
      <div class="est-row"><span>开仓价</span><b>${Market.fmt(i, entry)}</b></div>
      <div class="est-row"><span>每点价值</span><b>${money(pvNow * o.lots)}</b></div>
      <div class="est-row"><span>占用保证金</span><b>${money(mg)}</b></div>
      <div class="est-row"><span>可用保证金</span><b class="${free < mg ? 'dn' : ''}">${money(free)}</b></div>
      ${maxLoss != null ? `<div class="est-row"><span>最大亏损（止损）</span><b class="dn">${money(maxLoss)} <small style="color:#5d697a">· 净值的 ${riskPct.toFixed(1)}%</small></b></div>` : ''}
      ${maxWin != null ? `<div class="est-row"><span>目标盈利（止盈）</span><b class="up">${money(maxWin)}</b></div>` : ''}
    `;

    if (o.slOn) {
      const slPrice = o.dir > 0 ? entry - o.slPts * i.pip : entry + o.slPts * i.pip;
      $('#slPxTxt').textContent = Market.fmt(i, slPrice);
      const level = riskPct > 5 ? 'danger' : 'info';
      $('#slInfo').className = 'warn-box ' + level;
      $('#slInfo').innerHTML = maxLoss > 0
        ? `<i>${riskPct > 5 ? '⚠' : '✓'}</i><span>止损价 ${Market.fmt(i, slPrice)}，最多亏 <b>${money(maxLoss)}</b>（净值的 ${riskPct.toFixed(1)}%）。${riskPct > 5 ? '单笔风险超过 5%，建议缩小手数。' : '这是一个可接受的风险水平。'}</span>`
        : '<i>⚠</i><span>请输入大于 0 的点数</span>';
    }
    if (o.tpOn) {
      const tpPrice = o.dir > 0 ? entry + o.tpPts * i.pip : entry - o.tpPts * i.pip;
      $('#tpPxTxt').textContent = Market.fmt(i, tpPrice);
    }

    if (o.type === 'limit') {
      const li = $('#ordLimit');
      if (document.activeElement !== li) li.value = Market.fmt(i, entry);
      $('#ordLimitRef').textContent = (o.dir > 0 ? '低于现价' : '高于现价') + ' ' + Market.fmt(i, o.dir > 0 ? lb.ask : lb.bid);
      const ref = o.dir > 0 ? lb.ask : lb.bid;
      const gap = (entry - ref) / i.pip * o.dir;   // <0 表示挂在更有利的一侧
      $('#ordLimitHint').textContent = gap === 0
        ? '委托价等于现价，会立刻成交'
        : gap > 0
          ? `⚠ 委托价已在现价${o.dir > 0 ? '之上' : '之下'}，会立即成交`
          : `距现价 ${Math.abs(gap).toFixed(1)} 点，价格回到 ${Market.fmt(i, entry)} 时自动成交`;
    }

    $('#riskBar').style.display = o.slOn ? 'none' : 'flex';
    $('#ordSubmit').disabled = false;
    const btn = $('#ordSubmit');
    if (mg > free) {
      btn.style.opacity = '.45';
      btn.textContent = '可用保证金不足';
    } else {
      btn.style.opacity = '1';
      btn.innerHTML = o.type === 'limit'
        ? `限价${o.dir > 0 ? '买入' : '卖出'} ${o.lots.toFixed(2)} 手 @ ${Market.fmt(i, entry)}`
        : `${o.dir > 0 ? '买入' : '卖出'} ${i.sym} · ${o.lots.toFixed(2)} 手`;
    }
  };

  // ---- 绑定 ----
  const setLots = v => {
    const o = UI.order;
    o.lots = Math.max(0.01, Math.min(50, Math.round(v * 100) / 100));
    refresh();
  };
  $('#ordType').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const t = b.dataset.t;
    UI.order.type = t;
    $$('#ordType button').forEach(x => x.classList.toggle('on', x === b));
    $('#ordLimitBox').style.display = t === 'limit' ? '' : 'none';
    const lb = Market.bidAsk(i);
    if (t === 'limit') {
      entry = UI.order.dir > 0 ? lb.ask - 20 * i.pip : lb.bid + 20 * i.pip;
      $('#ordLimit').value = Market.fmt(i, entry);
    }
    refresh();
  });
  $('#ordLimit').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0) { entry = v; refresh(); }
  });
  $$('.stepper [data-lp]').forEach(b => b.addEventListener('click', () => {
    entry += parseFloat(b.dataset.lp) * i.pip;
    $('#ordLimit').value = Market.fmt(i, entry);
    refresh();
  }));

  $$('#ordQuick button').forEach(b => b.addEventListener('click', () => setLots(parseFloat(b.dataset.q))));
  $$('.stepper [data-lots]').forEach(b => b.addEventListener('click', () => setLots(UI.order.lots + parseFloat(b.dataset.lots))));
  $('#ordLots').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) { UI.order.lots = Math.max(0.01, Math.min(50, v)); refresh(); }
  });
  $('#ordLots').addEventListener('blur', e => setLots(parseFloat(e.target.value) || 0.1));

  $('#swSL').addEventListener('click', () => {
    UI.order.slOn = !UI.order.slOn;
    $('#swSL').classList.toggle('on', UI.order.slOn);
    $('#ordSLBox').style.display = UI.order.slOn ? '' : 'none';
    refresh();
  });
  $('#swTP').addEventListener('click', () => {
    UI.order.tpOn = !UI.order.tpOn;
    $('#swTP').classList.toggle('on', UI.order.tpOn);
    $('#ordTPBox').style.display = UI.order.tpOn ? '' : 'none';
    refresh();
  });
  $$('.stepper [data-sl]').forEach(b => b.addEventListener('click', () => {
    UI.order.slPts = Math.max(1, UI.order.slPts + parseFloat(b.dataset.sl));
    $('#ordSL').value = UI.order.slPts; refresh();
  }));
  $$('#slQuick button').forEach(b => b.addEventListener('click', () => {
    UI.order.slPts = parseFloat(b.dataset.sq); $('#ordSL').value = UI.order.slPts; refresh();
  }));
  $('#ordSL').addEventListener('input', e => {
    const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) { UI.order.slPts = v; refresh(); }
  });
  $$('.stepper [data-tp]').forEach(b => b.addEventListener('click', () => {
    UI.order.tpPts = Math.max(1, UI.order.tpPts + parseFloat(b.dataset.tp));
    $('#ordTP').value = UI.order.tpPts; refresh();
  }));
  $('#ordTP').addEventListener('input', e => {
    const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) { UI.order.tpPts = v; refresh(); }
  });

  $('#ordSubmit').addEventListener('click', () => {
    const o = UI.order;
    const pvNow = Market.pipValue(i, Market.get(i.sym).mid);
    const mg = Market.margin(i, o.lots, entry, Account.S.leverage);
    if (mg > Account.freeMargin()) { toast('可用保证金不足', 'bad'); return; }

    const sl = o.slOn ? (o.dir > 0 ? entry - o.slPts * i.pip : entry + o.slPts * i.pip) : null;
    const tp = o.tpOn ? (o.dir > 0 ? entry + o.tpPts * i.pip : entry - o.tpPts * i.pip) : null;

    const r = Account.open({ sym: i.sym, dir: o.dir, lots: o.lots, sl, tp, type: o.type, price: entry });
    if (!r.ok) { toast(r.msg, 'bad'); return; }
    closeSheet();
    if (o.type === 'limit') {
      toast(`挂单已提交：${o.dir > 0 ? '买入' : '卖出'} ${o.lots.toFixed(2)} 手 @ ${Market.fmt(i, entry)}`, 'good');
      renderAll();
      return;
    }
    const lossTxt = o.slOn ? `，止损 ${o.slPts} 点（最多亏 ${money(o.slPts * pvNow * o.lots)}）` : '，未设止损';
    toast(`${o.dir > 0 ? '买入' : '卖出'} ${o.lots.toFixed(2)} 手 ${i.sym}${lossTxt}`, 'good');
    renderAll();
  });

  refresh();
}

/* ================= 持仓页 ================= */
function renderPositions() {
  const S = Account.S;
  const eq = Account.equity();
  const um = Account.usedMargin();
  const free = eq - um;
  const ml = Account.marginLevel();

  $('#sBal').textContent = money(S.balance);
  $('#sEq').textContent = money(eq);
  $('#sMargin').textContent = money(um);
  $('#sFree').textContent = money(free);

  const fill = $('#mlFill');
  const mlTxt = $('#mlTxt');
  if (!isFinite(ml)) {
    fill.style.width = '0%';
    mlTxt.textContent = '保证金比例 —（无持仓）';
  } else {
    const w = Math.min(100, ml / 300 * 100);
    fill.style.width = w + '%';
    mlTxt.textContent = `保证金比例 ${ml > 9999 ? '>9999' : ml.toFixed(0)}%` + (ml < Account.STOP_OUT ? ' · 爆仓线' : ml < Account.WARN ? ' · 预警' : ' · 安全');
    fill.style.background = ml < Account.STOP_OUT
      ? 'var(--dn)'
      : ml < Account.WARN
        ? 'var(--orange)'
        : 'var(--green)';
  }

  $$('#posSeg button').forEach(b => b.classList.toggle('on', b.dataset.p === UI.posSeg));
  const body = $('#posBody');

  if (UI.posSeg === 'open') {
    if (!S.positions.length) {
      body.innerHTML = `<div class="empty"><i><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></svg></i>还没有持仓<br>去「交易」页试一笔 0.01 手</div>`;
    } else {
      // 按开仓时间倒序
      const arr = [...S.positions].reverse();
      body.innerHTML = arr.map(p => {
        const i = Account.inst(p.sym);
        const mark = p.mark != null ? p.mark : p.entry;
        const pts = Market.pointsBetween(i, p.entry, mark) * p.dir;
        const pl = p.upnl || 0;
        const dur = Math.floor((Date.now() - p.openAt) / 60000);
        return `<div class="pcard ${p.dir > 0 ? 'long' : 'short'}" data-pid="${p.id}">
          <div class="pcard-top">
            <span class="tag ${p.dir > 0 ? 'long' : 'short'}">${p.dir > 0 ? '多' : '空'}</span>
            <b>${p.sym}</b><span class="pcard-name">${i.name}</span>
            <span class="lots">${p.lots.toFixed(2)} 手 · ${dur}m</span>
          </div>
          <div class="pgrid">
            <div><span>开仓</span><b>${Market.fmt(i, p.entry)}</b></div>
            <div><span>现价</span><b>${Market.fmt(i, mark)}</b></div>
            <div><span>点数</span><b class="${pts >= 0 ? 'up' : 'dn'}">${pts >= 0 ? '+' : ''}${pts.toFixed(1)}</b></div>
          </div>
          <div class="pgrid" style="margin-bottom:0">
            <div><span>保证金</span><b>${money(p.margin)}</b></div>
            <div><span>止损</span><b>${p.sl != null ? Market.fmt(i, p.sl) : '未设'}</b></div>
            <div><span>止盈</span><b>${p.tp != null ? Market.fmt(i, p.tp) : '未设'}</b></div>
          </div>
          <div class="pcard-pnl">
            <span class="lbl">浮动盈亏</span>
            <span class="val ${pl >= 0 ? 'up' : 'dn'}">${signMoney(pl)}</span>
          </div>
        </div>`;
      }).join('');
      body.querySelectorAll('.pcard').forEach(c => c.addEventListener('click', () => openPosSheet(c.dataset.pid)));
    }
  } else if (UI.posSeg === 'pending') {
    if (!S.pending.length) {
      body.innerHTML = `<div class="empty"><i>⌁</i>没有挂单<br>挂单功能在「交易」页限价单模式下可用</div>`;
    } else {
      body.innerHTML = S.pending.map(o => {
        const i = Account.inst(o.sym);
        return `<div class="pcard" data-oid="${o.id}">
          <div class="pcard-top">
            <span class="tag ${o.dir > 0 ? 'long' : 'short'}">${o.dir > 0 ? '多' : '空'}</span>
            <b>${o.sym}</b>
            <span class="lots">${o.lots.toFixed(2)} 手</span>
          </div>
          <div class="pgrid" style="margin-bottom:0">
            <div><span>挂单价</span><b>${Market.fmt(i, o.price)}</b></div>
            <div><span>现价</span><b>${Market.fmt(i, Market.get(o.sym).mid)}</b></div>
            <div><span>操作</span><b style="color:#f2415f">点此撤销</b></div>
          </div>
        </div>`;
      }).join('');
      body.querySelectorAll('.pcard').forEach(c => c.addEventListener('click', () => {
        Account.cancelPending(c.dataset.oid); toast('挂单已撤销');
      }));
    }
  } else {
    if (!S.history.length) {
      body.innerHTML = `<div class="empty"><i>▤</i>还没有平仓记录</div>`;
    } else {
      body.innerHTML = S.history.slice(0, 60).map(h => {
        const i = Account.inst(h.sym);
        const t = new Date(h.at);
        const ts = `${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        return `<div class="hrow">
          <span class="tag ${h.dir > 0 ? 'long' : 'short'}">${h.dir > 0 ? '多' : '空'}</span>
          <div class="hs"><b>${h.sym} ${h.lots.toFixed(2)}手${h.partial ? ' · 部分' : ''}${h.why && h.why !== '手动' ? ` <em class="why">${h.why}</em>` : ''}</b>
            <span>${Market.fmt(i, h.entry)} → ${Market.fmt(i, h.exit)} · ${ts}</span></div>
          <span class="hp ${h.pnl >= 0 ? 'up' : 'dn'}">${signMoney(h.pnl)}</span>
        </div>`;
      }).join('');
    }
  }
}

/* ================= 持仓详情 / 平仓 ================= */
function openPosSheet(id) {
  const p = Account.S.positions.find(x => x.id === id);
  if (!p) return;
  const i = Account.inst(p.sym);
  const mark = p.mark != null ? p.mark : p.entry;
  const pl = p.upnl || 0;

  const body = `
    <div class="est">
      <div class="est-row"><span>品种 / 方向</span><b>${p.sym} · ${p.dir > 0 ? '多单' : '空单'}</b></div>
      <div class="est-row"><span>手数</span><b>${p.lots.toFixed(2)} 手</b></div>
      <div class="est-row"><span>开仓价 → 现价</span><b>${Market.fmt(i, p.entry)} → ${Market.fmt(i, mark)}</b></div>
      <div class="est-row"><span>占用保证金</span><b>${money(p.margin)}</b></div>
      <div class="est-row"><span>止损 / 止盈</span><b>${p.sl != null ? Market.fmt(i, p.sl) : '未设'} / ${p.tp != null ? Market.fmt(i, p.tp) : '未设'}</b></div>
      <div class="est-row" style="border-top:1px dashed rgba(255,255,255,.1);padding-top:7px;margin-top:2px">
        <span>当前浮动盈亏</span><b class="${pl >= 0 ? 'up' : 'dn'}" style="font-size:15px">${signMoney(pl)}</b></div>
    </div>

    <div class="field">
      <label>修改止损（价格，留空则清除）<b>${p.sl != null ? Market.fmt(i, p.sl) : '未设'}</b></label>
      <input class="input" id="mSL" placeholder="${Market.fmt(i, p.dir > 0 ? mark - 30 * i.pip : mark + 30 * i.pip)}" value="${p.sl != null ? Market.fmt(i, p.sl) : ''}" inputmode="decimal">
    </div>
    <div class="field">
      <label>修改止盈（价格，留空则清除）<b>${p.tp != null ? Market.fmt(i, p.tp) : '未设'}</b></label>
      <input class="input" id="mTP" placeholder="${Market.fmt(i, p.dir > 0 ? mark + 60 * i.pip : mark - 60 * i.pip)}" value="${p.tp != null ? Market.fmt(i, p.tp) : ''}" inputmode="decimal">
    </div>
    <div class="quick" id="modQuick">
      <button data-mod="sl30">止损 30 点</button>
      <button data-mod="sl50">止损 50 点</button>
      <button data-mod="tponly">保存</button>
    </div>
    <div class="warn-box info" style="margin-top:12px"><i>ⓘ</i><span>止损只能往<b>减少风险</b>的方向改（多单只能往高处移，空单只能往低处移）。</span></div>
  `;

  const foot = `
    <button class="btn btn-ghost" id="closeHalf">平半仓</button>
    <button class="btn btn-sell" id="closeAll">全部平仓</button>
  `;
  openSheet('持仓详情', body, foot);

  $('#closeAll').addEventListener('click', () => {
    Account.close(p.id, 1);
    closeSheet(); toast('已平仓', 'good'); renderAll();
  });
  $('#closeHalf').addEventListener('click', () => {
    Account.close(p.id, 0.5);
    closeSheet(); toast('已平掉一半仓位', 'good'); renderAll();
  });

  const saveMod = () => {
    const slv = $('#mSL').value.trim(), tpv = $('#mTP').value.trim();
    const sl = slv === '' ? null : parseFloat(slv);
    const tp = tpv === '' ? null : parseFloat(tpv);
    if (sl != null && isNaN(sl)) { toast('止损价格无效', 'bad'); return; }
    if (tp != null && isNaN(tp)) { toast('止盈价格无效', 'bad'); return; }
    Account.modify(p.id, sl, tp);
    closeSheet(); toast('已更新', 'good'); renderAll();
  };
  $('#modQuick').addEventListener('click', e => {
    const b = e.target.closest('[data-mod]');
    if (!b) return;
    const m = b.dataset.mod;
    if (m === 'tponly') { saveMod(); return; }
    const pts = m === 'sl30' ? 30 : 50;
    $('#mSL').value = Market.fmt(i, p.dir > 0 ? mark - pts * i.pip : mark + pts * i.pip);
  });
}
/* ================= 学习页 ================= */
function renderLearn() {
  const S = Account.S;
  const doneN = LESSONS.filter(l => Account.lessonDone(l)).length;

  $('#lessonCount').textContent = doneN + '/' + LESSONS.length + ' 关';

  const p = doneN / LESSONS.length;
  const deg = p * 360;
  $('#ring').style.background = `conic-gradient(var(--acc) ${deg}deg, var(--fill3) ${deg}deg)`;
  $('#ringTxt').textContent = Math.round(p * 100) + '%';

  const names = ['第一课', '第二课', '第三课', '第四课', '通关'];
  const exam = S.flags.examPass;
  $('#lvlDesc').textContent = doneN >= 5
    ? (exam
      ? `已通过模拟考试（${exam} 分）· 你可以独立看盘、下单、控风险了。`
      : '五关全部完成。去「模拟考试」拿毕业证。')
    : '从「点差是什么」走到「能自己设止损」。';
  $('#lvlName').textContent = exam ? '已毕业' : ('新手 · ' + (doneN >= 5 ? '已通关' : names[doneN]));

  const cert = $('#certCard');
  if (cert) {
    if (exam) {
      cert.hidden = false;
      cert.innerHTML = `<div class="cert-in">
        <div class="cert-seal">FX</div>
        <div class="cert-txt"><b>结业证书</b>
        <span>模拟考试 ${exam} 分 · ${new Date().toLocaleDateString('zh-CN')}</span></div>
      </div>`;
    } else cert.hidden = true;
  }

  $('#medals').innerHTML = LESSONS.map(l => {
    const d = Account.lessonDone(l);
    return `<span class="medal ${d ? 'got' : ''}">${d ? '★' : l.id.slice(1)}</span>`;
  }).join('');

  $('#lessonList').innerHTML = LESSONS.map((l, idx) => {
    const done = Account.lessonDone(l);
    return `<button class="lesson ${done ? 'done' : ''}" data-ls="${l.id}">
      <span class="lk">${done ? '✓' : idx + 1}</span>
      <div class="lesson-txt"><b>${l.t}</b><span>${done ? '已完成 · 点击复习' : l.s}</span></div>
      <span class="arw">›</span>
    </button>`;
  }).join('');
  $$('#lessonList .lesson').forEach(b => b.addEventListener('click', () => openLesson(b.dataset.ls)));

  // 复盘
  const r = Account.review();
  $('#reviewCard').innerHTML = `
    <div class="rv-row"><span>总交易笔数</span><b>${r.n}</b></div>
    <div class="rv-row"><span>胜率</span><b>${r.n ? r.winRate.toFixed(1) + '%' : '—'}</b></div>
    <div class="rv-bar"><i style="width:${r.n ? r.winRate : 0}%;background:${r.winRate >= 50 ? 'var(--up)' : 'var(--dn)'}"></i></div>
    <div class="rv-row"><span>盈亏比（Profit Factor）</span><b>${r.n ? r.pf.toFixed(2) : '—'}</b></div>
    <div class="rv-row"><span>平均盈利 / 平均亏损</span><b>${r.n ? money(r.avgWin) + ' / ' + money(r.avgLoss) : '—'}</b></div>
    <div class="rv-row"><span>无止损平仓</span><b style="color:${r.noSL > 0 ? '#f2415f' : 'var(--up)'}">${r.noSL} 笔</b></div>
    <div class="rv-row"><span>最佳 / 最差单笔</span><b>${r.n ? signMoney(r.best) + ' / ' + money(r.worst) : '—'}</b></div>
    <div class="rv-row"><span>累计净盈亏</span><b class="${r.net >= 0 ? 'up' : 'dn'}">${signMoney(r.net)}</b></div>
    ${r.n === 0 ? '<div style="font-size:10px;color:var(--dim2);text-align:center;padding:4px 0">平仓后这里会出现你的统计画像</div>' : ''}
  `;

  $('#glossGrid').innerHTML = GLOSSARY.map(g =>
    `<button class="gcard" data-k="${g.k}"><b>${g.t}</b><span>${g.d}</span></button>`
  ).join('');
  $$('#glossGrid .gcard').forEach(b => b.addEventListener('click', () => openGlossary(b.dataset.k)));
}

function openGlossary(k) {
  const g = GLOSSARY.find(x => x.k === k);
  if (!g) return;
  openSheet(g.t, `<div class="ls-body"><p style="color:var(--dim2);font-size:11px">${g.d}</p><p>${g.b}</p></div>`, '');
}

function openLesson(id) {
  const l = LESSONS.find(x => x.id === id);
  if (!l) return;
  const done = Account.lessonDone(l);
  const body = `<div class="ls-body">${l.body}
    <div class="warn-box ${done ? 'info' : ''}" style="margin-top:14px">
      <i>${done ? '✓' : '◎'}</i><span>任务：${l.task}${done ? '　<b style="color:#8ce8bf">已完成</b>' : '　（完成后自动打勾）'}</span>
    </div></div>`;
  const foot = done
    ? `<button class="btn btn-ghost" data-close>复习完毕</button>`
    : `<button class="btn btn-line" id="goTrade">去交易页练习</button>`;
  openSheet(l.t, body, foot);
  const g = $('#goTrade');
  if (g) g.addEventListener('click', () => { closeSheet(); switchTab('trade'); });
}

/* ---------- 杠杆实验室 ---------- */
function openLeverageLab() {
  const i = INSTRUMENTS[0];
  let lots = 1, lev = 100, seen = new Set([100]);
  const body = `
    <div class="ls-body">
      <p>同样的仓位，换个杠杆，占用保证金差多少？盈亏会变吗？拖一下看看。</p>
      <div class="field" style="margin-top:14px">
        <label>仓位 <b id="labLots">1.00 手</b></label>
        <input type="range" class="slider" id="labLotsR" min="1" max="20" value="10">
        <div class="slider-val" id="labLotsV">1.00 手 EUR/USD</div>
      </div>
      <div class="field">
        <label>杠杆 <b id="labLevL">1:100</b></label>
        <input type="range" class="slider" id="labLevR" min="0" max="3" step="1" value="1">
        <div class="quick" id="labLevQ">
          <button data-lv="100" class="on">1:100</button>
          <button data-lv="200">1:200</button>
          <button data-lv="400">1:400</button>
          <button data-lv="500">1:500</button>
        </div>
      </div>
      <div class="ls-demo" id="labOut"></div>
      <div class="ls-key" id="labNote"></div>
    </div>`;
  openSheet('杠杆实验室', body, `<button class="btn btn-ghost" data-close>关闭</button>`);

  const levs = [100, 200, 400, 500];
  const calc = () => {
    const price = Market.get('EUR/USD').mid;
    const notional = lots * 100000 * price;
    const mg = notional / lev;
    const eq = 10000;
    const ml = eq / mg * 100;
    const free = eq - mg;
    // 能扛多少点才爆仓（假设只有这一笔，净值跌到 50% 保证金）
    const liqLoss = eq - mg * 0.5;
    const pips = liqLoss / (lots * 10);

    $('#labLotsV').textContent = lots.toFixed(2) + ' 手 EUR/USD';
    $('#labLevL').textContent = '1:' + lev;
    $('#labLots').textContent = lots.toFixed(2) + ' 手';

    $('#labOut').innerHTML = `
      <div class="demo-row"><span>名义价值</span><b>${money0(notional)}</b></div>
      <div class="demo-row"><span>占用保证金</span><b style="color:#e8b44a">${money(mg)}</b></div>
      <div class="demo-row"><span>可用保证金</span><b>${money(free)}</b></div>
      <div class="demo-row"><span>保证金比例（初始）</span><b>${ml.toFixed(0)}%</b></div>
      <div class="demo-row" style="border-top:1px dashed rgba(255,255,255,.1);margin-top:6px;padding-top:8px">
        <span>每点盈亏（与杠杆无关）</span><b class="up">$${(lots * 10).toFixed(2)}</b></div>
      <div class="demo-row"><span>能扛多少点才爆仓</span><b style="color:${pips < 100 ? '#f2415f' : '#16c784'}">${pips.toFixed(0)} 点</b></div>
    `;

    const base = (10000 - (lots * 100000 * price) / lev);
    let note = '';
    if (ml < 100) note = '初始保证金比例就低于 100%——这笔仓位对 1 万本金来说太大了，一开仓就在爆仓边缘。';
    else if (pips < 80) note = `只扛得住 ${pips.toFixed(0)} 点。EUR/USD 一天波动 80 点很正常，这个仓位等于在等爆仓。`;
    else if (lots * 10 * 100 > 2000) note = '每点 $' + (lots * 10).toFixed(0) + '——波动 20 点就是 ' + money(lots * 10 * 20) + '，本金撑不了几次。真正决定风险的是手数，杠杆只是决定"你能开到多大"。';
    else note = `保证金占用 ${(mg / 10000 * 100).toFixed(1)}% 本金，每点 $${(lots * 10).toFixed(2)}。这个仓位相对 1 万本金是可控的。`;
    $('#labNote').textContent = note;

    seen.add(lev);
    if (seen.size >= 2) Account.bumpFlag('leverageLab', seen.size);
  };

  $('#labLotsR').addEventListener('input', e => {
    lots = parseInt(e.target.value) / 10; calc();
  });
  $('#labLevR').addEventListener('input', e => {
    lev = levs[parseInt(e.target.value)];
    $$('#labLevQ button').forEach(b => b.classList.toggle('on', +b.dataset.lv === lev));
    calc();
  });
  $('#labLevQ').addEventListener('click', e => {
    const b = e.target.closest('[data-lv]');
    if (!b) return;
    lev = +b.dataset.lv;
    $('#labLevR').value = levs.indexOf(lev);
    $$('#labLevQ button').forEach(x => x.classList.toggle('on', x === b));
    calc();
  });
  lots = 1; lev = 100; calc();
  Account.bumpFlag('leverageLab', 1);
}

/* ---------- 爆仓实验室 ---------- */
function openLiqLab() {
  let lots = 2, dir = 1;
  const price0 = Market.get('EUR/USD').mid;
  const body = `
    <div class="ls-body">
      <p>用 1 万美元本金，选一个仓位，然后拖动滑块模拟行情逆行，看净值怎么被吃光。</p>
      <div class="field" style="margin-top:14px">
        <label>仓位 <b id="liqLots">2.00 手</b></label>
        <input type="range" class="slider" id="liqLotsR" min="1" max="80" value="20">
        <div class="quick" id="liqDir">
          <button data-d="1" class="on">做多</button>
          <button data-d="-1">做空</button>
        </div>
      </div>
      <div class="field">
        <label>行情逆行点数 <b id="liqPts">0 点</b></label>
        <input type="range" class="slider" id="liqPtsR" min="0" max="1000" value="0">
      </div>
      <div class="ls-demo" id="liqOut"></div>
      <div class="warn-box danger" id="liqBoom" style="display:none"><i>💥</i><span><b>强制平仓触发</b>——净值已跌破已用保证金的 50%。平台会平掉亏损最大的仓位，你的余额就定格在这个数字上了。</span></div>
      <div class="ls-key" id="liqNote"></div>
    </div>`;
  openSheet('爆仓实验室', body, `<button class="btn btn-ghost" data-close>关闭</button>`);

  const upd = () => {
    const price = Market.get('EUR/USD').mid;
    const notional = lots * 100000 * price;
    const mg = notional / 100;
    const pts = parseInt($('#liqPtsR').value);
    const loss = pts * lots * 10;
    const eq = Math.max(0, 10000 - loss);
    const ml = mg > 0 ? eq / mg * 100 : Infinity;
    const boom = ml < 50;

    $('#liqLots').textContent = lots.toFixed(2) + ' 手';
    $('#liqPts').textContent = (pts > 0 ? '−' : '') + pts + ' 点';

    $('#liqOut').innerHTML = `
      <div class="demo-row"><span>占用保证金</span><b>${money(mg)}</b></div>
      <div class="demo-row"><span>每点盈亏</span><b>$${(lots * 10).toFixed(2)}</b></div>
      <div class="demo-row"><span>累计浮亏</span><b class="dn">${money(loss)}</b></div>
      <div class="demo-row"><span>净值</span><b style="color:${ml < 50 ? '#f2415f' : ml < 100 ? '#e8b44a' : '#16c784'}">${money(eq)}</b></div>
      <div class="demo-row"><span>保证金比例</span><b style="color:${ml < 50 ? '#f2415f' : ml < 100 ? '#e8b44a' : '#16c784'}">${ml > 999 ? '>999' : ml.toFixed(0)}%</b></div>
    `;
    $('#liqBoom').style.display = boom ? 'flex' : 'none';

    let note = '';
    if (boom) {
      const liqPts = Math.round((10000 - mg * 0.5) / (lots * 10));
      note = `这个仓位只扛得住 ${liqPts} 点。也就是说，行情随便走 ${liqPts} 点，你就出局了——即使你的方向最终是对的。`;
      Account.bumpFlag('liqLab', true);
    } else if (ml < 100) {
      note = '已跌破 100% 预警线。此刻你只能祈祷，因为你没有剩余保证金可以补了。';
    } else {
      note = '还在安全区。试着把「逆行点数」继续往右拖。';
    }
    $('#liqNote').textContent = note;
  };

  $('#liqLotsR').addEventListener('input', e => { lots = parseInt(e.target.value) / 10; upd(); });
  $('#liqPtsR').addEventListener('input', upd);
  $('#liqDir').addEventListener('click', e => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    dir = +b.dataset.d;
    $$('#liqDir button').forEach(x => x.classList.toggle('on', x === b));
    upd();
  });
  upd();
}

/* ---------- 测验 / 考试 ---------- */
function openQuiz(kind) {
  const isExam = kind === 'exam';
  const bank = isExam ? EXAM.slice().sort(() => Math.random() - 0.5).slice(0, 15) : QUIZ.slice().sort(() => Math.random() - 0.5).slice(0, 8);
  let idx = 0, picks = [], startT = Date.now(), limit = isExam ? 600 : 0;

  function render() {
    const q = bank[idx];
    const picked = picks[idx];
    const answered = picked != null;
    const body = `
      <div class="q-top">
        <span>第 <b>${idx + 1}</b> / ${bank.length} 题</span>
        ${isExam ? `<span class="q-time" id="qTime">10:00</span>` : `<span>点击选项即时判分</span>`}
      </div>
      <div class="q-title">${q.q}</div>
      ${q.o.map((o, i) => {
        let cls = 'q-opt';
        if (answered && !isExam) {
          if (i === q.a) cls += ' ok';
          else if (i === picked) cls += ' bad';
        } else if (answered && isExam) {
          if (i === picked) cls += ' pick';
        }
        return `<button class="${cls}" data-i="${i}">${String.fromCharCode(65 + i)}. ${o}</button>`;
      }).join('')}
      ${answered && !isExam ? `<div class="q-exp"><b>${picked === q.a ? '✓ 正确' : '✗ 不对'}：</b>${q.e}</div>` : ''}
      ${answered && isExam ? `<div class="q-exp" style="color:#5d697a">已选择 ${String.fromCharCode(65 + picked)}。</div>` : ''}
    `;
    const foot = isExam
      ? (idx < bank.length - 1
        ? `<button class="btn btn-line" id="qNext" ${picked == null ? 'disabled style="opacity:.4"' : ''}>下一题</button>`
        : `<button class="btn btn-buy" id="qNext" ${picked == null ? 'disabled style="opacity:.4"' : ''}>交卷</button>`)
      : (answered
        ? (idx < bank.length - 1 ? `<button class="btn btn-line" id="qNext">下一题</button>` : `<button class="btn btn-buy" id="qNext">看结果</button>`)
        : `<button class="btn btn-ghost" data-close>退出</button>`);

    openSheet(isExam ? '模拟考试' : '随堂测验', body, foot);

    $$('.q-opt').forEach(b => b.addEventListener('click', () => {
      if (picks[idx] != null && !isExam) return;
      const i = +b.dataset.i;
      if (isExam) { picks[idx] = i; render(); return; }
      picks[idx] = i;
      render();
    }));

    const nx = $('#qNext');
    if (nx) nx.addEventListener('click', () => {
      if (idx < bank.length - 1) { idx++; render(); }
      else finish();
    });
  }

  function finish() {
    let correct = 0;
    bank.forEach((q, i) => { if (picks[i] === q.a) correct++; });
    const score = Math.round(correct / bank.length * 100);
    const pass = score >= 80;

    const detail = bank.map((q, i) => {
      const ok = picks[i] === q.a;
      return `<div style="padding:9px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:11.5px;line-height:1.5;margin-bottom:4px">
          <span style="color:${ok ? '#16c784' : '#f2415f'};font-weight:700">${ok ? '✓' : '✗'}</span>
          ${q.q}</div>
        <div style="font-size:10.5px;color:#5d697a;line-height:1.6">
          ${ok ? '' : `你选了 ${picks[i] != null ? String.fromCharCode(65 + picks[i]) : '（未答）'}，正确是 ${String.fromCharCode(65 + q.a)}。`}
          ${q.e}</div>
      </div>`;
    }).join('');

    const body = `
      <div class="result-big">
        <div class="sc" style="color:${pass ? '#16c784' : '#f2415f'}">${score}<small>分</small></div>
        <div class="jud" style="color:${pass ? '#16c784' : '#e8b44a'}">${isExam ? (pass ? '合格 · 可以开模拟盘了' : '未通过 · 80 分及格') : (score >= 80 ? '掌握得不错' : '还有几个概念要补')}</div>
        <div class="dt">答对 ${correct} / ${bank.length} 题</div>
      </div>
      <div class="ls-body">${detail}</div>
    `;
    if (isExam && pass) Account.bumpFlag('examPass', score);

    openSheet('成绩', body, `<button class="btn btn-ghost" data-close>关闭</button>`);
  }

  render();

  if (isExam) {
    const t = setInterval(() => {
      if (!$('#modal').classList.contains('on')) { clearInterval(t); return; }
      const left = limit - Math.floor((Date.now() - startT) / 1000);
      const el = $('#qTime');
      if (el) {
        el.textContent = String(Math.max(0, Math.floor(left / 60))).padStart(2, '0') + ':' + String(Math.max(0, left % 60)).padStart(2, '0');
        el.style.color = left < 60 ? '#f2415f' : '';
      }
      if (left <= 0) { clearInterval(t); finish(); }
    }, 500);
  }
}

/* ================= Tab 切换 ================= */
function switchTab(tab) {
  UI.tab = tab;
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + tab));
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.view').forEach(v => { if (v.id === 'view-' + tab) v.scrollTop = 0; });
  if (tab === 'positions') renderPositions();
  if (tab === 'learn') renderLearn();
  if (tab === 'trade') {
    renderTrade();
    requestAnimationFrame(() => Chart.resize());
  }
}

function renderAll() {
  renderTop();
  updateMarket();
  if (UI.tab === 'trade') renderTrade();
  if (UI.tab === 'positions') renderPositions();
  if (UI.tab === 'learn') renderLearn();
}

/* ================= 主循环 ================= */
let lastTick = 0;
let lastChart = 0;

function boot() {
  Market.init();
  Account.load();

  buildMarket();
  Chart.attach($('#chart'));

  // tab
  $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // 行情筛选
  $('#mktSeg').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    UI.filter = b.dataset.f;
    applyFilter();
  });

  // 品种切换
  const syms = INSTRUMENTS.map(i => i.sym);
  $('#symPrev').addEventListener('click', () => {
    const i = syms.indexOf(UI.sym);
    pickSym(syms[(i - 1 + syms.length) % syms.length]);
  });
  $('#symNext').addEventListener('click', () => {
    const i = syms.indexOf(UI.sym);
    pickSym(syms[(i + 1) % syms.length]);
  });
  $('#symPick').addEventListener('click', () => {
    openSheet('选择品种', `<div class="list">${INSTRUMENTS.map(i => `
      <button class="row" data-pick="${i.sym}">
        <div class="row-flag ${i.cls}">${i.flag}</div>
        <div class="row-mid"><b>${i.sym}</b><span>${i.name} · 点差 ${i.spreadPip}</span></div>
        <div class="row-right"><span class="row-px">${Market.fmt(i, Market.get(i.sym).mid)}</span></div>
      </button>`).join('')}</div>`, '');
    $$('[data-pick]').forEach(b => b.addEventListener('click', () => {
      closeSheet(); pickSym(b.dataset.pick);
    }));
  });

  // 周期 / 指标
  $('#tfBar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    UI.tf = +b.dataset.tf;
    $$('#tfBar button').forEach(x => x.classList.toggle('on', x === b));
    Chart.set(UI.sym, UI.tf);
  });
  $('#indBtn').addEventListener('click', () => {
    const on = Chart.toggleMA();
    $('#indBtn').classList.toggle('on', on);
  });
  $('#rsiBtn').addEventListener('click', () => {
    const on = Chart.toggleRSI();
    $('#rsiBtn').classList.toggle('on', on);
  });

  // 下单
  $('#btnBuy').addEventListener('click', () => openOrder(1));
  $('#btnSell').addEventListener('click', () => openOrder(-1));

  // 持仓分段
  $('#posSeg').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    UI.posSeg = b.dataset.p;
    renderPositions();
  });

  // 重置
  $('#resetBtn').addEventListener('click', () => {
    openSheet('重置账户', `<div class="ls-body"><p>确定要把账户恢复成 $10,000 吗？所有持仓、挂单、历史记录和关卡进度都会被清空。</p></div>`,
      `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-sell" id="doReset">确认重置</button>`);
    $('#doReset').addEventListener('click', () => {
      Account.reset(); closeSheet(); toast('账户已重置为 $10,000', 'good'); switchTab('positions');
    });
  });

  // 学习工具
  $$('.tool').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'leverage') openLeverageLab();
    if (t === 'liq') openLiqLab();
    if (t === 'quiz') openQuiz('quiz');
    if (t === 'exam') openQuiz('exam');
  }));

  // 账户按钮
  $('#acctBtn').addEventListener('click', () => switchTab('positions'));

  // ---- 时钟 ----
  const clock = () => {
    const d = new Date();
    $('#mktTime').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + ' 模拟';
  };
  clock(); setInterval(clock, 1000);

  // ---- tick ----
  Market.onTick(() => {
    const closes = Account.tickRealtime();
    if (closes.length) {
      closes.forEach(c => {
        if (c.why === '强平') toast('⚠ 保证金比例过低，已强制平仓', 'bad');
        else if (c.why === '止损') toast('止损触发，仓位已平', 'bad');
        else if (c.why === '止盈') toast('止盈达成 ✓', 'good');
      });
      renderAll();
    }
    // 隔夜利息
    if (Market.isNewDay()) {
      const sw = Account.applySwap();
      if (Account.S.positions.length) toast(`隔夜利息结算 ${signMoney(sw)}`);
    }
  });

  setInterval(stepUI, 260);
  function stepUI() {
    updateMarket();
    renderTop();
    if (UI.tab === 'trade') renderTrade();
    if (UI.tab === 'positions') renderPositions();
    const now = Date.now();
    if (UI.tab === 'trade' && now - lastChart > 500) {
      lastChart = now;
      Chart.draw();
    }
  }

  renderTrade(true);
  const h = (location.hash || '').replace('#', '');
  switchTab(['market','trade','positions','learn'].includes(h) ? h : 'market');
  Market.start();

  window.addEventListener('error', e => {
    document.title = 'ERR: ' + e.message;
  });
}

document.addEventListener('DOMContentLoaded', boot);
