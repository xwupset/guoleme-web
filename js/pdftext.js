/* 过了么 · 自带 PDF 文本抽取器
   ---------------------------------------------------------------
   为什么需要它？
   教务系统导出的课表 PDF（iText + 宋体 CID 字体）里，文本其实是
   UTF-16BE 明文，但字体声明成 STSong-Light-UniGB-UCS2-H 这类
   CID 字体。pdf.js 遇到这种 PDF 会去下载 CMap 表，
   在离线 / 移动端经常失败，最终一行字都读不出来。

   本模块完全自给自足：
     1) 直接扫 PDF 字节，找出所有 FlateDecode 流；
     2) 用浏览器原生 DecompressionStream 解压（不依赖任何第三方库）；
     3) 递归解析内容流的文本算子（Tj / TJ / Td / TD / Tm / T*）；
     4) 按坐标把散落的文本片段还原成「行」；
     5) 文字按 UTF-16BE / Latin-1 双路解码并择优。

   对外：GuoLePdfText.extract(arrayBuffer) -> Promise<{pages, text, charCount, cidFonts}>
*/
(function () {
  'use strict';

  /* ============ 一、PDF 对象扫描 ============ */

  function latin1(bytes, start, end) {
    var s = '';
    var CH = 8192;
    for (var i = start; i < end; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, end)));
    }
    return s;
  }

  /* 找出所有 "N 0 obj ... endobj"，返回 {num: {start, end, body}} */
  function scanObjects(bytes) {
    var text = latin1(bytes, 0, bytes.length);
    var objs = {};
    var re = /(\d+)\s+(\d+)\s+obj\b/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var num = parseInt(m[1], 10);
      var bodyStart = m.index + m[0].length;
      var endIdx = text.indexOf('endobj', bodyStart);
      if (endIdx < 0) endIdx = text.length;
      objs[num] = { num: num, bodyStart: bodyStart, bodyEnd: endIdx };
    }
    return { text: text, objs: objs };
  }

  /* 取某个对象的字典头部（到 stream 或 >> 为止） */
  function objectDict(text, obj) {
    return text.slice(obj.bodyStart, Math.min(obj.bodyEnd, obj.bodyStart + 4000));
  }

  /* 取某个对象的 stream 原始字节区间 */
  function objectStream(text, obj) {
    var seg = text.slice(obj.bodyStart, obj.bodyEnd);
    var i = seg.indexOf('stream');
    if (i < 0) return null;
    var after = obj.bodyStart + i + 6;
    // stream 关键字后应紧跟 \r\n 或 \n
    if (text.charCodeAt(after) === 13) after++;
    if (text.charCodeAt(after) === 10) after++;
    var j = text.indexOf('endstream', after);
    if (j < 0) return null;
    return { dataStart: after, dataEnd: j };
  }

  /* ============ 二、滤镜链解压（全同步，用 fflate） ============
     为什么不用浏览器原生 DecompressionStream？
       - 它是「异步流」，读起来要包装 Response + Reader，代码复杂；
       - 部分旧 WebView / 隐私模式不支持；
       - 在无头浏览器里会被虚拟时钟卡住，完全没法自动化测试。
     fflate 只有 32KB，提供同步的 unzlibSync / inflateSync，一次到位。
     =============================================================== */

  function fx() { return window.fflate || null; }

  /* 同步解压：先按 zlib 容器解（PDF 的 FlateDecode 绝大多数带 zlib 头），
     失败再按裸 deflate 解（少数生成器写出的是裸流）。 */
  function inflateSyncCompat(bytes) {
    var f = fx();
    if (!f) throw new Error('fflate 未加载（缺少 lib/fflate.min.js）');
    var firstErr = null;
    if (typeof f.unzlibSync === 'function') {
      try { return f.unzlibSync(bytes); } catch (e) { firstErr = e; }
    }
    if (typeof f.inflateSync === 'function') {
      try { return f.inflateSync(bytes); } catch (e) { /* 继续抛下面的错 */ }
    }
    throw firstErr || new Error('Flate 解压失败');
  }

  /* ASCIIHexDecode：<...> 或 直接十六进制字符，以 > 结束 */
  function asciiHexDecode(bytes) {
    var out = [];
    var hi = -1;
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      if (c === 0x3E) break;                        // >
      var v;
      if (c >= 0x30 && c <= 0x39) v = c - 0x30;
      else if (c >= 0x41 && c <= 0x46) v = c - 0x37;
      else if (c >= 0x61 && c <= 0x66) v = c - 0x57;
      else continue;                                // 跳过空白/换行
      if (hi < 0) hi = v;
      else { out.push((hi << 4) | v); hi = -1; }
    }
    if (hi >= 0) out.push(hi << 4);
    return new Uint8Array(out);
  }

  /* ASCII85Decode：Adobe 的 base85，以 ~> 结束 */
  function ascii85Decode(bytes) {
    var out = [];
    var group = [];
    var i = 0;
    // 跳过可选的 <~
    if (bytes[0] === 0x3C && bytes[1] === 0x7E) i = 2;
    for (; i < bytes.length; i++) {
      var c = bytes[i];
      if (c === 0x7E) break;                        // ~
      if (c === 0x20 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0) continue;
      if (c === 0x7A && group.length === 0) {       // z => 4 个零字节
        out.push(0, 0, 0, 0);
        continue;
      }
      if (c < 0x21 || c > 0x75) continue;           // '!' .. 'u'
      group.push(c - 0x21);
      if (group.length === 5) {
        var n = 0;
        for (var k = 0; k < 5; k++) n = n * 85 + group[k];
        out.push((n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF);
        group = [];
      }
    }
    if (group.length > 1) {
      var pad = 5 - group.length;
      var nn = 0;
      for (var k2 = 0; k2 < group.length; k2++) nn = nn * 85 + group[k2];
      for (var p = 0; p < pad; p++) nn = nn * 85 + 84;
      var full = [(nn >>> 24) & 0xFF, (nn >>> 16) & 0xFF, (nn >>> 8) & 0xFF, nn & 0xFF];
      for (var q = 0; q < 4 - pad; q++) out.push(full[q]);
    }
    return new Uint8Array(out);
  }

  /* RunLengthDecode */
  function runLengthDecode(bytes) {
    var out = [];
    var i = 0;
    while (i < bytes.length) {
      var l = bytes[i++];
      if (l === 128) break;
      if (l < 128) {
        for (var k = 0; k <= l && i < bytes.length; k++) out.push(bytes[i++]);
      } else {
        var b = bytes[i++];
        for (var k2 = 0; k2 < 257 - l; k2++) out.push(b);
      }
    }
    return new Uint8Array(out);
  }

  /* LZWDecode（PDF 变体，早期码长 9，256 为 clear，257 为 EOD） */
  function lzwDecode(bytes) {
    var out = [];
    var dict = [];
    var reset = function () {
      dict = [];
      for (var i = 0; i < 256; i++) dict.push([i]);
      dict.push(null); dict.push(null);            // 256 clear, 257 eod
    };
    reset();
    var codeLen = 9;
    var bitBuf = 0, bitCnt = 0, prev = null;
    for (var i = 0; i < bytes.length; i++) {
      bitBuf = (bitBuf << 8) | bytes[i];
      bitCnt += 8;
      while (bitCnt >= codeLen) {
        var code = (bitBuf >> (bitCnt - codeLen)) & ((1 << codeLen) - 1);
        bitCnt -= codeLen;
        if (code === 256) { reset(); codeLen = 9; prev = null; continue; }
        if (code === 257) return new Uint8Array(out);
        var entry;
        if (code < dict.length && dict[code]) entry = dict[code];
        else if (prev) entry = prev.concat([prev[0]]);
        else continue;
        for (var k = 0; k < entry.length; k++) out.push(entry[k]);
        if (prev) {
          dict.push(prev.concat([entry[0]]));
          if (dict.length + 1 >= (1 << codeLen) && codeLen < 12) codeLen++;
        }
        prev = entry;
      }
    }
    return new Uint8Array(out);
  }

  /* 解析 /Filter 与 /DecodeParms */
  function readFilterNames(dictHead) {
    var names = [];
    var fm = dictHead.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/);
    if (!fm) return names;
    var seg = fm[1];
    var re = /\/([A-Za-z0-9]+)/g;
    var m;
    while ((m = re.exec(seg)) !== null) names.push(m[1]);
    return names;
  }

  function applyFilters(raw, names) {
    var data = raw;
    for (var i = 0; i < names.length; i++) {
      if (!data || !data.length) return data;
      switch (names[i]) {
        case 'FlateDecode':
        case 'Fl':
          data = inflateSyncCompat(data);
          break;
        case 'ASCII85Decode':
        case 'A85':
          data = ascii85Decode(data);
          break;
        case 'ASCIIHexDecode':
        case 'AHx':
          data = asciiHexDecode(data);
          break;
        case 'RunLengthDecode':
        case 'RL':
          data = runLengthDecode(data);
          break;
        case 'LZWDecode':
        case 'LZW':
          data = lzwDecode(data);
          break;
        case 'Crypt':
          break;
        default:
          break;                       // 未知滤镜：当作已经解好，继续往下走
      }
    }
    return data;
  }

  /* ============ 三、内容流词法解析 ============ */

  var WHITESPACE = [0, 9, 10, 12, 13, 32];
  function isWS(c) { return WHITESPACE.indexOf(c) >= 0; }
  function isDelim(c) {
    return c === 0x28 || c === 0x29 || c === 0x3C || c === 0x3E ||
           c === 0x5B || c === 0x5D || c === 0x7B || c === 0x7D ||
           c === 0x2F || c === 0x25;
  }
  function isRegular(c) { return !isWS(c) && !isDelim(c); }

  function pairToUnicode(u, v) {
    return ((u << 8) | v) & 0xFFFF;
  }

  /* 解析 PDF 字面量字符串 ( ... ) */
  function readLiteralString(b, i) {
    i++;                                    // 跳过 (
    var out = [];
    var depth = 1;
    while (i < b.length) {
      var c = b[i];
      if (c === 0x5C) {                     // 反斜杠
        i++;
        var n = b[i];
        if (n === 0x6E) { out.push(10); i++; }
        else if (n === 0x72) { out.push(13); i++; }
        else if (n === 0x74) { out.push(9); i++; }
        else if (n === 0x62) { out.push(8); i++; }
        else if (n === 0x66) { out.push(12); i++; }
        else if (n === 0x28 || n === 0x29 || n === 0x5C) { out.push(n); i++; }
        else if (n >= 0x30 && n <= 0x37) {   // 八进制 1~3 位
          var v = 0, k = 0;
          while (k < 3 && i < b.length && b[i] >= 0x30 && b[i] <= 0x37) {
            v = v * 8 + (b[i] - 0x30); i++; k++;
          }
          out.push(v & 0xFF);
        }
        else if (n === 10) { i++; }          // 续行
        else if (n === 13) { i++; if (b[i] === 10) i++; }
        else { out.push(n); i++; }
      } else if (c === 0x28) { depth++; out.push(c); i++; }
      else if (c === 0x29) {
        depth--;
        if (depth === 0) { i++; break; }
        out.push(c); i++;
      } else { out.push(c); i++; }
    }
    return { bytes: new Uint8Array(out), next: i };
  }

  /* 解析十六进制字符串 < ... > */
  function readHexString(b, i) {
    i++;                                    // 跳过 <
    var s = '';
    while (i < b.length && b[i] !== 0x3E) {
      var c = b[i];
      if (c === 0x20 || c === 10 || c === 13 || c === 9) { i++; continue; }
      s += String.fromCharCode(c);
      i++;
    }
    i++;                                    // 跳过 >
    if (s.length & 1) s += '0';
    var out = new Uint8Array(s.length >> 1);
    for (var k = 0; k < out.length; k++) {
      out[k] = parseInt(s.substr(k * 2, 2), 16) || 0;
    }
    return { bytes: out, next: i };
  }

  function readName(b, i) {
    i++;                                    // 跳过 /
    var s = '';
    while (i < b.length && isRegular(b[i])) { s += String.fromCharCode(b[i]); i++; }
    return { name: s, next: i };
  }

  function readNumberToken(b, i) {
    var start = i;
    while (i < b.length && (isRegular(b[i]) || b[i] === 0x2B || b[i] === 0x2D || b[i] === 0x2E)) i++;
    var s = latin1(b, start, i);
    return { num: parseFloat(s), raw: s, next: i };
  }

  /* 把内容流切成 token 数组。
     token: {t:'num',v} | {t:'str',bytes} | {t:'name',v} | {t:'op',v}
            | {t:'arr',items} | {t:'dict',map} */
  function tokenize(b) {
    var toks = [];
    var i = 0;
    var stack = [];                         // 用于 [ ... ] 数组
    while (i < b.length) {
      var c = b[i];
      if (isWS(c)) { i++; continue; }
      if (c === 0x25) {                     // % 注释
        while (i < b.length && b[i] !== 10 && b[i] !== 13) i++;
        continue;
      }
      if (c === 0x28) { var r = readLiteralString(b, i); toks.push({ t: 'str', bytes: r.bytes }); i = r.next; continue; }
      if (c === 0x3C && b[i + 1] !== 0x3C) { var h = readHexString(b, i); toks.push({ t: 'str', bytes: h.bytes }); i = h.next; continue; }
      if (c === 0x3C && b[i + 1] === 0x3C) {  // <<
        i += 2;
        var map = {};
        while (i < b.length && !(b[i] === 0x3E && b[i + 1] === 0x3E)) {
          if (isWS(b[i])) { i++; continue; }
          if (b[i] === 0x2F) {
            var nm = readName(b, i); i = nm.next;
            while (i < b.length && isWS(b[i])) i++;
            if (b[i] === 0x28) { var vs = readLiteralString(b, i); map[nm.name] = vs.bytes; i = vs.next; }
            else if (b[i] === 0x2F) { var vn = readName(b, i); map[nm.name] = vn.name; i = vn.next; }
            else if (b[i] === 0x5B) { i++; while (i < b.length && b[i] !== 0x5D) i++; i++; }
            else { var vv = readNumberToken(b, i); map[nm.name] = vv.num; i = vv.next; }
          } else { i++; }
        }
        i += 2;
        toks.push({ t: 'dict', map: map });
        continue;
      }
      if (c === 0x3E && b[i + 1] === 0x3E) { i += 2; continue; }
      if (c === 0x5B) { i++; toks.push({ t: 'arrOpen' }); continue; }
      if (c === 0x5D) { i++; toks.push({ t: 'arrClose' }); continue; }
      if (c === 0x2F) { var n2 = readName(b, i); toks.push({ t: 'name', v: n2.name }); i = n2.next; continue; }
      if (c === 0x7B || c === 0x7D) { i++; continue; }
      var tk = readNumberToken(b, i);
      if (tk.next === i) { i++; continue; }
      if (/^[-+]?[\d.]+$/.test(tk.raw)) toks.push({ t: 'num', v: tk.num });
      else toks.push({ t: 'op', v: tk.raw });
      i = tk.next;
    }
    return toks;
  }

  /* ============ 四、文本算子 → 带坐标的文本片段 ============ */

  function matMul(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5]
    ];
  }

  /* 文本片段收集：只关心位置和字节，字体由调用方解码 */
  function collectText(tokens) {
    var out = [];
    var ctm = [1, 0, 0, 1, 0, 0];
    var ctmStack = [];
    var tm = [1, 0, 0, 1, 0, 0];
    var tlm = [1, 0, 0, 1, 0, 0];
    var leading = 0;
    var fontSize = 10;
    var nums = [];
    var curFont = '';

    function flush(textBytes) {
      if (!textBytes || !textBytes.length) return;
      var m = matMul(tm, ctm);            // 文本空间 → 设备空间
      out.push({
        bytes: textBytes,
        x: m[4],
        y: m[5],
        size: Math.abs(fontSize * m[3]) || Math.abs(fontSize) || 10,
        font: curFont
      });
    }

    function num(n) { return typeof n === 'number' && isFinite(n); }

    for (var idx = 0; idx < tokens.length; idx++) {
      var t = tokens[idx];
      if (t.t === 'num') { nums.push(t.v); continue; }
      if (t.t === 'name') {
        // 记录 /F1 12 Tf 里的字体名
        nums.push(t);
        continue;
      }
      if (t.t !== 'op') { nums.push(t); continue; }
      var op = t.v;

      if (op === 'q') { ctmStack.push(ctm.slice()); }
      else if (op === 'Q') { if (ctmStack.length) ctm = ctmStack.pop(); }
      else if (op === 'cm') {
        var c6 = nums.slice(-6).map(function (x) { return num(x) ? x : 0; });
        if (c6.length === 6) ctm = matMul(c6, ctm);
      }
      else if (op === 'BT') { tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); }
      else if (op === 'Tf') {
        var fs = nums.filter(num);
        var nmTok = nums.filter(function (x) { return x && x.t === 'name'; });
        if (nmTok.length) curFont = nmTok[nmTok.length - 1].v;
        if (fs.length) fontSize = fs[fs.length - 1];
      }
      else if (op === 'TL') { var l = nums.filter(num); if (l.length) leading = l[l.length - 1]; }
      else if (op === 'Td' || op === 'TD') {
        var d = nums.filter(num);
        if (d.length >= 2) {
          var tx = d[d.length - 2], ty = d[d.length - 1];
          tlm = matMul([1, 0, 0, 1, tx, ty], tlm);
          tm = tlm.slice();
          if (op === 'TD') leading = -ty;
        }
      }
      else if (op === 'Tm') {
        var m6 = nums.filter(num);
        if (m6.length >= 6) {
          tlm = m6.slice(-6);
          tm = tlm.slice();
        }
      }
      else if (op === 'T*') {
        tlm = matMul([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm.slice();
      }
      else if (op === 'Tj') {
        var sTok = null;
        for (var k = nums.length - 1; k >= 0; k--) { if (nums[k] && nums[k].t === 'str') { sTok = nums[k]; break; } }
        if (sTok) flush(sTok.bytes);
      }
      else if (op === 'TJ') {
        // 数组里的字符串依次输出（数值是字距调整，这里忽略，靠坐标还原间距）
        var arr = null;
        for (var k2 = nums.length - 1; k2 >= 0; k2--) { if (nums[k2] && nums[k2].t === 'arr') { arr = nums[k2]; break; } }
        if (arr) arr.items.forEach(function (it) { if (it && it.t === 'str') flush(it.bytes); });
      }
      else if (op === "'" || op === '"') {
        var sTok2 = null;
        for (var k3 = nums.length - 1; k3 >= 0; k3--) { if (nums[k3] && nums[k3].t === 'str') { sTok2 = nums[k3]; break; } }
        if (sTok2) { tlm = matMul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); flush(sTok2.bytes); }
      }
      nums = [];
    }
    return out;
  }

  /* 把 token 流里的 [ ... ] 折叠成 arr token */
  function foldArrays(tokens) {
    var out = [];
    var stack = [];
    tokens.forEach(function (t) {
      if (t.t === 'arrOpen') { stack.push([]); return; }
      if (t.t === 'arrClose') {
        var done = stack.pop() || [];
        var tok = { t: 'arr', items: done };
        if (stack.length) stack[stack.length - 1].push(tok);
        else out.push(tok);
        return;
      }
      if (stack.length) stack[stack.length - 1].push(t);
      else out.push(t);
    });
    while (stack.length) out.push({ t: 'arr', items: stack.pop() });
    return out;
  }

  /* ============ 五、字节 → 文本（三路择优 + ToUnicode 映射） ============ */

  /* 解析 ToUnicode CMap 文本，返回 {code: unicode} */
  function parseToUnicode(cmapText) {
    var map = {};
    var txt = String(cmapText || '');

    // beginbfchar ... endbfchar : <src> <dst>
    var bcRe = /beginbfchar([\s\S]*?)endbfchar/g;
    var m;
    while ((m = bcRe.exec(txt)) !== null) {
      var body = m[1];
      var pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      var p;
      while ((p = pairRe.exec(body)) !== null) {
        var src = parseInt(p[1], 16);
        var dstHex = p[2];
        // 目标可能是多字符（连字），只取第一个 UTF-16 码元
        var dst = parseInt(dstHex.substr(0, 4), 16);
        map[src] = dst;
      }
    }

    // beginbfrange ... endbfrange : <lo> <hi> <dst>  或  <lo> <hi> [<d1> <d2> ...]
    var brRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = brRe.exec(txt)) !== null) {
      var b = m[1];
      var rRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[\s\S]*?\])/g;
      var r;
      while ((r = rRe.exec(b)) !== null) {
        var lo = parseInt(r[1], 16);
        var hi = parseInt(r[2], 16);
        var dstSpec = r[3];
        if (dstSpec.charAt(0) === '[') {
          var items = dstSpec.match(/<([0-9A-Fa-f]+)>/g) || [];
          items.forEach(function (it, idx) {
            var v = parseInt(it.replace(/[<>]/g, '').substr(0, 4), 16);
            map[lo + idx] = v;
          });
        } else {
          var base = parseInt(dstSpec.replace(/[<>]/g, '').substr(0, 4), 16);
          for (var c = lo; c <= hi && (c - lo) < 65536; c++) {
            map[c] = base + (c - lo);
          }
        }
      }
    }
    return map;
  }

  /* 字节 → 文本（三路解码择优） */
  function bytesToText(bytes, touMap) {
    if (!bytes || !bytes.length) return '';

    // 路径 0：有 ToUnicode 映射时按 1 字节码查表（子集字体最常见）
    if (touMap) {
      var viaMap = '';
      var hit = 0;
      for (var z = 0; z < bytes.length; z++) {
        var u = touMap[bytes[z]];
        if (u) { viaMap += String.fromCharCode(u); hit++; }
        else viaMap += bytes[z] >= 0x20 && bytes[z] < 0x7f ? String.fromCharCode(bytes[z]) : '';
      }
      if (hit / bytes.length > 0.5) return viaMap;
    }

    // 路径 1：UTF-16BE（iText + CID 字体的常见情形）
    var u16 = '';
    var n16 = bytes.length >> 1;
    for (var i = 0; i < n16; i++) {
      u16 += String.fromCharCode(pairToUnicode(bytes[i * 2], bytes[i * 2 + 1]));
    }
    // 路径 2：Latin-1 直读（标准编码的 PDF）
    var l1 = '';
    for (var j = 0; j < bytes.length; j++) l1 += String.fromCharCode(bytes[j]);

    var score = function (s) {
      if (!s) return -1;
      var cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
      var ascii = (s.match(/[\x20-\x7e]/g) || []).length;
      var ctrl = (s.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g) || []).length;
      return cjk * 3 + ascii - ctrl * 6;
    };
    return score(u16) >= score(l1) ? u16 : l1;
  }

  function cleanPiece(s) {
    return String(s || '')
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/\u00a0/g, ' ');
  }

  /* ============ 六、片段 → 行 ============ */

  function piecesToLines(pieces, touMap) {
    if (!pieces.length) return [];
    var sizes = pieces.map(function (p) { return p.size; }).sort(function (a, b) { return a - b; });
    var medSize = sizes[Math.floor(sizes.length / 2)] || 10;
    var tol = Math.max(2, medSize * 0.5);

    var ordered = pieces.slice().sort(function (a, b) {
      if (Math.abs(a.y - b.y) > tol) return b.y - a.y;
      return a.x - b.x;
    });

    var groups = [], cur = null;
    ordered.forEach(function (p) {
      if (cur && Math.abs(cur.y - p.y) <= tol) cur.items.push(p);
      else { cur = { y: p.y, items: [p] }; groups.push(cur); }
    });

    return groups.map(function (g) {
      g.items.sort(function (a, b) { return a.x - b.x; });
      var text = '';
      var prev = null;
      g.items.forEach(function (p) {
        var s = cleanPiece(bytesToText(p.bytes, touMap));
        if (!s) return;
        if (prev) {
          var a = text.slice(-1), b = s.charAt(0);
          var bothCjk = /[\u3000-\u9fff\uff00-\uffef]/.test(a) && /[\u3000-\u9fff\uff00-\uffef]/.test(b);
          if (!bothCjk && !/\s$/.test(text) && !/^\s/.test(s)) {
            text += ' ';
          } else if (bothCjk) {
            // PDF 表格里相邻单元格常常紧贴，不补空格会让「姓名：黄宇翔」和
            // 「学号：…」粘成一个词。用 x 间距判断是不是不同单元格。
            var estW = prev.bytes.length * prev.size * 0.5;
            var gap = p.x - (prev.x + estW);
            if (gap > Math.max(6, prev.size * 0.9)) text += ' ';
          }
        }
        text += s;
        prev = p;
      });
      return { y: g.y, text: text.replace(/[ \t]+/g, ' ').trim() };
    }).filter(function (l) { return l.text; });
  }

  /* ============ 七、主入口 ============ */

  /* 核心实现：同步抽取 */
  function _extract(buffer) {
    var bytes = new Uint8Array(buffer);
    var scan = scanObjects(bytes);
    var text = scan.text;
    var jobs = [];
    var cidFonts = [];

    Object.keys(scan.objs).forEach(function (numStr) {
      var obj = scan.objs[numStr];
      var seg = text.slice(obj.bodyStart, obj.bodyEnd);
      if (seg.indexOf('stream') < 0) return;
      var range = objectStream(text, obj);
      if (!range) return;
      var raw = bytes.subarray(range.dataStart, range.dataEnd);
      var dictHead = seg.slice(0, seg.indexOf('stream'));
      jobs.push({
        num: parseInt(numStr, 10),
        raw: raw,
        filters: readFilterNames(dictHead)
      });
    });

    // 记录 CID 字体（供诊断报告使用）
    var fontRe = /\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g;
    var fm;
    while ((fm = fontRe.exec(text)) !== null) {
      if (/Song|Hei|Kai|Ming|GB|UniGB|STSong|SimSun/i.test(fm[1])) cidFonts.push(fm[1]);
    }

    /* 第一步：把所有流解压出来（同步）。
       同时先把 ToUnicode 表收齐 —— 它可能出现在内容流之后，
       所以不能边解边解析，必须两轮走。 */
    var results = [];
    jobs.forEach(function (j) {
      var data = null;
      try { data = applyFilters(j.raw, j.filters); }
      catch (e) { data = null; }                 // 个别流解不开就跳过，不影响其它
      results.push({ num: j.num, data: data });
    });

    var touMap = {};                             // 合并所有字体的 ToUnicode 映射
    var decoded = [];
    results.forEach(function (r) {
      if (!r.data || !r.data.length) return;
      var txtHead = latin1(r.data, 0, Math.min(600, r.data.length));
      if (/begincmap|beginbfchar|beginbfrange/.test(txtHead)) {
        var m = parseToUnicode(latin1(r.data, 0, r.data.length));
        Object.keys(m).forEach(function (k) { touMap[k] = m[k]; });
      }
      decoded.push(r);
    });

    /* 第二步：解析内容流（此时 touMap 一定已经齐了） */
    var allPages = [];
    decoded.forEach(function (r) {
      var txtHead = latin1(r.data, 0, Math.min(600, r.data.length));
      if (/begincmap|beginbfchar|beginbfrange/.test(txtHead)) return;   // 这是 CMap 不是内容流
      if (!/\bTj\b|\bTJ\b|\bBT\b/.test(txtHead)) return;
      var tokens = foldArrays(tokenize(r.data));
      var pieces = collectText(tokens);
      if (!pieces.length) return;
      allPages.push(piecesToLines(pieces, touMap));
    });

    // 页内行按 y 从高到低已排好，页面之间直接拼接
    var lines = [];
    allPages.forEach(function (pg, i) {
      if (allPages.length > 1) lines.push('===== 第 ' + (i + 1) + ' 页 =====');
      pg.forEach(function (l) { lines.push(l.text); });
    });
    var out = lines.join('\n');
    var charCount = (out.match(/[\u4e00-\u9fffA-Za-z]/g) || []).length;
    // 判断是不是「扫描件 / 图片型 PDF」：一个字体都没有，但有图片对象。
    // 这种情况再怎么解析也读不出文字，要尽早给用户明确的提示。
    var hasFont = /\/BaseFont\b/.test(text);
    var hasImage = /\/Subtype\s*\/Image\b/.test(text) ||
                   /\/DCTDecode\b/.test(text) || /\/JPXDecode\b/.test(text) ||
                   /\/CCITTFaxDecode\b/.test(text);
    return {
      text: out,
      lines: lines,
      pages: allPages.length,
      charCount: charCount,
      cidFonts: cidFonts.slice(0, 8),
      imageOnly: !hasFont && hasImage
    };
  }

  /* 对外仍返回 Promise，方便调用方统一 await；
     内部已经是同步的，所以这里不会引入任何时序问题。 */
  function extractAsync(buffer) {
    try {
      return Promise.resolve(extractSync(buffer));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function extractSync(buffer) {
    return _extract(buffer);
  }

  window.GuoLePdfText = {
    extract: extractAsync,
    extractSync: extractSync,
    _tokenize: tokenize,
    _foldArrays: foldArrays,
    _collectText: collectText,
    _piecesToLines: piecesToLines,
    _bytesToText: bytesToText,
    _scanObjects: scanObjects
  };
})();
