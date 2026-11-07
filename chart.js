/* ================= K 线图 ================= */
const Chart = (() => {
  let cv, ctx, W = 0, H = 0, dpr = 1;
  let sym = 'EUR/USD', tf = 1, showMA = true, showRSI = false;
  let padL = 6, padR = 52, padT = 8, padB = 18;

  /* 配色统一从 CSS 变量读取，跟随浅色/深色主题 */
  let CT = null;
  function theme() {
    if (CT) return CT;
    const cs = getComputedStyle(document.documentElement);
    const g = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
    CT = {
      grid:  g('--ch-grid', 'rgba(0,0,0,.06)'),
      axis:  g('--ch-axis', 'rgba(60,60,67,.6)'),
      up:    g('--ch-up', '#1a9c62'),
      dn:    g('--ch-dn', '#d92d3c'),
      ma1:   g('--ch-ma1', 'rgba(190,130,20,.9)'),
      ma2:   g('--ch-ma2', 'rgba(40,110,220,.9)'),
      price: g('--ch-price', '#0a84ff'),
      tag:   g('--ch-tag', '#ffffff'),
      dim:   g('--ch-dim', 'rgba(60,60,67,.55)'),
      rsi:   g('--ch-rsi', '#af52de'),
      rsiUp: g('--ch-rsi-up', 'rgba(217,45,60,.35)'),
      rsiDn: g('--ch-rsi-dn', 'rgba(26,156,98,.35)')
    };
    return CT;
  }
  window.__resetChartTheme = () => { CT = null; };

  function attach(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  // 同步画布尺寸；返回是否发生了变化
  function syncSize() {
    if (!cv) return false;
    const r = cv.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return false;   // 视图隐藏时不要清零画布
    const d = Math.min(window.devicePixelRatio || 1, 2.5);
    if (Math.abs(r.width - W) < 0.5 && Math.abs(r.height - H) < 0.5 && d === dpr) return false;
    dpr = d; W = r.width; H = r.height;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function resize() {
    if (!cv) return;
    syncSize();
    draw();
  }

  function set(s, t) { sym = s; tf = t; draw(); }
  function toggleMA() { showMA = !showMA; draw(); return showMA; }
  function toggleRSI() { showRSI = !showRSI; draw(); return showRSI; }

  function ma(arr, n) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i].c;
      if (i >= n) sum -= arr[i - n].c;
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function rsiVals(arr, n = 14) {
    const out = new Array(arr.length).fill(null);
    let gain = 0, loss = 0;
    for (let i = 1; i < arr.length; i++) {
      const d = arr[i].c - arr[i - 1].c;
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      if (i <= n) {
        gain += g / n; loss += l / n;
        if (i === n) out[i] = 100 - 100 / (1 + gain / (loss || 1e-9));
      } else {
        gain = (gain * (n - 1) + g) / n;
        loss = (loss * (n - 1) + l) / n;
        out[i] = 100 - 100 / (1 + gain / (loss || 1e-9));
      }
    }
    return out;
  }

  function draw() {
    const T = theme();
    if (!ctx) return;
    syncSize();                    // 视图刚显示时布局尺寸才可用，这里兜底
    if (W < 20 || H < 20) return;
    const inst = INSTRUMENTS.find(i => i.sym === sym);
    if (!inst) return;
    const st = Market.get(sym);
    let bars = st.bars[tf];

    ctx.clearRect(0, 0, W, H);

    // 绘图区
    const rsiH = showRSI ? H * 0.26 : 0;
    const plotH = H - padT - padB - rsiH - (showRSI ? 6 : 0);
    const plotW = W - padL - padR;

    const count = Math.max(24, Math.min(70, Math.floor(plotW / 7)));
    const barNow = Date.now() - (Date.now() % (tf * 60000));
    const view = bars.slice(-count);
    if (!view.length) return;

    let hi = -Infinity, lo = Infinity;
    view.forEach(b => { if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l; });
    const pad = (hi - lo) * 0.10 || inst.pip * 5;
    hi += pad; lo -= pad;

    const y = v => padT + (hi - v) / (hi - lo) * plotH;
    const cw = plotW / view.length;
    const bw = Math.max(1.5, Math.min(11, cw * 0.62));

    // 网格 + 价格刻度
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const gridN = 5;
    for (let g = 0; g <= gridN; g++) {
      const v = lo + (hi - lo) * g / gridN;
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR + 4, yy); ctx.stroke();
      ctx.fillStyle = T.axis;
      ctx.textAlign = 'left';
      ctx.fillText(inst.digits <= 3 ? v.toFixed(inst.digits) : v.toFixed(inst.digits), W - padR + 7, yy);
    }

    // MA
    if (showMA) {
      const full = bars;
      const m5 = ma(full, 5).slice(-count);
      const m20 = ma(full, 20).slice(-count);
      const drawMA = (arr, color) => {
        ctx.beginPath();
        let started = false;
        arr.forEach((v, i) => {
          if (v == null) return;
          const xx = padL + cw * i + cw / 2;
          const yy = y(v);
          if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
        });
        ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
      };
      drawMA(m5, T.ma1);
      drawMA(m20, T.ma2);
    }

    // K 线
    view.forEach((b, i) => {
      const x = padL + cw * i + cw / 2;
      const up = b.c >= b.o;
      const col = up ? T.up : T.dn;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      // 影线
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + .5, y(b.h));
      ctx.lineTo(Math.round(x) + .5, y(b.l));
      ctx.stroke();
      // 实体
      const yo = y(b.o), yc = y(b.c);
      const top = Math.min(yo, yc), hgt = Math.max(1.2, Math.abs(yc - yo));
      if (up) {
        ctx.fillStyle = T.up;
        ctx.fillRect(x - bw / 2, top, bw, hgt);
      } else {
        ctx.fillStyle = T.dn;
        ctx.fillRect(x - bw / 2, top, bw, hgt);
      }
    });

    // 现价线
    const mid = st.mid;
    const py = Math.max(padT + 1, Math.min(padT + plotH - 1, y(mid)));
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = T.price;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR + 4, py); ctx.stroke();
    ctx.setLineDash([]);

    // 现价标签
    const label = Market.fmt(inst, mid);
    ctx.font = '600 9.5px ui-monospace, Menlo, monospace';
    const tw = ctx.measureText(label).width + 9;
    ctx.fillStyle = T.price;
    roundRect(W - padR + 3, py - 7.5, Math.min(tw, padR - 4), 15, 3.5);
    ctx.fill();
    ctx.fillStyle = T.tag;
    ctx.textAlign = 'center';
    ctx.fillText(label, W - padR + 3 + Math.min(tw, padR - 4) / 2, py);

    // 最新价闪烁点
    const lastX = padL + cw * (view.length - 1) + cw / 2;
    ctx.beginPath();
    ctx.arc(lastX, py, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = st.dir >= 0 ? T.up : T.dn;
    ctx.fill();

    // 时间轴（按真实时钟刻度）
    ctx.font = '8.5px ui-monospace, Menlo, monospace';
    ctx.fillStyle = T.dim;
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor((view.length - 1) / 4));
    for (let i = view.length - 1; i >= 0; i -= step) {
      const x = padL + cw * i + cw / 2;
      const minsAgo = (view.length - 1 - i) * tf;
      const lbl = minsAgo === 0 ? '现' : clockLabel(barNow - minsAgo * 60000, tf);
      ctx.textAlign = i === view.length - 1 ? 'right' : 'center';
      ctx.fillText(lbl, i === view.length - 1 ? x + cw / 2 : x, H - padB / 2 + 1);
    }

    // RSI 副图
    if (showRSI) {
      const top0 = H - padB - rsiH;
      ctx.strokeStyle = T.grid;
      ctx.beginPath(); ctx.moveTo(padL, top0); ctx.lineTo(W - padR + 4, top0); ctx.stroke();

      const r = rsiVals(bars).slice(-count);
      const yR = v => top0 + 6 + (100 - v) / 100 * (rsiH - 12);
      // 70/30 线
      [70, 30].forEach(v => {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = v === 70 ? T.rsiUp : T.rsiDn;
        ctx.beginPath(); ctx.moveTo(padL, yR(v)); ctx.lineTo(W - padR + 4, yR(v)); ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.beginPath();
      let started = false;
      r.forEach((v, i) => {
        if (v == null) return;
        const x = padL + cw * i + cw / 2;
        if (!started) { ctx.moveTo(x, yR(v)); started = true; } else ctx.lineTo(x, yR(v));
      });
      ctx.strokeStyle = T.rsi;
      ctx.lineWidth = 1.3; ctx.stroke();
      ctx.fillStyle = T.rsi;
      ctx.textAlign = 'left';
      ctx.font = '8px ui-monospace, Menlo, monospace';
      ctx.fillText('RSI(14)', padL + 2, top0 + 7);
    }
  }

  // tf >= 60 只显示小时，否则显示 HH:MM
  function clockLabel(ms, tfm) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return tfm >= 60 ? hh + ':00' : hh + ':' + mm;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { attach, set, draw, resize, toggleMA, toggleRSI, get tf() { return tf; } };
})();
