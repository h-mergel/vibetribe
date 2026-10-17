/* @ds-bundle: {"format":4,"namespace":"VibeTribe","components":[{"name":"SlotTile"},{"name":"InboxTile"},{"name":"LimitTile"},{"name":"ExtraTile"},{"name":"StatusTile"},{"name":"EmptyTile"},{"name":"Glyphs"},{"name":"Breathing"},{"name":"Variants"},{"name":"Deck"}]} */
/* VibeTribe tile reference renderer. Pure functions: model -> SVG string (144 x 144).
   Runs in the browser (window.VibeTribe) and in Node (globalThis.VibeTribe). No DOM, no network. */
(function (root) {
  'use strict';

  /* ---------- tokens (mirror of tokens.json) ---------- */
  var C = {
    ground: '#0E1116',
    track: '#262C35',
    line: '#3A424E',
    ink: '#F3F5F8',
    muted: '#A9B2BF',
    faint: '#7A8494',
    permission: '#FFB524',
    input: '#E879C4',
    error: '#FF5C33',
    done: '#30D6A4',
    throttled: '#B4C8E8',
    working: '#3D8EF5',
    idle: '#8D97A6',
    offline: '#7A8494',
    neutral: '#C3CDDA'
  };
  var FONT = 'DejaVu Sans, Segoe UI, Arial, sans-serif';
  var SAFE = { min: 10, max: 134 };
  var S = { word: 20, wordMin: 18, title: 20, meta: 18, clock: 20, count: 34, pct: 32, unit: 20, amount: [34, 30, 28, 24, 20, 18], min: 18 };
  var STROKE = { frameThick: 8, frameThin: 3, frameDash: 2, glyph: 3.4, ring: 10, pace: 3.5, paceGap: 9, bar: 12, badge: 2 };
  var TINT = 0.12;

  var STATES = {
    needs_permission: { word: 'Approve' , color: 'permission', glyph: 'diamond', wait: true },
    needs_input:      { word: 'Input',    color: 'input',      glyph: 'bubble',  wait: true },
    error:            { word: 'Error',    color: 'error',      glyph: 'octagon', wait: true },
    done_unseen:      { word: 'Done',     color: 'done',       glyph: 'check',   wait: true },
    throttled:        { word: 'Limited',  color: 'throttled',  glyph: 'hourglass' },
    working:          { word: 'Working',  color: 'working',    glyph: 'dots' },
    background:       { word: 'jobs',     color: 'working',    glyph: 'pie' },
    idle:             { word: 'Idle',     color: 'idle',       glyph: 'dash' },
    no_signal:        { word: 'Offline',  color: 'offline',    glyph: 'unplugged' }
  };
  var DETAIL = { server_error: 'Server', billing_error: 'Billing', rate_limit: 'Rate limit', overloaded: 'Overloaded', Subagent: 'Subagent', Kompaktiert: 'Compacting' };
  var HEALTH = {
    ok:      { word: 'ok',    glyph: 'hcheck', color: 'done',       label: 'muted' },
    stale:   { word: 'stale', glyph: 'hclock', color: 'permission', label: 'ink' },
    missing: { word: 'down',  glyph: 'hcross', color: 'error',      label: 'ink' },
    off:     { word: 'off',   glyph: 'hdash',  color: 'faint',      label: 'faint' }
  };

  /* ---------- text metrics (DejaVu Sans advances, em) ---------- */
  var ADV = {"r":{"0":0.6362,"1":0.6362,"2":0.6362,"3":0.6362,"4":0.6362,"5":0.6362,"6":0.6362,"7":0.6362,"8":0.6362,"9":0.6362," ":0.3179,"!":0.4009,"\"":0.46,"#":0.8379,"$":0.6362,"%":0.9502,"&":0.7798,"'":0.2749,"(":0.3901,")":0.3901,"*":0.5,"+":0.8379,",":0.3179,"-":0.3608,".":0.3179,"/":0.3369,":":0.3369,";":0.3369,"<":0.8379,"=":0.8379,">":0.8379,"?":0.5308,"@":1,"A":0.6841,"B":0.686,"C":0.6982,"D":0.77,"E":0.6318,"F":0.5752,"G":0.7749,"H":0.752,"I":0.2949,"J":0.2949,"K":0.6558,"L":0.5571,"M":0.8628,"N":0.748,"O":0.7871,"P":0.603,"Q":0.7871,"R":0.6948,"S":0.6348,"T":0.6108,"U":0.7319,"V":0.6841,"W":0.9888,"X":0.6851,"Y":0.6108,"Z":0.6851,"[":0.3901,"\\":0.3369,"]":0.3901,"^":0.8379,"_":0.5,"`":0.5,"a":0.6128,"b":0.6348,"c":0.5498,"d":0.6348,"e":0.6152,"f":0.3521,"g":0.6348,"h":0.6338,"i":0.2778,"j":0.2778,"k":0.5791,"l":0.2778,"m":0.9741,"n":0.6338,"o":0.6118,"p":0.6348,"q":0.6348,"r":0.4111,"s":0.521,"t":0.3921,"u":0.6338,"v":0.5918,"w":0.8179,"x":0.5918,"y":0.5918,"z":0.5249,"{":0.6362,"|":0.3369,"}":0.6362,"~":0.8379," ":0.3179,"¡":0.4009,"¢":0.6362,"£":0.6362,"¤":0.6362,"¥":0.6362,"¦":0.3369,"§":0.5,"¨":0.5,"©":1,"ª":0.4712,"«":0.6118,"¬":0.8379,"­":0.3608,"®":1,"¯":0.5,"°":0.5,"±":0.8379,"²":0.4009,"³":0.4009,"´":0.5,"µ":0.6362,"¶":0.6362,"·":0.3179,"¸":0.5,"¹":0.4009,"º":0.4712,"»":0.6118,"¼":0.9692,"½":0.9692,"¾":0.9692,"¿":0.5308,"À":0.6841,"Á":0.6841,"Â":0.6841,"Ã":0.6841,"Ä":0.6841,"Å":0.6841,"Æ":0.9741,"Ç":0.6982,"È":0.6318,"É":0.6318,"Ê":0.6318,"Ë":0.6318,"Ì":0.2949,"Í":0.2949,"Î":0.2949,"Ï":0.2949,"Ð":0.7749,"Ñ":0.748,"Ò":0.7871,"Ó":0.7871,"Ô":0.7871,"Õ":0.7871,"Ö":0.7871,"×":0.8379,"Ø":0.7871,"Ù":0.7319,"Ú":0.7319,"Û":0.7319,"Ü":0.7319,"Ý":0.6108,"Þ":0.605,"ß":0.6299,"à":0.6128,"á":0.6128,"â":0.6128,"ã":0.6128,"ä":0.6128,"å":0.6128,"æ":0.9819,"ç":0.5498,"è":0.6152,"é":0.6152,"ê":0.6152,"ë":0.6152,"ì":0.2778,"í":0.2778,"î":0.2778,"ï":0.2778,"ð":0.6118,"ñ":0.6338,"ò":0.6118,"ó":0.6118,"ô":0.6118,"õ":0.6118,"ö":0.6118,"÷":0.8379,"ø":0.6118,"ù":0.6338,"ú":0.6338,"û":0.6338,"ü":0.6338,"ý":0.5918,"þ":0.6348,"ÿ":0.5918,"…":1,"€":0.6362,"–":0.5,"—":1,"→":0.8379,"↑":0.8379,"−":0.8379," ":0.1997," ":0.1997},"b":{"0":0.6958,"1":0.6958,"2":0.6958,"3":0.6958,"4":0.6958,"5":0.6958,"6":0.6958,"7":0.6958,"8":0.6958,"9":0.6958," ":0.3481,"!":0.4561,"\"":0.521,"#":0.8379,"$":0.6958,"%":1.002,"&":0.8721,"'":0.3062,"(":0.457,")":0.457,"*":0.5229,"+":0.8379,",":0.3799,"-":0.415,".":0.3799,"/":0.3652,":":0.3999,";":0.3999,"<":0.8379,"=":0.8379,">":0.8379,"?":0.5801,"@":1,"A":0.7739,"B":0.7622,"C":0.7339,"D":0.8301,"E":0.6831,"F":0.6831,"G":0.8208,"H":0.8369,"I":0.3721,"J":0.3721,"K":0.7749,"L":0.6372,"M":0.9951,"N":0.8369,"O":0.8501,"P":0.7329,"Q":0.8501,"R":0.77,"S":0.7202,"T":0.6821,"U":0.812,"V":0.7739,"W":1.103,"X":0.771,"Y":0.7241,"Z":0.7251,"[":0.457,"\\":0.3652,"]":0.457,"^":0.8379,"_":0.5,"`":0.5,"a":0.6748,"b":0.7158,"c":0.5928,"d":0.7158,"e":0.6782,"f":0.4351,"g":0.7158,"h":0.7119,"i":0.3428,"j":0.3428,"k":0.665,"l":0.3428,"m":1.042,"n":0.7119,"o":0.687,"p":0.7158,"q":0.7158,"r":0.4932,"s":0.5952,"t":0.478,"u":0.7119,"v":0.6519,"w":0.9238,"x":0.645,"y":0.6519,"z":0.582,"{":0.7119,"|":0.3652,"}":0.7119,"~":0.8379," ":0.3481,"¡":0.4561,"¢":0.6958,"£":0.6958,"¤":0.6362,"¥":0.6958,"¦":0.3652,"§":0.5,"¨":0.5,"©":1,"ª":0.564,"«":0.646,"¬":0.8379,"­":0.415,"®":1,"¯":0.5,"°":0.5,"±":0.8379,"²":0.438,"³":0.438,"´":0.5,"µ":0.7358,"¶":0.6362,"·":0.3799,"¸":0.5,"¹":0.438,"º":0.564,"»":0.646,"¼":1.0352,"½":1.0352,"¾":1.0352,"¿":0.5801,"À":0.7739,"Á":0.7739,"Â":0.7739,"Ã":0.7739,"Ä":0.7739,"Å":0.7739,"Æ":1.085,"Ç":0.7339,"È":0.6831,"É":0.6831,"Ê":0.6831,"Ë":0.6831,"Ì":0.3721,"Í":0.3721,"Î":0.3721,"Ï":0.3721,"Ð":0.8379,"Ñ":0.8369,"Ò":0.8501,"Ó":0.8501,"Ô":0.8501,"Õ":0.8501,"Ö":0.8501,"×":0.8379,"Ø":0.8501,"Ù":0.812,"Ú":0.812,"Û":0.812,"Ü":0.812,"Ý":0.7241,"Þ":0.7378,"ß":0.7192,"à":0.6748,"á":0.6748,"â":0.6748,"ã":0.6748,"ä":0.6748,"å":0.6748,"æ":1.0479,"ç":0.5928,"è":0.6782,"é":0.6782,"ê":0.6782,"ë":0.6782,"ì":0.3428,"í":0.3428,"î":0.3428,"ï":0.3428,"ð":0.687,"ñ":0.7119,"ò":0.687,"ó":0.687,"ô":0.687,"õ":0.687,"ö":0.687,"÷":0.8379,"ø":0.687,"ù":0.7119,"ú":0.7119,"û":0.7119,"ü":0.7119,"ý":0.6519,"þ":0.7158,"ÿ":0.6519,"…":1,"€":0.6958,"–":0.5,"—":1,"→":0.8379,"↑":0.8379,"−":0.8379," ":0.1997," ":0.1997}};
  function textWidth(s, size, weight) {
    var t = weight >= 700 ? ADV.b : ADV.r, w = 0;
    for (var i = 0; i < s.length; i++) { var a = t[s[i]]; w += (a == null ? 0.62 : a); }
    return w * size;
  }
  function fit(s, maxW, size, weight) {
    if (textWidth(s, size, weight) <= maxW) return s;
    var out = s;
    while (out.length > 0 && textWidth(out + '…', size, weight) > maxW) out = out.slice(0, -1);
    out = out.replace(/\s+$/, '');
    return out.length ? out + '…' : '';
  }
  function cleanTitle(s) {
    s = String(s == null ? '' : s);
    try { s = s.replace(/\p{Extended_Pictographic}|‍|️/gu, ''); } catch (e) { s = s.replace(/[\uD800-\uDFFF]/g, ''); }
    s = s.replace(/\s+/g, ' ').trim();
    return s.length ? s : '–';
  }
  /* Title layout, 2 lines. Rules (in order):
     1. Break at spaces, then after - _ / . inside long words.
     2. Too long for 2 lines and several words: keep head and tail ("Mobile Entw…" / "Northwind"):
        line 2 takes as many trailing words as fit, line 1 the leading words, elided at the end.
     3. One word longer than a line: hard break with a hyphen, never leaving fewer than 3 letters.
     4. Anything still left over is elided with "…" at the end of line 2.
     Returns {lines, size, hard, cut}. */
  function packLines(pieces, maxW, size, weight) {
    var lines = [], cur = '', prevGlue = false;
    pieces.forEach(function (pc) {
      var cand = cur ? cur + (prevGlue ? '' : ' ') + pc.t : pc.t;
      if (!cur || textWidth(cand, size, weight) <= maxW) cur = cand; else { lines.push(cur); cur = pc.t; }
      prevGlue = pc.glue;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function softPieces(w, maxW, size, weight) {
    if (textWidth(w, size, weight) <= maxW) return [{ t: w, glue: false }];
    var segs = w.split(/(?<=[-_\/.])/), out = [], p = '';
    segs.forEach(function (sg) { if (p && textWidth(p + sg, size, weight) > maxW) { out.push(p); p = ''; } p += sg; });
    if (p) out.push(p);
    return out.map(function (t, i) { return { t: t, glue: i < out.length - 1 }; });
  }
  function hardBreak(w, maxW, size, weight) {
    var i = 1;
    while (i < w.length && textWidth(w.slice(0, i + 1) + '-', size, weight) <= maxW) i++;
    if (w.length - i < 3) i = Math.max(1, w.length - 3);
    var head = w.slice(0, i), tail = w.slice(i);
    return [/[-_\/.]$/.test(head) ? head : head + '-', tail];
  }
  function layoutTitle(s, maxW, size, weight) {
    var words = s.split(' '), pieces = [];
    words.forEach(function (w) { pieces = pieces.concat(softPieces(w, maxW, size, weight)); });
    var lines = packLines(pieces, maxW, size, weight);
    var tooWide = lines.some(function (l) { return textWidth(l, size, weight) > maxW; });
    if (lines.length <= 2 && !tooWide) return { lines: lines, size: size, hard: false, cut: false };
    if (words.length === 1 && lines.length === 1) {
      var hb = hardBreak(lines[0], maxW, size, weight);
      return { lines: [hb[0], fit(hb[1], maxW, size, weight)], size: size, hard: true, cut: textWidth(hb[1], size, weight) > maxW };
    }
    if (words.length > 1) {
      var tail = [], k = words.length - 1;
      while (k > 0 && textWidth(words.slice(k).join(' '), size, weight) <= maxW) { tail = words.slice(k); k--; }
      if (tail.length) {
        var head = words.slice(0, words.length - tail.length).join(' ');
        if (textWidth(head, size, weight) <= maxW) return { lines: [head, tail.join(' ')], size: size, hard: false, cut: false };
        var h = fit(head, maxW, size, weight);
        if (h.replace('…', '').length >= 3) return { lines: [h, tail.join(' ')], size: size, hard: false, cut: true };
      }
    }
    var l1 = fit(lines[0], maxW, size, weight);
    var rest = lines.slice(1).join(' ');
    return { lines: [l1, fit(rest, maxW, size, weight)], size: size, hard: false, cut: true };
  }
  function cost(r) { return (r.hard ? 1 : 0) + 2 * r.lines.filter(function (l) { return l.slice(-1) === '…'; }).length; }
  /* Try 20 px; step to 18 px only if that avoids a cut or hard break. */
  function wrap(s, maxW, size, weight, n, minSize) {
    var a = layoutTitle(s, maxW, size, weight);
    if ((a.hard || a.cut) && minSize && minSize < size) {
      var b = layoutTitle(s, maxW, minSize, weight);
      if (cost(b) < cost(a)) return b;
    }
    return a;
  }

  /* ---------- SVG helpers ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function n(v) { return Math.round(v * 100) / 100; }
  function text(id, x, y, s, size, weight, fill, anchor, extra) {
    return '<text id="' + id + '" x="' + n(x) + '" y="' + n(y) + '" font-family="' + FONT + '" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '"' +
      (anchor && anchor !== 'start' ? ' text-anchor="' + anchor + '"' : '') + (EMBOLDEN && weight < 700 ? ' stroke="' + fill + '" stroke-width="' + EMBOLDEN + '"' : '') + (extra || '') + '>' + esc(s) + '</text>';
  }
  function svg(body) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">' +
      '<rect id="vt-ground" x="0" y="0" width="144" height="144" fill="' + C.ground + '"/>' + body + '</svg>';
  }
  function frame(kind, color, level) {
    var op = level == null ? 1 : level;
    if (kind === 'thick') return '<rect id="vt-frame" x="5" y="5" width="134" height="134" rx="14" fill="none" stroke="' + color + '" stroke-width="' + STROKE.frameThick + '" stroke-opacity="' + n(op) + '"/>';
    if (kind === 'thin') return '<rect id="vt-frame" x="2.5" y="2.5" width="139" height="139" rx="16" fill="none" stroke="' + color + '" stroke-width="' + STROKE.frameThin + '"/>';
    if (kind === 'dashed') return '<rect id="vt-frame" x="2" y="2" width="140" height="140" rx="16" fill="none" stroke="' + color + '" stroke-width="' + STROKE.frameDash + '" stroke-dasharray="6 6"/>';
    return '';
  }
  function tint(color, level) {
    return '<rect id="vt-tint" x="9" y="9" width="126" height="126" rx="10" fill="' + color + '" fill-opacity="' + n(TINT * (level == null ? 1 : level)) + '"/>';
  }

  /* Glyph sizes other than 28 are produced by scaling the coordinates themselves:
     the brief allows only translate/rotate transforms. */
  function scalePath(d, k) {
    var tk = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [], out = [], cmd = '', idx = 0;
    tk.forEach(function (t) {
      if (/[A-Za-z]/.test(t)) { cmd = t; idx = 0; out.push(t); return; }
      var v = parseFloat(t), scale = true;
      if (cmd === 'A' || cmd === 'a') { var j = idx % 7; scale = !(j === 2 || j === 3 || j === 4); }
      out.push(String(scale ? n(v * k) : v)); idx++;
    });
    return out.join(' ');
  }
  function scaleSvg(body, k) {
    return body
      .replace(/ d="([^"]*)"/g, function (_, d) { return ' d="' + scalePath(d, k) + '"'; })
      .replace(/ points="([^"]*)"/g, function (_, p) { return ' points="' + p.replace(/-?\d*\.?\d+/g, function (x) { return n(parseFloat(x) * k); }) + '"'; })
      .replace(/ (cx|cy|r|x|y|x1|y1|x2|y2|width|height|rx|stroke-width)="(-?[\d.]+)"/g, function (_, a, v) { return ' ' + a + '="' + n(parseFloat(v) * k) + '"'; });
  }

  /* ---------- glyphs: drawn in a 28 x 28 box ---------- */
  var G = {
    diamond:   { shape: '<polygon points="14,0.5 27.5,14 14,27.5 0.5,14"/>', outline: '<polygon points="14,2.5 25.5,14 14,25.5 2.5,14"/>',
                 mark: '<line x1="14" y1="7.5" x2="14" y2="15.2"/><circle cx="14" cy="19.6" r="2.1" data-fill="1"/>' },
    bubble:    { shape: '<path d="M6 0.5 H22 A5 5 0 0 1 27 5.5 V19.5 A5 5 0 0 1 22 24.5 H11.5 L6 27.8 V24.5 A5 5 0 0 1 1 19.5 V5.5 A5 5 0 0 1 6 0.5 Z"/>',
                 outline: '<path d="M6 1.8 H22 A3.7 3.7 0 0 1 25.7 5.5 V19.5 A3.7 3.7 0 0 1 22 23.2 H11.2 L7.2 26.6 V23.2 H6 A3.7 3.7 0 0 1 2.3 19.5 V5.5 A3.7 3.7 0 0 1 6 1.8 Z"/>', outlineStroke: 2.6,
                 mark: '<path d="M11.1 10.2 A2.9 2.9 0 1 1 15.3 12.8 C14.4 13.3 14 13.8 14 15"/><circle cx="14" cy="18.4" r="1.75" data-fill="1"/>' },
    octagon:   { shape: '<polygon points="8.6,0.5 19.4,0.5 27.5,8.6 27.5,19.4 19.4,27.5 8.6,27.5 0.5,19.4 0.5,8.6"/>',
                 outline: '<polygon points="9.3,2.2 18.7,2.2 25.8,9.3 25.8,18.7 18.7,25.8 9.3,25.8 2.2,18.7 2.2,9.3"/>',
                 mark: '<line x1="9.6" y1="9.6" x2="18.4" y2="18.4"/><line x1="18.4" y1="9.6" x2="9.6" y2="18.4"/>' },
    check:     { shape: '<circle cx="14" cy="14" r="13.5"/>', outline: '<circle cx="14" cy="14" r="11.8"/>',
                 mark: '<path d="M8 14.4 L12.2 18.6 L20.2 9.8"/>' }
  };
  function closedGlyph(name, color, filled) {
    var g = G[name];
    if (filled) {
      var mark = g.mark.replace(/<(line|path)/g, '<$1 fill="none" stroke="' + C.ground + '" stroke-width="' + STROKE.glyph + '"')
                       .replace(/<circle([^>]*) data-fill="1"/g, '<circle$1 fill="' + C.ground + '"');
      return '<g fill="' + color + '">' + g.shape + '</g>' + mark;
    }
    var mk = g.mark.replace(/<(line|path)/g, '<$1 fill="none" stroke="' + color + '" stroke-width="' + STROKE.glyph + '"')
                   .replace(/<circle([^>]*) data-fill="1"/g, '<circle$1 fill="' + color + '"');
    return '<g fill="none" stroke="' + color + '" stroke-width="' + (g.outlineStroke || STROKE.glyph) + '">' + g.outline + '</g>' + mk;
  }
  function glyph(name, color, opts) {
    opts = opts || {};
    var sw = STROKE.glyph, body;
    switch (name) {
      case 'diamond': case 'bubble': case 'octagon': case 'check':
        body = closedGlyph(name, color, opts.filled); break;
      case 'hourglass':
        body = '<path d="M5 2 H23 M5 26 H23" stroke="' + color + '" stroke-width="' + sw + '" fill="none"/>' +
               '<path d="M7.5 3.5 H20.5 C20.5 9 15.5 11.5 15.5 14 C15.5 16.5 20.5 19 20.5 24.5 H7.5 C7.5 19 12.5 16.5 12.5 14 C12.5 11.5 7.5 9 7.5 3.5 Z" fill="none" stroke="' + color + '" stroke-width="2.6"/>' +
               '<polygon points="9.6,23.6 18.4,23.6 14,18.6" fill="' + color + '"/>'; break;
      case 'dots':
        var t = (opts.tick || 0) % 3, d = '';
        for (var i = 0; i < 3; i++) d += '<circle cx="' + (4 + i * 10) + '" cy="14" r="' + (i === t ? 4.2 : 3.4) + '" fill="' + color + '" fill-opacity="' + (i === t ? 1 : 0.4) + '"/>';
        body = '<g id="vt-work-tick" data-tick="' + t + '">' + d + '</g>'; break;
      case 'pie':
        body = '<circle cx="14" cy="14" r="11.8" fill="none" stroke="' + color + '" stroke-width="' + sw + '"/>' +
               '<path d="M14 6 A8 8 0 0 1 14 22 Z" fill="' + color + '"/>'; break;
      case 'dash':
        body = '<rect x="3" y="11" width="22" height="6" rx="3" fill="' + color + '"/>'; break;
      case 'unplugged':
        body = '<circle cx="14" cy="14" r="11.8" fill="none" stroke="' + color + '" stroke-width="' + sw + '"/>' +
               '<line x1="5.6" y1="22.4" x2="22.4" y2="5.6" stroke="' + color + '" stroke-width="' + sw + '"/>'; break;
      case 'tray':
        body = '<path d="M2 15 L6.5 3.5 H21.5 L26 15 V23 A2.5 2.5 0 0 1 23.5 25.5 H4.5 A2.5 2.5 0 0 1 2 23 Z" fill="none" stroke="' + color + '" stroke-width="2.8"/>' +
               '<path d="M2 15 H9.5 L11.5 18.5 H16.5 L18.5 15 H26" fill="none" stroke="' + color + '" stroke-width="2.8"/>'; break;
      case 'hcheck':
        body = '<path d="M7 14.5 L12 19.5 L21.5 9" fill="none" stroke="' + color + '" stroke-width="3.6"/>'; break;
      case 'hclock':
        body = '<circle cx="14" cy="14" r="10" fill="none" stroke="' + color + '" stroke-width="3.2"/><path d="M14 8.5 V14 H18.5" fill="none" stroke="' + color + '" stroke-width="3"/>'; break;
      case 'hcross':
        body = '<line x1="8" y1="8" x2="20" y2="20" stroke="' + color + '" stroke-width="3.6"/><line x1="20" y1="8" x2="8" y2="20" stroke="' + color + '" stroke-width="3.6"/>'; break;
      case 'hdash':
        body = '<line x1="8" y1="14" x2="20" y2="14" stroke="' + color + '" stroke-width="3.2"/>'; break;
      case 'arrowUp':
        body = '<polygon points="14,3 25,17 18,17 18,25 10,25 10,17 3,17" fill="' + color + '"/>'; break;
      default: body = '';
    }
    var sc = (opts.size || 28) / 28;
    if (sc !== 1) body = scaleSvg(body, sc);
    return '<g id="' + (opts.id || 'vt-glyph') + '" data-glyph="' + name + '" transform="translate(' + n(opts.x || 0) + ' ' + n(opts.y || 0) + ')">' + body + '</g>';
  }

  /* ---------- clock ---------- */
  /* Wait clock as [number, unit]: "42 s" (ticks 1/s) for the first minute, then "3 min" (1/min),
     from 60 min "1:05 h" (1/min), from 10 h "12 h". Minute steps keep 8 slots inside the 10 fps budget. */
  function clockParts(sec) {
    if (typeof sec === 'string') { var p = sec.split(' '); return [p[0], p.slice(1).join(' ')]; }
    sec = Math.max(0, Math.floor(sec));
    if (sec >= 36000) return [String(Math.floor(sec / 3600)), 'h'];
    if (sec >= 3600) { var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return [h + ':' + (m < 10 ? '0' : '') + m, 'h']; }
    if (sec >= 60) return [String(Math.floor(sec / 60)), 'min'];
    return [String(sec), 's'];
  }
  function clock(sec) { var p = clockParts(sec); return p[0] + (p[1] ? ' ' + p[1] : ''); }



  /* ---------- shared helpers ---------- */
  function originLabel(b) { b = b === 'MAC' ? 'REM' : (b || '?'); return String(b).toUpperCase().slice(0, 3); } /* MAC = remote sessions, shown as REM; max 3 chars */
  /* Notes may arrive in the old German wording; everything is shown in English. */
  var NOTES = { 'Anmelden': 'Sign in', 'keine Daten': 'No data', 'nicht aktiv': 'Disabled', 'Neustart': 'New window', 'neues Fenster': 'New window' };
  function normNote(t) { if (!t) return ''; t = String(t); if (NOTES[t]) return NOTES[t]; var st = /^Stand\s+(.*)$/.exec(t); return st ? 'As of ' + st[1] : t; }
  function resetText(t) { return t ? String(t).replace(/(\d+)T\b/, '$1d') : ''; }
  function clampNum(v) { return v > 99 ? '99+' : String(v); }
  /* count (+ "/total") shrinks 34 → 28 → 24 → 20 to fit between x0 and the right limit */
  function countSize(big, of, x0, right) {
    var sizes = [S.count, 28, 24, 20];
    for (var i = 0; i < sizes.length; i++) if (x0 + textWidth(big, sizes[i], 700) + (of ? 4 + textWidth(of, S.unit, 700) : 0) <= right) return sizes[i];
    return 20;
  }
  function pillWidth(count) { return textWidth('+' + clampNum(count), S.meta, 700) + 14; }
  function overflowPill(count, right, y) {
    var o = '+' + clampNum(count), ow = textWidth(o, S.meta, 700) + 14;
    return '<rect id="vt-overflow-pill" x="' + n(right - 1 - ow) + '" y="' + (y + 1) + '" width="' + n(ow) + '" height="24" rx="12" fill="none" stroke="' + C.line + '" stroke-width="2"/>' +
           text('vt-overflow', right - 1 - ow / 2, y + 19, o, S.meta, 700, C.muted, 'middle');
  }

  /* ---------- SLOT ---------- */
  function slot(m) {
    var st = STATES[m.state] || STATES.idle, col = C[st.color], out = '';
    var frameKind = m.frame || (m.state === 'done_unseen' ? 'thick' : 'normal'), level = m.level == null ? 1 : m.level;
    var filled = frameKind === 'thick' || m.state === 'done_unseen';
    var offline = m.state === 'no_signal';

    if (frameKind === 'thick') out += tint(col, level) + frame('thick', col, level);
    else if (frameKind === 'thin') out += frame('thin', col);
    else if (offline) out += frame('dashed', C.faint);

    /* header: glyph + state word (+ background badge) */
    out += glyph(st.glyph, col, { x: 10, y: 10, filled: filled, tick: m.tick });
    var word = st.word;
    if (m.state === 'background') word = m.bgStale ? '? jobs' : (m.bgCount > 0 ? m.bgCount + ' jobs' : 'Jobs');
    var wordX = 42, wordMax = SAFE.max - wordX + 2; /* 2 px: trailing side bearing of the last glyph */
    var bg = '', bgW = 0, bgTxt = '';
    if (m.state !== 'background' && (m.bgCount > 0 || m.bgStale)) {
      bgTxt = m.bgStale ? '?' : String(m.bgCount);
      bgW = 15 + 2 + textWidth(bgTxt, S.meta, 700);
    }
    var wsize = textWidth(word, S.word, 700) <= wordMax ? S.word : S.wordMin;
    if (bgW) {
      if (textWidth(word, S.word, 700) <= wordMax - bgW - 3) wsize = S.word;
      else if (textWidth(word, S.wordMin, 700) <= wordMax - bgW - 3) wsize = S.wordMin;
      else bgW = 0; /* no room: the state word wins, the badge is omitted */
    }
    if (bgW) bg = glyph('pie', C.muted, { id: 'vt-bg-glyph', x: SAFE.max - bgW, y: 16.5, size: 15 }) +
                  text('vt-bg-count', SAFE.max, 31, bgTxt, S.meta, 700, C.muted, 'end');
    out += text('vt-state-word', wordX, 31, fit(word, wordMax, wsize, 700), wsize, 700, col);
    out += bg;

    /* title: 2 lines, 20/400 */
    var tw = wrap(cleanTitle(m.title), 124, S.title, 400, 2, S.min), lines = tw.lines;
    var titleCol = offline ? C.muted : C.ink;
    out += text('vt-title-1', 10, 64, lines[0], tw.size, 400, titleCol);

    /* footer: origin badge right, meta left */
    var badge = originLabel(m.badge);
    var badgeW = textWidth(badge, S.meta, 700);
    out += text('vt-badge', SAFE.max, 127, badge, S.meta, 700, C.muted, 'end');
    var footMax = 124 - badgeW - 8;
    var detail = m.detail ? (DETAIL[m.detail] || m.detail) : '';
    var footer = '';
    if (m.jumping) footer = text('vt-jump', 10, 127, 'Open…', S.meta, 400, C.ink);
    else if (st.wait && m.wait != null) {
      var cp = clockParts(m.wait);
      footer = text('vt-clock', 10, 127, cp[0], S.clock, 700, C.ink) +
               (cp[1] ? text('vt-clock-unit', 10 + textWidth(cp[0], S.clock, 700) + 4, 127, cp[1], S.meta, 400, C.muted) : '');
    }

    if (lines[1]) out += text('vt-title-2', 10, 88, lines[1], tw.size, 400, titleCol);
    else if (detail && textWidth(detail, S.meta, 400) <= 124) { out += text('vt-detail', 10, 88, detail, S.meta, 400, C.muted); detail = ''; }

    if (!footer && detail) {
      if (textWidth(detail, S.meta, 400) <= footMax) footer = text('vt-detail', 10, 127, detail, S.meta, 400, C.muted);
    }
    out += footer;
    return svg(out);
  }

  function empty() {
    return svg('<rect id="vt-empty" x="50" y="50" width="44" height="44" rx="12" fill="none" stroke="' + C.line + '" stroke-width="2" stroke-dasharray="5 6"/>');
  }

  /* ---------- INBOX ---------- */
  function inbox(m) {
    var out = '', waiting = m.waiting || 0, has = waiting > 0 && m.top;
    out += glyph('tray', has ? C.ink : C.faint, { x: 10, y: 10 });
    var cyc = m.cycle && m.cycle.total > 1;
    var big = cyc ? clampNum(m.cycle.index) : clampNum(waiting), of = cyc ? '/' + clampNum(m.cycle.total) : '';
    var pillOn = m.overflow && !cyc && 46 + textWidth(big, 20, 700) <= SAFE.max - 1 - pillWidth(m.overflow) - 6;
    var cs = countSize(big, of, 46, pillOn ? SAFE.max - 1 - pillWidth(m.overflow) - 6 : SAFE.max);
    out += text('vt-count', 46, 36, big, cs, 700, has ? C.ink : C.faint);
    var x = 46 + textWidth(big, cs, 700) + 4;
    if (cyc) out += text('vt-count-of', x, 36, of, S.unit, 700, C.muted);
    if (pillOn) out += overflowPill(m.overflow, SAFE.max, 11); /* hidden while cycling (5 s) or when the count needs the room */
    /* divider; while cycling it becomes a segmented position indicator */
    if (cyc) {
      var segs = Math.min(m.cycle.total, 12), gap = segs > 6 ? 2 : 4, w = (124 - gap * (segs - 1)) / segs, s = '';
      for (var i = 0; i < segs; i++) s += '<rect x="' + n(10 + i * (w + gap)) + '" y="47" width="' + n(w) + '" height="4" rx="2" fill="' + (i + 1 === Math.min(m.cycle.index, segs) ? C.ink : C.line) + '"/>';
      out += '<g id="vt-cycle">' + s + '</g>';
    } else {
      out += '<rect id="vt-divider" x="10" y="48" width="124" height="2" fill="' + C.track + '"/>';
    }
    if (has) {
      var st = STATES[m.top.state] || STATES.idle, col = C[st.color];
      out += glyph(st.glyph, col, { x: 10, y: 61, size: 20, filled: true, id: 'vt-top-glyph' });
      out += text('vt-top-word', 38, 78, fit(st.word, 96, S.meta, 700), S.meta, 700, col);
      var lw = wrap(cleanTitle(m.top.title), 124, S.title, 400, 2, S.min), l = lw.lines;
      out += text('vt-top-title-1', 10, 104, l[0], lw.size, 400, C.ink);
      if (l[1]) out += text('vt-top-title-2', 10, 127, l[1], lw.size, 400, C.ink);
    } else {
      out += glyph('check', C.done, { x: 58, y: 64, filled: false, id: 'vt-calm' });
      out += text('vt-calm-text', 72, 124, 'All clear', S.meta, 400, C.muted, 'middle');
    }
    return svg(out);
  }

  /* ---------- LIMIT (gauge) ---------- */
  var GAUGE = { cx: 72, cy: 72, r: 54, sweep: 250, start: 235 };
  function polar(r, deg) { var a = (deg - 90) * Math.PI / 180; return [GAUGE.cx + r * Math.cos(a), GAUGE.cy + r * Math.sin(a)]; }
  function arcPath(r) {
    var a = polar(r, GAUGE.start), b = polar(r, GAUGE.start + GAUGE.sweep);
    return 'M' + n(a[0]) + ' ' + n(a[1]) + ' A' + r + ' ' + r + ' 0 1 1 ' + n(b[0]) + ' ' + n(b[1]);
  }
  var ARC_LEN = GAUGE.r * GAUGE.sweep * Math.PI / 180;
  function limit(m) {
    var out = '', has = m.usedPct != null;
    var dim = m.stale || normNote(m.note) === 'Sign in';
    var lc = { neutral: C.neutral, amber: C.permission, red: C.error }[m.level || 'neutral'];
    if (dim) lc = C.faint;
    out += '<path id="vt-ring-track" d="' + arcPath(GAUGE.r) + '" fill="none" stroke="' + C.track + '" stroke-width="' + STROKE.ring + '"/>';
    if (has && m.usedPct > 0) {
      var len = ARC_LEN * Math.min(100, m.usedPct) / 100;
      out += '<path id="vt-ring" d="' + arcPath(GAUGE.r) + '" fill="none" stroke="' + lc + '" stroke-width="' + STROKE.ring + '" stroke-dasharray="' + n(len) + ' 400"/>';
    }
    if (m.pacePct != null && has && !dim) {
      var ang = GAUGE.start + GAUGE.sweep * Math.min(100, m.pacePct) / 100;
      var p1 = polar(45, ang), p2 = polar(62, ang);
      out += '<g id="vt-pace" data-angle="' + n(ang) + '">' +
        '<line x1="' + n(p1[0]) + '" y1="' + n(p1[1]) + '" x2="' + n(p2[0]) + '" y2="' + n(p2[1]) + '" stroke="' + C.ground + '" stroke-width="' + STROKE.paceGap + '"/>' +
        '<line x1="' + n(p1[0]) + '" y1="' + n(p1[1]) + '" x2="' + n(p2[0]) + '" y2="' + n(p2[1]) + '" stroke="' + C.ink + '" stroke-width="' + STROKE.pace + '"/></g>';
    }
    out += text('vt-label', 72, 58, m.label === 'Woche' ? 'Week' : (m.label || ''), S.meta, 700, C.muted, 'middle');
    var num = has ? String(Math.round(m.usedPct)) : '–';
    var numCol = dim ? C.muted : C.ink;
    var nw = textWidth(num, S.pct, 700), uw = has ? textWidth('%', S.unit, 700) + 2 : 0, aw = (m.ahead && has && !dim) ? 22 : 0;
    var x0 = 72 - (nw + uw + aw) / 2;
    out += text('vt-pct', x0, 92, num, S.pct, 700, numCol);
    if (has) out += text('vt-pct-unit', x0 + nw + 2, 92, '%', S.unit, 700, C.muted);
    if (aw) out += glyph('arrowUp', lc, { id: 'vt-ahead', x: x0 + nw + uw + 6, y: 74, size: 18 });
    var foot = m.note ? normNote(m.note) : resetText(m.resetIn);
    var footStrong = normNote(m.note) === 'Sign in';
    out += text(m.note ? 'vt-note' : 'vt-reset', 72, 130, fit(foot, 124, S.meta, footStrong ? 700 : 400), S.meta, footStrong ? 700 : 400, footStrong ? C.ink : C.muted, 'middle');
    return svg(out);
  }

  /* ---------- EXTRA ---------- */
  function splitEuro(s) { s = String(s); var m = /^(.*?)\s*([€$£])$/.exec(s) || /^([€$£])\s*(.*)$/.exec(s); if (!m) return [s, '']; return /^[€$£]$/.test(m[1]) ? [m[2], m[1], true] : [m[1], m[2], false]; }
  function drawAmount(x, y, amt, size, color) {
    if (!amt[1]) return text('vt-amount', x, y, amt[0], size, 700, color);
    var uw = textWidth(amt[1], S.unit, 700);
    if (amt[2]) return text('vt-amount-unit', x, y, amt[1], S.unit, 700, C.muted) + text('vt-amount', x + uw + 3, y, amt[0], size, 700, color);
    return text('vt-amount', x, y, amt[0], size, 700, color) + text('vt-amount-unit', x + textWidth(amt[0], size, 700) + 5, y, amt[1], S.unit, 700, C.muted);
  }
  function extra(m) {
    var out = '', off = normNote(m.note) === 'Disabled', dim = m.stale || normNote(m.note) === 'Sign in' || off;
    var lc = { neutral: C.neutral, amber: C.permission, red: C.error }[m.level || 'neutral'];
    if (dim) lc = C.faint;
    out += text('vt-label', 10, 28, 'Extra', S.meta, 700, C.muted);
    if (m.ratio != null && !off) out += text('vt-pct', SAFE.max, 28, Math.round(m.ratio * 100) + ' %', S.meta, 700, dim ? C.muted : C.ink, 'end');
    var amt = off ? ['off', ''] : (m.used != null ? splitEuro(m.used) : ['–', '']);
    var size = amountSize(amt, 122);
    var ac = off ? C.faint : dim ? C.muted : C.ink;
    out += drawAmount(10, 76, amt, size, ac);
    var sub = m.note ? normNote(m.note) : 'No limit';
    if (!m.note && m.limit) {
      var opts = ['of ' + m.limit, 'of ' + String(m.limit).replace(/[.,]00(?=\s*[€$£]|$)/, ''), String(m.limit)];
      sub = opts[2];
      for (var oi = 0; oi < opts.length; oi++) if (textWidth(opts[oi], S.meta, 400) <= 124) { sub = opts[oi]; break; }
    }
    var strong = normNote(m.note) === 'Sign in';
    out += text(m.note ? 'vt-note' : 'vt-limit', 10, 102, fit(sub, 124, S.meta, strong ? 700 : 400), S.meta, strong ? 700 : 400, strong ? C.ink : off ? C.faint : C.muted);
    if (m.limit || off) {
      out += '<rect id="vt-bar-track" x="10" y="114" width="124" height="' + STROKE.bar + '" rx="6" fill="' + C.track + '"/>';
      if (m.ratio != null && m.ratio > 0 && !off) out += '<rect id="vt-bar" x="10" y="114" width="' + n(Math.max(12, 124 * Math.min(1, m.ratio))) + '" height="' + STROKE.bar + '" rx="6" fill="' + lc + '"/>';
    }
    return svg(out);
  }

  /* amount size step; falls back to a compact form ("1,2 Mio.") when even 18 px does not fit */
  function amountSize(amt, maxW) {
    for (var i = 0; i < S.amount.length; i++) {
      if (textWidth(amt[0], S.amount[i], 700) + (amt[1] ? 6 + textWidth('€', S.unit, 700) : 0) <= maxW) return S.amount[i];
    }
    var raw = amt[0], dec = /[.,](\d{2})$/.exec(raw), v = parseFloat(raw.slice(0, dec ? -3 : undefined).replace(/[.,\s]/g, '') + (dec ? '.' + dec[1] : ''));
    if (!isNaN(v)) amt[0] = v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1e3) + 'k';
    for (var j = 0; j < S.amount.length; j++) if (textWidth(amt[0], S.amount[j], 700) + (amt[1] ? 6 + textWidth('€', S.unit, 700) : 0) <= maxW) return S.amount[j];
    return S.min;
  }

  /* ---------- STATUS ---------- */
  function status(m) {
    var out = '', rows = m.rows || [], alert = m.alert;
    if (alert) out += frame('thick', C.error, 1);
    var ys = alert ? [30, 54, 78, 102] : [33, 60, 87, 114];
    rows.slice(0, 4).forEach(function (r, i) {
      var h = HEALTH[r.health] || HEALTH.off, y = ys[i], col = C[h.color];
      if (r.source === 'MAC') r = { source: 'REM', health: r.health };
      out += '<g id="vt-status-' + r.source + '" data-health="' + r.health + '">' +
        glyph(h.glyph, col, { id: 'vt-status-glyph-' + r.source, x: 10, y: y - 16, size: 20 }) +
        text('vt-status-label-' + r.source, 38, y, r.source, S.meta, 700, C[h.label]) +
        text('vt-status-word-' + r.source, SAFE.max, y, h.word, S.meta, r.health === 'missing' ? 700 : 400, r.health === 'off' ? C.faint : r.health === 'ok' ? C.muted : C.ink, 'end') + '</g>';
    });
    if (alert) out += text('vt-alert', 72, 127, fit(alert, 116, S.meta, 700), S.meta, 700, C.error, 'middle');
    return svg(out);
  }

  /* ====================================================================
     VARIANT "luftig" (calm): fewer elements, larger type, 14 px margin.
     Same tokens, glyphs, states and ids; only layout and what is shown differ.
     ==================================================================== */
  var CALM = { m: 14, max: 130, w: 116, title: 22, titleStep: 20, word: 20 };
  var EMBOLDEN = 0; /* luftig: regular text gets a hairline stroke in its own colour (reads like semibold on the LCD) */
  function calmFrame(kind, color, level) {
    var op = level == null ? 1 : level;
    if (kind === 'thick') return '<rect id="vt-frame" x="3" y="3" width="138" height="138" rx="15" fill="none" stroke="' + color + '" stroke-width="6" stroke-opacity="' + n(op) + '"/>';
    if (kind === 'thin') return '<rect id="vt-frame" x="1.5" y="1.5" width="141" height="141" rx="16" fill="none" stroke="' + color + '" stroke-width="3"/>';
    if (kind === 'dashed') return '<rect id="vt-frame" x="1.5" y="1.5" width="141" height="141" rx="16" fill="none" stroke="' + color + '" stroke-width="2" stroke-dasharray="6 6"/>';
    return '';
  }
  function calmTint(color, level) {
    return '<rect id="vt-tint" x="6" y="6" width="132" height="132" rx="12" fill="' + color + '" fill-opacity="' + n(TINT * (level == null ? 1 : level)) + '"/>';
  }
  function calmTitle(t, lines) {
    var a = layoutTitle(t, CALM.w, CALM.title, 400);
    if (a.hard || a.cut) { var b = layoutTitle(t, CALM.w, CALM.titleStep, 400); if (cost(b) < cost(a)) a = b; }
    if ((a.hard || a.cut) && lines !== 1) { var c = layoutTitle(t, CALM.w, S.min, 400); if (cost(c) < cost(a)) a = c; }
    if (lines === 1) {
      var size = textWidth(t, CALM.title, 400) <= CALM.w ? CALM.title : textWidth(t, CALM.titleStep, 400) <= CALM.w ? CALM.titleStep : S.min;
      return { lines: [fit(t, CALM.w, size, 400)], size: size };
    }
    return a;
  }

  function slotCalm(m) {
    var st = STATES[m.state] || STATES.idle, col = C[st.color], out = '';
    var frameKind = m.frame || (m.state === 'done_unseen' ? 'thick' : 'normal'), level = m.level == null ? 1 : m.level;
    var filled = frameKind === 'thick' || m.state === 'done_unseen';
    var offline = m.state === 'no_signal';
    if (frameKind === 'thick') out += calmTint(col, level) + calmFrame('thick', col, level);
    else if (frameKind === 'thin') out += calmFrame('thin', col);
    else if (offline) out += calmFrame('dashed', C.faint);

    /* header: glyph 22 + state word 18/700 (+ background badge when the footer holds a clock) */
    out += glyph(st.glyph, col, { x: CALM.m, y: 16, size: 22, filled: filled, tick: m.tick });
    var word = m.state === 'background' ? (m.bgStale ? '? jobs' : (m.bgCount > 0 ? m.bgCount + ' jobs' : 'Jobs')) : st.word;
    var hasClock = !m.jumping && st.wait && m.wait != null;
    var bgOn = m.state !== 'background' && (m.bgCount > 0 || m.bgStale), bt = bgOn ? (m.bgStale ? '?' : clampNum(m.bgCount)) : '', bgW = bgOn ? 15 + 2 + textWidth(bt, S.meta, 700) : 0;
    var bgHtml = function (x, base) { return glyph('pie', C.muted, { id: 'vt-bg-glyph', x: x, y: base - 14.5, size: 15 }) + text('vt-bg-count', x + 17, base, bt, S.meta, 700, C.muted); };
    var headerBg = false;
    if (bgOn && hasClock) {
      if (textWidth(word, S.wordMin, 700) <= CALM.max - 42 + 2 - bgW - 6) { headerBg = true; out += bgHtml(CALM.max - bgW, 34); }
      bgOn = false; /* placed in the header, or omitted when the word needs the room (Approve) */
    }
    var ws = headerBg ? (textWidth(word, CALM.word, 700) <= CALM.max - 42 + 2 - bgW - 6 ? CALM.word : S.wordMin) : (textWidth(word, CALM.word, 700) <= CALM.max - 42 + 2 ? CALM.word : S.wordMin);
    out += text('vt-state-word', 42, 34, fit(word, CALM.max - 42 + 2, ws, 700), ws, 700, col);

    /* title: 22 px, 2 lines */
    var tw = calmTitle(cleanTitle(m.title), 2), lines = tw.lines, titleCol = offline ? C.muted : C.ink;
    out += text('vt-title-1', CALM.m, 72, lines[0], tw.size, 400, titleCol);
    if (lines[1]) out += text('vt-title-2', CALM.m, 99, lines[1], tw.size, 400, titleCol);
    else if (m.state === 'error' && m.detail) { /* error kind only, and only when the title leaves room */
      var d = DETAIL[m.detail] || m.detail;
      if (textWidth(d, S.meta, 400) <= CALM.w) out += text('vt-detail', CALM.m, 99, d, S.meta, 400, C.muted);
    }

    /* footer: origin always right; left: clock, "Open…", or the background badge */
    var badge = originLabel(m.badge), rightW = textWidth(badge, S.meta, 700);
    out += text('vt-badge', CALM.max, 126, badge, S.meta, 700, C.muted, 'end');
    if (m.jumping) out += text('vt-jump', CALM.m, 126, 'Open…', S.meta, 400, C.ink);
    else if (hasClock) {
      var cp = clockParts(m.wait), cs = textWidth(cp[0], 22, 700) + 4 + textWidth(cp[1], S.meta, 400) <= CALM.w - rightW - 8 ? 22 : S.clock;
      out += text('vt-clock', CALM.m, 126, cp[0], cs, 700, C.ink) +
             (cp[1] ? text('vt-clock-unit', CALM.m + textWidth(cp[0], cs, 700) + 4, 126, cp[1], S.meta, 400, C.muted) : '');
    } else if (bgOn) out += bgHtml(CALM.m, 126);
    return svg(out);
  }

  function inboxCalm(m) {
    var out = '', waiting = m.waiting || 0, has = waiting > 0 && m.top;
    var cyc = m.cycle && m.cycle.total > 1;
    out += glyph('tray', has ? C.ink : C.faint, { x: CALM.m, y: 15, size: 24 });
    var big = cyc ? clampNum(m.cycle.index) : clampNum(waiting), of = cyc ? '/' + clampNum(m.cycle.total) : '';
    var pillOn = m.overflow && !cyc && 46 + textWidth(big, 20, 700) <= CALM.max - pillWidth(m.overflow) - 6;
    var cs = countSize(big, of, 46, pillOn ? CALM.max - pillWidth(m.overflow) - 6 : CALM.max);
    out += text('vt-count', 46, 39, big, cs, 700, has ? C.ink : C.faint);
    if (cyc) out += text('vt-count-of', 46 + textWidth(big, cs, 700) + 4, 39, of, S.unit, 700, C.muted);
    else if (pillOn) out += overflowPill(m.overflow, CALM.max + 1, 14);
    if (cyc) {
      var segs = Math.min(m.cycle.total, 12), gap = segs > 6 ? 2 : 4, w = (CALM.w - gap * (segs - 1)) / segs, sg = '';
      for (var i = 0; i < segs; i++) sg += '<rect x="' + n(CALM.m + i * (w + gap)) + '" y="53" width="' + n(w) + '" height="4" rx="2" fill="' + (i + 1 === Math.min(m.cycle.index, segs) ? C.ink : C.line) + '"/>';
      out += '<g id="vt-cycle">' + sg + '</g>';
    } else out += '<rect id="vt-divider" x="' + CALM.m + '" y="54" width="' + CALM.w + '" height="2" fill="' + C.track + '"/>';
    if (has) { /* "Next" key: what is up next, never the title (that is on the slot) */
      var st = STATES[m.top.state] || STATES.idle, col = C[st.color];
      out += glyph(st.glyph, col, { x: CALM.m, y: 72, size: 24, filled: true, id: 'vt-top-glyph' });
      var tws = textWidth(st.word, CALM.word, 700) <= CALM.max - 46 + 2 ? CALM.word : S.wordMin;
      out += text('vt-top-word', 46, 92, fit(st.word, CALM.max - 46 + 2, tws, 700), tws, 700, col);
      if (m.top.wait != null) {
        var tc = clockParts(m.top.wait);
        out += text('vt-top-clock', CALM.m, 126, tc[0], S.clock, 700, C.ink) + (tc[1] ? text('vt-top-clock-unit', CALM.m + textWidth(tc[0], S.clock, 700) + 4, 126, tc[1], S.meta, 400, C.muted) : '');
      }
      out += text('vt-next', CALM.max, 126, 'next', S.meta, 400, C.muted, 'end');
    } else {
      out += glyph('check', C.done, { x: 58, y: 70, filled: false, id: 'vt-calm' });
      out += text('vt-calm-text', 72, 124, 'All clear', S.meta, 400, C.muted, 'middle');
    }
    return svg(out);
  }

  function extraCalm(m) {
    var out = '', off = normNote(m.note) === 'Disabled', dim = m.stale || normNote(m.note) === 'Sign in' || off;
    var lc = { neutral: C.neutral, amber: C.permission, red: C.error }[m.level || 'neutral'];
    if (dim) lc = C.faint;
    out += text('vt-label', CALM.m, 34, 'Extra', S.meta, 700, C.muted);
    if (m.ratio != null && !off) out += text('vt-pct', CALM.max, 34, Math.round(m.ratio * 100) + ' %', S.meta, 700, dim ? C.muted : C.ink, 'end');
    var amt = off ? ['off', ''] : (m.used != null ? splitEuro(m.used) : ['–', '']);
    var size = amountSize(amt, CALM.w - 2), ac = off ? C.faint : dim ? C.muted : C.ink;
    out += drawAmount(CALM.m, 82, amt, size, ac);
    if (m.note) {
      var strong = normNote(m.note) === 'Sign in';
      out += text('vt-note', CALM.m, 124, fit(normNote(m.note), CALM.w, S.meta, strong ? 700 : 400), S.meta, strong ? 700 : 400, strong ? C.ink : off ? C.faint : C.muted);
    } else if (m.limit) {
      out += '<rect id="vt-bar-track" x="' + CALM.m + '" y="110" width="' + CALM.w + '" height="' + STROKE.bar + '" rx="6" fill="' + C.track + '"/>';
      if (m.ratio > 0) out += '<rect id="vt-bar" x="' + CALM.m + '" y="110" width="' + n(Math.max(12, CALM.w * Math.min(1, m.ratio))) + '" height="' + STROKE.bar + '" rx="6" fill="' + lc + '"/>';
    } else out += text('vt-limit', CALM.m, 124, 'No limit', S.meta, 400, C.muted);
    return svg(out);
  }

  function statusCalm(m) {
    var out = '', rows = (m.rows || []).map(function (r) { return { source: r.source === 'MAC' ? 'REM' : r.source, health: HEALTH[r.health] ? r.health : 'off' }; });
    var bad = rows.filter(function (r) { return r.health === 'stale' || r.health === 'missing'; });
    var okCount = rows.filter(function (r) { return r.health === 'ok'; }).length;
    if (m.alert) out += calmFrame('thick', C.error, 1);
    if (m.expanded) { /* tap: all sources for 5 s */
      var ey = m.alert ? [32, 56, 80, 104] : [36, 64, 92, 120];
      rows.slice(0, 4).forEach(function (r, i) {
        var h = HEALTH[r.health], y = ey[i], col = C[h.color];
        out += '<g id="vt-status-' + r.source + '" data-health="' + r.health + '">' +
          glyph(h.glyph, col, { id: 'vt-status-glyph-' + r.source, x: CALM.m, y: y - 15, size: 18 }) +
          text('vt-status-label-' + r.source, 36, y, r.source, S.meta, 700, C[h.label]) +
          text('vt-status-word-' + r.source, CALM.max, y, h.word, S.meta, 400, r.health === 'off' ? C.faint : r.health === 'ok' ? C.muted : C.ink, 'end') + '</g>';
      });
      if (m.alert) out += text('vt-alert', 72, 127, fit(m.alert, CALM.w, S.meta, 700), S.meta, 700, C.error, 'middle');
      return svg(out);
    }
    if (m.alert && !bad.length) {
      out += glyph('octagon', C.error, { x: 54, y: 24, size: 36, filled: true, id: 'vt-alert-glyph' });
      out += text('vt-alert', 72, 96, fit(m.alert, CALM.w, S.meta, 700), S.meta, 700, C.ink, 'middle');
      out += text('vt-status-count', 72, 122, 'Sources ok', S.meta, 400, C.muted, 'middle');
      return svg(out);
    }
    if (!bad.length) {
      out += glyph('check', C.done, { x: 52, y: 24, size: 40, id: 'vt-status-all-ok' });
      out += text('vt-status-summary', 72, 96, 'Sources ok', S.meta, 700, C.ink, 'middle');
      out += text('vt-status-count', 72, 122, okCount + ' active', S.meta, 400, C.muted, 'middle');
      return svg(out);
    }
    var ys = m.alert ? [36, 68] : [38, 70, 102];
    bad.slice(0, ys.length).forEach(function (r, i) {
      var h = HEALTH[r.health], y = ys[i], col = C[h.color];
      out += '<g id="vt-status-' + r.source + '" data-health="' + r.health + '">' +
        glyph(h.glyph, col, { id: 'vt-status-glyph-' + r.source, x: CALM.m, y: y - 15, size: 18 }) +
        text('vt-status-label-' + r.source, 36, y, r.source, S.meta, 700, C.ink) +
        text('vt-status-word-' + r.source, 36 + textWidth(r.source, S.meta, 700) + 5, y, h.word, S.meta, 400, C.muted) + '</g>';
    });
    if (m.alert) out += text('vt-alert', 72, 122, fit(m.alert, CALM.w, S.meta, 700), S.meta, 700, C.error, 'middle');
    else if (okCount) out += text('vt-status-rest', CALM.m, 126, 'Others ok', S.meta, 400, C.muted);
    return svg(out);
  }

  function limitCalm(m) { return limit(m); } /* the gauge is already calm; shared */

  /* ---------- escalation: which waiting episodes breathe right now ----------
     episodes: [{id, state, since (s), seen}], t: now (s). Returns {id: 'A'|'B'|'C'|'D'}.
     A = first 30 s, C = reminder (oldest unseen, every 60 s for 3.6 s), B = static urgent, D = seen.
     At most 2 tiles breathe: newest A episodes first, then the C reminder. */
  function escalation(episodes, t) {
    var res = {}, unseen = [];
    episodes.forEach(function (e) {
      if (e.state !== 'needs_permission' && e.state !== 'needs_input') return;
      if (e.seen) { res[e.id] = 'D'; return; }
      res[e.id] = 'B'; unseen.push(e);
    });
    var budget = 2;
    unseen.filter(function (e) { return t - e.since < 30; }).sort(function (a, b) { return b.since - a.since; })
      .forEach(function (e) { if (budget > 0) { res[e.id] = 'A'; budget--; } });
    var oldest = unseen.slice().sort(function (a, b) { return a.since - b.since; })[0];
    if (oldest && budget > 0 && res[oldest.id] === 'B') { var age = t - oldest.since; if (age >= 60 && age % 60 < 3.6) res[oldest.id] = 'C'; }
    return res;
  }

  function render(m, opts) {
    if (opts && opts.variant === 'luftig') {
      EMBOLDEN = 0.7;
      try {
        switch (m && m.kind) {
          case 'slot': return slotCalm(m);
          case 'inbox': return inboxCalm(m);
          case 'limit': return limitCalm(m);
          case 'extra': return extraCalm(m);
          case 'status': return statusCalm(m);
          default: return empty();
        }
      } finally { EMBOLDEN = 0; }
    }
    switch (m && m.kind) {
      case 'slot': return slot(m);
      case 'empty': return empty();
      case 'inbox': return inbox(m);
      case 'limit': return limit(m);
      case 'extra': return extra(m);
      case 'status': return status(m);
      default: return empty();
    }
  }
  /* breathing: 4 discrete steps per 1.2 s period (4 fps) */
  var BREATH = [0.35, 0.675, 1, 0.675];
  function breathLevel(frameIndex) { return BREATH[frameIndex % 4]; }

  var api = {
    tokens: { color: C, size: S, stroke: STROKE, tint: TINT, font: FONT, safe: SAFE },
    states: STATES, health: HEALTH, detailLabels: DETAIL, breath: BREATH,
    render: render, slot: slot, empty: empty, inbox: inbox, limit: limit, extra: extra, status: status,
    glyph: glyph, breathLevel: breathLevel, escalation: escalation, variants: ['dicht', 'luftig'], clock: clock, clockParts: clockParts, textWidth: textWidth, wrap: wrap, fit: fit
  };
  root.VibeTribe = api;
})(typeof window !== 'undefined' ? window : globalThis);
