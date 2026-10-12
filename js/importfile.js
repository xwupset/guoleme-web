/* 过了么 · 文件导入引擎
   目标：把用户在教务系统「导出/下载」下来的文件，一步变成课程列表。

   支持格式（按魔数自动嗅探，绝不问用户）：
     .pdf  → ① 自带抽取器 GuoLePdfText（零依赖，能处理 CID 字体/多级滤镜/ToUnicode）
             ② 失败才回退 pdf.js
     .xlsx / .xls / .csv → SheetJS（含 GBK 编码与 HTML 伪装的 xls）
     .json → 课表 App 导出格式 + 本程序状态格式
     纯文本 → 直接交给解析器

   解析层（双层）：
     ① GuoLeParser    —— 通用「课程名 + 学分」
     ② GuoLeTimetable —— 周课表网格（列=星期），能补出教师 / 周次

   对外入口：GuoLeImport.readFile(file, onProgress) -> Promise<report>
     report = {
       ok, format, text,                      // 基础
       identity: {name, sid},                 // 自动识别到的姓名/学号
       courses: [{name, credit, teacher, weeks, source}],
       structure: 'timetable' | 'table' | 'text',
       hasCredit: bool,                       // 课程是否带学分
       warnings: [], error
     }
*/
(function () {
  'use strict';

  /* ---------- 定位 lib/ ----------
     本文件与 index.html 同级，lib/ 在 index.html 下的 lib/。
     用 document.baseURI（= 页面地址）而不是 import.meta.url：
     这样本文件可以当【普通脚本】同步加载，不依赖模块时序。
     无论部署在根目录还是子目录，路径都能算对。 */
  var LIB_BASE = new URL('lib/', document.baseURI);

  function libUrl(name) { return new URL(name, LIB_BASE).href; }

  /* ============ 一、格式嗅探 ============ */

  function sniff(bytes, filename) {
    var b = bytes;
    if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'zip';
    if (b.length >= 8 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'cfb';
    var ext = (String(filename || '').split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'text';
    if (ext === 'json') return 'json';
    if (b.length >= 5 && b[0] === 0x3C) return 'html';
    return 'text';
  }

  /* ============ 二、编码识别（utf-8 / gb18030 二选一） ============ */

  function decodeSmart(bytes) {
    var tryDec = function (label) {
      try { return new TextDecoder(label, { fatal: false }).decode(bytes); } catch (e) { return null; }
    };
    var score = function (s) {
      if (!s) return -1;
      var bad = (s.match(/\uFFFD/g) || []).length;
      var cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
      return cjk * 2 - bad * 10;
    };
    var best = tryDec('utf-8'), bestScore = score(best);
    ['gb18030', 'gbk', 'big5'].forEach(function (enc) {
      var cand = tryDec(enc);
      if (!cand) return;
      var sc = score(cand);
      if (sc > bestScore) { best = cand; bestScore = sc; }
    });
    return best || '';
  }

  /* ============ 三、PDF ============ */

  /* 主路径：自带抽取器 */
  function extractWithOwn(bytes) {
    if (!window.GuoLePdfText) return Promise.reject(new Error('pdftext.js 未加载'));
    // 复制一份，避免抽取器内部对 buffer 做转移影响后续回退
    var copy = bytes.slice(0);
    return window.GuoLePdfText.extract(copy.buffer);
  }

  /* 兜底路径：pdf.js */
  var _pdfjs = null;
  function loadPdfJs() {
    if (_pdfjs) return _pdfjs;
    _pdfjs = import(libUrl('pdf.min.mjs')).then(function (mod) {
      var lib = mod && mod.getDocument ? mod : (window.pdfjsLib || mod);
      if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = libUrl('pdf.worker.min.mjs');
      window.pdfjsLib = lib;
      return lib;
    });
    return _pdfjs;
  }

  function gapNeedsSpace(prev, next) {
    var a = prev.text.slice(-1), b = next.text.charAt(0);
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(a) && /[\u3000-\u9fff\uff00-\uffef]/.test(b)) return false;
    if (/\s$/.test(prev.text) || /^\s/.test(next.text)) return false;
    return true;
  }

  function itemsToLines(items) {
    var toks = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.str == null || !it.str.replace(/\s/g, '').length) continue;
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      toks.push({
        text: it.str, x: tr[4], y: tr[5],
        h: Math.abs(tr[3]) || it.height || 10, w: it.width || 0
      });
    }
    if (!toks.length) return [];
    var hs = toks.map(function (t) { return t.h; }).sort(function (a, b) { return a - b; });
    var medH = hs[Math.floor(hs.length / 2)] || 10;
    var tol = Math.max(2, medH * 0.45);
    var ordered = toks.slice().sort(function (a, b) {
      if (Math.abs(a.y - b.y) > tol) return b.y - a.y;
      return a.x - b.x;
    });
    var lines = [], cur = null;
    ordered.forEach(function (t) {
      if (cur && Math.abs(cur.y - t.y) <= tol) cur.toks.push(t);
      else { cur = { y: t.y, toks: [t] }; lines.push(cur); }
    });
    return lines.map(function (ln) {
      ln.toks.sort(function (a, b) { return a.x - b.x; });
      var out = '', prev = null;
      ln.toks.forEach(function (t) {
        if (prev && gapNeedsSpace(prev, t)) out += ' ';
        out += t.text;
        prev = t;
      });
      return out.replace(/[ \t]+/g, ' ').trim();
    }).filter(Boolean);
  }

  function extractWithPdfJs(bytes) {
    return loadPdfJs().then(function (pdfjsLib) {
      return pdfjsLib.getDocument({
        data: bytes.slice(0),
        useSystemFonts: true
        // 不传 cMapUrl：我们自己的抽取器（pdftext.js）已经处理了 CID 字体，
        // 这里只是极少数特殊 PDF 的兜底，没必要再带几百 KB 的 CMap 表。
      }).promise;
    }).then(function (doc) {
      var out = [];
      var chain = Promise.resolve();
      for (var p = 1; p <= doc.numPages; p++) {
        (function (no) {
          chain = chain.then(function () {
            return doc.getPage(no).then(function (page) {
              return page.getTextContent({ includeMarkedContent: false }).then(function (tc) {
                var lines = itemsToLines(tc.items);
                if (doc.numPages > 1) out.push('===== 第 ' + no + ' 页 =====');
                lines.forEach(function (l) { out.push(l); });
              });
            });
          });
        })(p);
      }
      return chain.then(function () {
        var text = out.join('\n');
        return { text: text, pages: doc.numPages, charCount: (text.match(/[\u4e00-\u9fa5A-Za-z]/g) || []).length, via: 'pdfjs' };
      });
    });
  }

  function pdfToText(bytes, onProgress, warnings) {
    return extractWithOwn(bytes).then(function (r) {
      if (r.charCount >= 12) {
        return { text: r.text, pages: r.pages, charCount: r.charCount, via: 'own' };
      }
      // 明确是图片型 PDF → 不必再试 pdf.js（它也不做 OCR），直接给结论
      if (r.imageOnly) {
        return { text: r.text, pages: r.pages, charCount: r.charCount, via: 'own', empty: true, imageOnly: true };
      }
      // 自带抽取器没拿到文字 → 试 pdf.js
      warnings.push('自带抽取器没读到文字，正在改用 pdf.js 重试…');
      return extractWithPdfJs(bytes).then(function (r2) {
        if (r2.charCount >= 12) return r2;
        return { text: r2.text, pages: r2.pages, charCount: r2.charCount, via: 'pdfjs', empty: true };
      });
    }).catch(function (e) {
      warnings.push('自带抽取器出错（' + (e && e.message ? e.message : e) + '），已改用 pdf.js。');
      return extractWithPdfJs(bytes).then(function (r2) {
        return { text: r2.text, pages: r2.pages, charCount: r2.charCount, via: 'pdfjs', empty: r2.charCount < 12 };
      });
    });
  }

  /* ============ 四、表格（xlsx / xls / csv） ============ */

  var _xlsx = null;
  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_xlsx) return _xlsx;
    _xlsx = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = libUrl('xlsx.full.min.js');
      s.onload = function () {
        window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS 加载失败'));
      };
      s.onerror = function () { reject(new Error('SheetJS 加载失败（缺少 lib/xlsx.full.min.js）')); };
      document.head.appendChild(s);
    });
    return _xlsx;
  }

  function workbookToText(bytes) {
    return loadSheetJs().then(function (XLSX) {
      var wb = XLSX.read(bytes, { type: 'array', codepage: 936, cellDates: true });
      var chunks = [];
      wb.SheetNames.forEach(function (name) {
        var ws = wb.Sheets[name];
        if (!ws) return;
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
        var lines = [];
        rows.forEach(function (r) {
          var cells = (r || []).map(function (c) { return String(c == null ? '' : c).replace(/\s+/g, ' ').trim(); });
          while (cells.length && !cells[cells.length - 1]) cells.pop();
          if (cells.length) lines.push(cells.join(' | '));
        });
        if (lines.length) chunks.push(lines.join('\n'));
      });
      return chunks.join('\n');
    });
  }

  /* HTML 伪装成 .xls（教务系统常见） */
  function htmlTableToText(text) {
    var doc;
    try { doc = new DOMParser().parseFromString(text, 'text/html'); } catch (e) { return ''; }
    if (!doc) return '';
    var out = [];
    var tables = doc.querySelectorAll('table');
    for (var t = 0; t < tables.length; t++) {
      var rows = tables[t].querySelectorAll('tr');
      var lines = [];
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll('th,td');
        var vals = [];
        for (var c = 0; c < cells.length; c++) {
          var v = (cells[c].textContent || '').replace(/\s+/g, ' ').trim();
          if (v) vals.push(v);
        }
        if (vals.length) lines.push(vals.join(' | '));
      }
      if (lines.length) out.push(lines.join('\n'));
    }
    if (out.length) return out.join('\n');
    return (doc.body ? doc.body.textContent : '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n');
  }

  /* ============ 五、JSON ============ */

  function jsonToText(obj) {
    var courses = [];
    var identity = { name: '', sid: '' };
    var seen = {};
    function pushCourse(name, credit) {
      name = String(name == null ? '' : name).trim();
      var cr = parseFloat(credit);
      if (!name || !(cr > 0)) return;
      var key = name + '|' + cr;
      if (seen[key]) return;
      seen[key] = 1;
      courses.push({ name: name, credit: cr });
    }
    function walk(node, depth) {
      if (depth > 8 || node == null) return;
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
      if (typeof node !== 'object') return;
      var nameKeys = ['name', 'courseName', 'course_name', 'kcmc', '课程名称', 'title', 'lessonName', 'subject'];
      var creditKeys = ['credit', 'credits', 'xf', '学分', 'creditHour', 'score'];
      var nm = '', cr = '';
      nameKeys.forEach(function (k) { if (!nm && typeof node[k] === 'string') nm = node[k]; });
      creditKeys.forEach(function (k) {
        if (!cr && (typeof node[k] === 'number' || typeof node[k] === 'string')) cr = node[k];
      });
      if (nm && parseFloat(cr) > 0) pushCourse(nm, cr);
      ['studentId', 'sid', 'xh', '学号', 'studentNo', 'number'].forEach(function (k) {
        if (!identity.sid && node[k] != null && /^\d{6,20}$/.test(String(node[k]).trim())) identity.sid = String(node[k]).trim();
      });
      ['studentName', 'student', 'xm', '姓名'].forEach(function (k) {
        if (!identity.name && node[k] != null && /^[\u4e00-\u9fa5·]{2,6}$/.test(String(node[k]).trim())) identity.name = String(node[k]).trim();
      });
      Object.keys(node).forEach(function (k) { walk(node[k], depth + 1); });
    }
    try { walk(obj, 0); } catch (e) { /* ignore */ }
    var lines = [];
    if (identity.sid) lines.push('学号：' + identity.sid);
    if (identity.name) lines.push('姓名：' + identity.name);
    courses.forEach(function (c) { lines.push(c.name + ' | ' + c.credit); });
    return lines.join('\n');
  }

  /* ============ 六、解析（通用解析器 + 课表专用解析器） ============ */

  /* 课程名合理性校验：排除「学院：计算机与控制工程学院 专业：…」这类信息行 */
  var META_WORD = /学院|专业|班级|学号|姓名|打印|教务|校区|教师|教学班|课程名称|开课|学年|学期|备注|说明/;
  function validCourseName(name) {
    var n = String(name || '').trim();
    if (n.length < 2 || n.length > 40) return false;
    if (/[:：\/／|｜]/.test(n)) return false;        // 带冒号/竖线的一律不是课名
    if (META_WORD.test(n)) return false;
    if (/^[\d.]+$/.test(n)) return false;
    if ((n.match(/[\u4e00-\u9fa5A-Za-z]/g) || []).length < 2) return false;
    return true;
  }

  /* 整段文本里如果有「姓名 xxx 学号 xxx」这类行，
     把其中的姓名收集起来 —— 它们绝不该被当成课程。 */
  function collectPersonNames(text) {
    var names = {};
    var re = /(?:姓\s*名|学生)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,4})/g;
    var m;
    while ((m = re.exec(text)) !== null) names[m[1]] = 1;
    return names;
  }

  /* 表格行里的「元数据行」：例如
       姓名,黄宇翔,学号,3231703114,学年,2026-2027,学期,第 1 学期
     它含有多个字段标签，不该被当成课程。 */
  function looksLikeMetaRow(text) {
    var t = String(text || '');
    var hits = 0;
    ['学号', '姓名', '学年', '学期', '专业', '班级', '学院', '开课', '打印时间', '教务'].forEach(function (w) {
      if (t.indexOf(w) >= 0) hits++;
    });
    return hits >= 2;
  }

  function cleanName(name) {
    return String(name || '')
      .replace(/\s+/g, '')
      .replace(/[（(]\s*[SＭM]\s*[）)]$/i, '')
      .trim();
  }

  function toCourses(text) {
    var id = { name: '', sid: '' };
    try { if (window.GuoLeParser) id = window.GuoLeParser.parseIdentity(text); } catch (e) { /* ignore */ }
    // 姓名兜底：有些课表把名字和学号分两行，或用「姓名 xxx」这种写法
    if (!id.name) {
      var m = String(text).match(/(?:姓\s*名)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,4})/);
      if (m) id.name = m[1];
    }

    var general = [];
    try { if (window.GuoLeParser) general = window.GuoLeParser.parseCourseText(text); } catch (e) { /* ignore */ }

    var tt = null;
    if (window.GuoLeTimetable) {
      try { tt = window.GuoLeTimetable.parseTimetable(text); } catch (e) { tt = null; }
    }

    // 判定：网格课表 → 用课表解析结果；否则用通用解析结果
    var useTimetable = !!(tt && tt.grid && tt.courses.length);
    var picked = useTimetable ? tt.courses : general;
    var structure = useTimetable ? 'timetable' : (general.length ? 'table' : 'text');

    var byName = {};
    var list = [];
    var persons = collectPersonNames(text);
    var metaRow = looksLikeMetaRow(text);
    function add(item) {
      var nm = cleanName(item.name);
      if (!validCourseName(nm)) return;
      if (persons[nm]) return;            // 是学生姓名，不是课程
      if (metaRow && /^[\u4e00-\u9fa5]{2,4}$/.test(nm) && !/[\u4e00-\u9fa5]{2,}$/.test(nm.slice(2))) {
        // 元数据行里出现的孤立 2~4 字中文串，多半是人名/字段值
        // 但像「劳动教育」这种真课名也要保留，用常见课程关键词兜底
        if (!/(教育|实践|政策|实习|论文|原理|概论|导论|基础|技术|英语|数学|物理|化学|设计|管理|课程|体育|思想|道德|法治|史纲|劳动)/.test(nm)) return;
      }
      if (byName[nm]) {
        var ex = byName[nm];
        if (!ex.credit && item.credit) ex.credit = item.credit;
        if (!ex.teacher && item.teacher) ex.teacher = item.teacher;
        if (!ex.weeks && item.weeks) ex.weeks = item.weeks;
        return;
      }
      var rec = {
        name: nm,
        credit: parseFloat(item.credit) || 0,
        teacher: item.teacher || '',
        weeks: item.weeks || '',
        source: item.source || '导入'
      };
      byName[nm] = rec;
      list.push(rec);
    }

    picked.forEach(function (c) {
      add({ name: c.name, credit: c.credit, teacher: c.teacher, weeks: c.weeks, source: c.source });
    });
    // 另一路结果里如果有学分，补上（课表网格通常没有学分）
    if (useTimetable) {
      general.forEach(function (g) {
        var nm = cleanName(g.name);
        if (byName[nm] && !byName[nm].credit) byName[nm].credit = g.credit;
      });
    }

    var hasCredit = list.some(function (c) { return c.credit > 0; });
    return {
      identity: id,
      courses: list,
      structure: structure,
      hasCredit: hasCredit,
      generalCount: general.length
    };
  }

  /* ============ 七、主入口 ============ */

  function readFile(file, onProgress) {
    var warnings = [];
    return new Promise(function (resolve) {
      if (!file) {
        resolve({ ok: false, error: '没有选择文件' });
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        resolve({ ok: false, error: '文件读取失败，可能是文件损坏或没有权限。' });
      };
      reader.onload = function () {
        var bytes = new Uint8Array(reader.result);
        var kind = sniff(bytes, file.name);

        var finish = function (text, format, extra) {
          text = String(text || '');
          var parsed = toCourses(text);
          var rep = {
            ok: !!(parsed.courses.length || parsed.identity.name || parsed.identity.sid),
            format: format,
            fileName: file.name,
            text: text,
            identity: parsed.identity,
            courses: parsed.courses,
            structure: parsed.structure,
            hasCredit: parsed.hasCredit,
            warnings: warnings
          };
          if (extra) Object.keys(extra).forEach(function (k) { rep[k] = extra[k]; });
          resolve(rep);
        };

        if (kind === 'pdf') {
          pdfToText(bytes, onProgress, warnings).then(function (r) {
            if (r.empty || r.charCount < 12) {
              resolve({
                ok: false,
                format: 'pdf',
                fileName: file.name,
                text: r.text || '',
                emptyPdf: true,
                imageOnly: !!r.imageOnly,
                error: r.imageOnly
                  ? '这个 PDF 是一张「图片」（扫描件 / 截图另存），里面没有可复制的文字。' +
                    '请改用教务系统的「导出 Excel」按钮；或者先在手机上对课表截图，再用相册的长按取字复制，最后粘贴到本页面。'
                  : '这个 PDF 里没有读到任何课程文字。请确认导出的是「选课信息 / 课表」页面；' +
                    '也可以改用「导出 Excel」，或直接复制页面文字粘贴进来。'
              });
              return;
            }
            if (r.pages > 1) warnings.push('这是一份 ' + r.pages + ' 页的 PDF，已全部读取。');
            finish(r.text, 'pdf', { via: r.via, pages: r.pages });
          }).catch(function (e) {
            resolve({
              ok: false, format: 'pdf', fileName: file.name,
              error: 'PDF 解析失败：' + (e && e.message ? e.message : e)
            });
          });
          return;
        }

        if (kind === 'zip' || kind === 'cfb') {
          workbookToText(bytes).then(function (text) {
            if (!text.trim()) {
              resolve({ ok: false, format: 'excel', fileName: file.name, error: '表格是空的，或者里面没有文字内容。' });
              return;
            }
            finish(text, 'excel');
          }).catch(function (e) {
            resolve({ ok: false, format: 'excel', fileName: file.name, error: '表格解析失败：' + (e && e.message ? e.message : e) });
          });
          return;
        }

        var text = decodeSmart(bytes);

        if (kind === 'html' || /<table[\s>]/i.test(text.slice(0, 4000))) {
          var fromHtml = htmlTableToText(text);
          if (fromHtml.trim()) { finish(fromHtml, 'html'); return; }
        }

        if (kind === 'json' || /^\s*[\{\[]/.test(text)) {
          try {
            finish(jsonToText(JSON.parse(text)), 'json');
            return;
          } catch (e) { /* 不是合法 JSON，当纯文本处理 */ }
        }

        finish(text, 'text');
      };
      reader.readAsArrayBuffer(file);
    });
  }

  window.GuoLeImport = {
    readFile: readFile,
    toCourses: toCourses,
    _sniff: sniff,
    _decodeSmart: decodeSmart,
    _htmlTableToText: htmlTableToText,
    _jsonToText: jsonToText,
    _itemsToLines: itemsToLines
  };
})();
