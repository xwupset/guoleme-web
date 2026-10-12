/* 课表/成绩粘贴文本解析：
   1) 解码 HTML 实体与 markdown 加粗/斜体残留；
   2) 格式A：同一行里“课程名 + 学分”；
   3) 格式B：网页课表复制文本（课程名独占一行，学分在该课程块末尾单独一行，
      中间夹杂节次/地点/教师/学时等行）。
*/
(function () {
  'use strict';

  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  /* 去掉网页复制残留：**、*、\*、反引号、零宽字符，并把各种空白统一为普通空格 */
  function normalizeText(s) {
    s = decodeEntities(s);
    s = s.replace(/\u200b|\ufeff|\u00a0|\u3000/g, ' ');
    s = s.replace(/\\\*/g, '');
    s = s.replace(/\*\*/g, '');
    s = s.replace(/\*/g, '');
    s = s.replace(/`/g, '');
    s = s.replace(/\|/g, '\t');
    return s;
  }

  function trimPunct(s) {
    return String(s)
      .replace(/^[\s|｜>#\-—:：.。、]+/, '')
      .replace(/[\s|｜<#\-—:：.。、;；,，]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeCreditToken(t) {
    if (!/^\d+(\.\d+)?$/.test(t)) return false;
    const v = parseFloat(t);
    return v >= 0.1 && v <= 20;
  }

  /* 表头 / 噪音行关键词：以这些开头的行绝不会是课程名 */
  const HEAD_NOISE = [
    '时间段', '节次', '上午', '下午', '晚上', '凌晨',
    '学年', '学期', '星期', '时间', '日期',
    '注', '说明', '学号', '姓名', '工号', '班级', '专业',
    '课表', '教务', '系统', '教师', '课程名称', '课程名',
    '考试安排', '成绩', '绩点', '实践课程', '其它课程', '其他课程',
    '讲课', '实训', '考查', '考试', '必修', '选修',
    '周次', '教室', '校区', '校本部', '地点', '备注',
    '红色斜体', '待筛选', '已选上', '第', '打印', '导出'
  ];

  function cjkCount(s) {
    const m = s.match(/[\u4e00-\u9fa5]/g);
    return m ? m.length : 0;
  }

  function isCourseNameCandidate(s) {
    if (!s || s.length < 2 || s.length > 60) return false;
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(s)) return false;      // 至少含中文/字母
    if (/^\d{1,2}:\d{2}/.test(s)) return false;              // 时间
    if (/^\(/.test(s)) return false;                          // (1-2节) / 课程代码
    if (/\d{1,2}节/.test(s)) return false;                    // 第1-2节这类
    if (/星期[一二三四五六日天]/.test(s)) return false;
    if (/级.*班/.test(s)) return false;                       // 2023级工商管理1班
    if (/^\d+(\.\d+)?$/.test(s)) return false;                // 纯数字行（4/32/2.0）
    if (/^(校本部|教学楼|实验楼|图书馆|体育馆|田径场|机房|新华都)/.test(s)) return false;
    if (/^[A-Za-z]{1,4}\d{2,}$/.test(s)) return false;        // A202 这类教室号
    if (/(讲课|实训|考查|考试|必修|选修|周学时|总学时|课表|教务系统|版本V)/.test(s)) return false;
    for (let i = 0; i < HEAD_NOISE.length; i++) {
      if (s.indexOf(HEAD_NOISE[i]) === 0) return false;
    }
    return true;
  }

  /* 从一行里挑出“最像课程名”的片段：
     整行优先；若整行混了 节次/表头 等前缀，则看空格切出来的词。
     一行包含多门课（分号分隔）或纯表格汇总行时直接放弃，避免错误配对。 */
  function bestNameCandidate(line) {
    const s = trimPunct(line);
    if (!s) return null;
    if (/^(实践课程|其它课程|其他课程|考试安排|成绩|注[:：])/.test(s)) return null;
    if (/;|；/.test(s)) return null;                          // 一行多门课，无法可靠配对学分
    if (isCourseNameCandidate(s)) return s;

    const tokens = s.split(/\s+/);
    const cands = [];
    tokens.forEach(function (t) {
      if (isCourseNameCandidate(t)) cands.push(t);
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) {
      const ca = cjkCount(a);
      const cb = cjkCount(b);
      if (cb !== ca) return cb - ca;                          // 中文多的优先
      return b.length - a.length;                             // 其次更长的
    });
    return cands[0];
  }

  /* 格式A：单行内 “课程名 [分隔] 学分 [其它]” */
  function parseInlineLine(cleanLine) {
    const labelMatch = cleanLine.match(/(学分|学分数)[:：]?\s*(\d+(?:\.\d+)?)/);
    if (labelMatch) {
      const credit = parseFloat(labelMatch[2]);
      if (credit >= 0.1 && credit <= 20) {
        const before = trimPunct(cleanLine.split(labelMatch[0])[0]);
        if (before.length >= 2 && before.length <= 60 && isCourseNameCandidate(before)) {
          return { name: before, credit: credit };
        }
      }
    }

    // 按任意空白切分：教务表格导出后常常只剩单个空格（尤其 PDF 抽取出来的文本）
    const parts = cleanLine.split(/\t|\s+/);
    const cells = [];
    parts.forEach(function (p) { const t = p.trim(); if (t) cells.push(t); });
    if (!cells.length) return null;

    /* 找「像学分」的格子。
       教务导出的表格里同一行常出现「形势与政策 7 0.25 思政类 考试 必修 …」，
       如果简单地从右往左取第一个 0.1~20 的数，会取到「7」而不是真正的学分 0.25。
       策略：
         1) 「N 学分」这种明确标注，优先级最高；
         2) 带小数点的（学分绝大多数是 0.25/2.5/3.5）；
         3) 都没有才退化为最后一个 0.1~20 的整数。 */
    const marked = [];
    const plain = [];
    for (let i = 0; i < cells.length; i++) {
      const m = cells[i].match(/^(\d+(?:\.\d+)?)\s*学分$/);
      if (m) { marked.push({ i: i, v: parseFloat(m[1]), len: 1 }); continue; }
      if (looksLikeCreditToken(cells[i])) plain.push({ i: i, v: parseFloat(cells[i]), dec: /\./.test(cells[i]) });
      // 「5 学分」被空格拆成两个格子时的情形
      if (i + 1 < cells.length && cells[i + 1] === '学分' && looksLikeCreditToken(cells[i])) {
        marked.push({ i: i, v: parseFloat(cells[i]), len: 2 });
      }
    }

    const STOP = /^(学分|考试|考查|必修|选修|限选|任选|公选|专业课|公共课|理论|实践|讲课|实训|实验|\d+)$/;
    const isMeta = function (t) {
      return STOP.test(t) || /^[（(][^）)]*[）)]$/.test(t);
    };

    if (marked.length) {
      const mk = marked[0];
      // 学分在前：课程名 = 学分之后、遇到「（类别）/必修/考试」之前的所有格子拼起来
      const tail = cells.slice(mk.i + mk.len);
      const buf = [];
      for (let j = 0; j < tail.length; j++) {
        if (isMeta(tail[j])) break;
        buf.push(tail[j]);
      }
      let nm = buf.join('').replace(/\s+/g, '');
      if (nm.length >= 2 && isCourseNameCandidate(nm)) return { name: nm, credit: mk.v };

      // 学分在后：课程名 = 学分之前的所有格子
      const head = cells.slice(0, mk.i).filter(function (t) { return !isMeta(t); });
      nm = head.join(' ').trim();
      const pickedName = bestNameCandidate(nm);
      if (pickedName) return { name: pickedName, credit: mk.v };
      return null;
    }

    const cands = plain;
    if (!cands.length) return null;
    const decs = cands.filter(function (c) { return c.dec; });
    const picked = decs.length ? decs[decs.length - 1] : cands[cands.length - 1];
    const creditIdx = picked.i;
    const credit = picked.v;

    // 学分前面那些格子拼起来就是课程名（末尾的类别/考核列表头会被 bestNameCandidate 剔掉）
    const nameRaw = cells.slice(0, creditIdx).join(' ');
    const name = bestNameCandidate(nameRaw);
    if (!name) return null;
    return { name: name, credit: credit };
  }

  /* 收集一行里所有“看起来像学分”的数字（保留顺序） */
  function creditCandidatesOnLine(s) {
    const out = [];
    const re = /(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const v = parseFloat(m[1]);
      if (v >= 0.1 && v <= 20) out.push(v);
    }
    return out;
  }

  /* 格式B：课程名独占一行（或混在节次前缀后），学分在该课程块靠后的位置。
     课程块 = 课程名 + 时间/地点/教师等若干行 + 末尾数字行（如 4 / 32 / 2.0，2.0 即学分）。 */
  function parseBlockFormat(lines, stopIdxSet) {
    // 先找所有“疑似课程名”行
    const raw = new Map(); // idx -> name
    lines.forEach(function (s, i) {
      if (stopIdxSet && stopIdxSet.has(i)) return;            // 已被格式A处理的行
      const n = bestNameCandidate(s);
      if (n) raw.set(i, n);
    });

    // 只保留真正的“课程块起点”：后面 2~6 行内有 (1-2节)…周 时间行；
    // 或至少带括号（不同布局兜底）。纯中文短名（像教师）且无时间行/括号则排除。
    const entries = Array.from(raw).map(function (kv) { return { i: kv[0], name: kv[1] }; });
    const rawSet = new Set(entries.map(function (e) { return e.i; }));

    function hasTimeNear(i) {
      for (let j = i + 1; j <= Math.min(i + 6, lines.length - 1); j++) {
        if (rawSet.has(j)) return false;                       // 下一个疑似课程名先到了
        if (/节|周|星期/.test(lines[j])) return true;
      }
      return false;
    }

    const blockStarts = entries.filter(function (e) {
      const timeNear = hasTimeNear(e.i);
      const pureShortCn = /^[\u4e00-\u9fa5]{2,4}$/.test(e.name) &&
        e.name.indexOf('（') < 0 && e.name.indexOf('(') < 0;
      if (timeNear) return true;
      return !pureShortCn && /[（(]/.test(e.name);
    });
    const bsSet = new Set(blockStarts.map(function (b) { return b.i; }));

    const candidates = [];
    blockStarts.forEach(function (b) {
      let lastCredit = null;
      for (let j = b.i + 1; j < Math.min(b.i + 45, lines.length); j++) {
        if (bsSet.has(j)) break;                               // 下一门课开始
        if (stopIdxSet && stopIdxSet.has(j)) break;
        if (/^(实践课程|其它课程|其他课程|考试安排|成绩|注[:：]|学号[:：])/.test(lines[j])) break;
        const nums = creditCandidatesOnLine(lines[j]);
        if (nums.length) {
          // 一行内若多个数，优先小数（2.0），否则取最后一个
          const dec = nums.filter(function (n) { return n % 1 !== 0; });
          lastCredit = dec.length ? dec[dec.length - 1] : nums[nums.length - 1];
        }
      }
      if (lastCredit != null) {
        candidates.push({ name: b.name, credit: lastCredit, source: '粘贴解析', rawLine: b.name });
      }
    });
    return candidates;
  }

  /* 格式C：教务“选课信息”表格（一行一门课；学分是行内数字单元格） */
  const ROW_NOISE = /学院|大学|学校|课程类别|类别|其他|通识|必修|选修|专业|年级|班级|教师|老师|上课时间|上课地点|教室|校区|学期|学年|教学班|备注|序号|学分|考查|考试/;
  function parseRowsFormat(lines) {
    const out = [];
    lines.forEach(function (line, lineIdx) {
      if (line.indexOf('\t') < 0) return;
      const cells = line.split('\t').map(function (c) {
        return String(c).replace(/\u00a0/g, ' ').replace(/\*/g, '').trim();
      });
      const nonEmpty = cells.filter(function (c) { return c; });
      if (nonEmpty.length < 4) return;
      let creditIdx = -1;
      let credit = 0;
      for (let i = cells.length - 1; i >= 0; i--) {
        if (!/^\d+(\.\d+)?$/.test(cells[i])) continue;
        const v = parseFloat(cells[i]);
        if (v >= 0.1 && v <= 20) { creditIdx = i; credit = v; break; }
      }
      if (creditIdx < 3) return;
      let name = '';
      for (let i = 0; i < creditIdx; i++) {
        const t = cells[i];
        if (!t || t.length < 2) continue;
        if (!/[\u4e00-\u9fa5A-Za-z]/.test(t)) continue;
        if (ROW_NOISE.test(t)) continue;
        name = t;
        break;
      }
      if (!name) return;
      out.push({ name: name, credit: credit, source: '粘贴解析', rawLine: nonEmpty.join(' | ').slice(0, 120), _line: lineIdx });
    });
    return out;
  }

  /* 从整段文本识别 姓名 / 学号（支持“学号：xxx”同行，也支持标签与值分两行） */
  function parseIdentity(text) {
    const t = normalizeText(text);
    let sid = (t.match(/(?:学\s*号)\s*[:：]?\s*(\d{6,20})/) || [])[1] || '';
    // 姓名优先用「非贪婪 + 遇到下一个标签就停」的方式，避免把「学号」粘进姓名
    let name = '';
    let nm = t.match(/(?:姓\s*名)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,4}?)(?=\s|学\s*号|班\s*级|专\s*业|学\s*院|$|[\d:：,，。;；])/);
    if (nm) name = nm[1];
    if (!name) {
      nm = t.match(/(?:姓\s*名)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,4})/);
      if (nm) name = nm[1];
    }
    // 课表 PDF 的常见形态：标题「黄宇翔课表」，正文里另有「学号：…」
    if (!name) {
      nm = t.match(/([\u4e00-\u9fa5·]{2,4})\s*课\s*表/);
      if (nm) name = nm[1];
    }
    if (!name) {
      // 「学号：3231703114」前面的那一段若是纯中文人名的长度，也认下来
      nm = t.match(/([\u4e00-\u9fa5·]{2,4})\s*(?=[\s\S]{0,40}学\s*号)/);
      if (nm && !/学院|专业|班级|课程|学生|学期|学年|时间/.test(nm[1])) name = nm[1];
    }
    if (!sid || !name) {
      const lines = t.split('\n').map(function (x) { return x.trim(); });
      for (let i = 0; i < lines.length; i++) {
        const label = lines[i].replace(/[\s:：*]/g, '');
        if (!sid && label === '学号') {
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const v = lines[j].replace(/[^\d]/g, '');
            if (v.length >= 6) { sid = v; break; }
          }
        }
        if (!name && label === '姓名') {
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const v = lines[j].trim();
            if (/^[\u4e00-\u9fa5·]{2,6}$/.test(v)) { name = v; break; }
          }
        }
      }
    }
    return { name: name, sid: sid };
  }

  function parseCourseText(text) {
    const normalized = normalizeText(text);
    const rawLines = normalized.replace(/\r/g, '').split('\n');

    // 清洗：去空行 / 纯符号行（markdown 表格分隔线）
    const lines = [];
    rawLines.forEach(function (l) {
      let t = l.trim();
      if (!t) return;
      if (/^[-:：|｜\s]+$/.test(t)) return;
      /* CSV / 导出的表格常用逗号或分号分隔。
         如果这一行逗号够多、且看不太像正常的课程描述，就把分隔符换成 tab，
         让后面的分列逻辑能正确切分。 */
      const commas = (t.match(/[,，]/g) || []).length;
      const semis = (t.match(/[;；]/g) || []).length;
      if (commas >= 2 && !/[（(]\s*\d/.test(t)) {
        t = t.replace(/[,，]/g, '\t');
      } else if (semis >= 2) {
        t = t.replace(/[;；]/g, '\t');
      }
      lines.push(t);
    });

    const seen = new Set();
    const out = [];
    function push(r) {
      if (!r || !r.name || !r.credit) return;
      const key = r.name + '|' + r.credit;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name: r.name, credit: r.credit, source: r.source || '粘贴解析', rawLine: r.rawLine || '' });
    }

    // 格式C：选课信息表格（最高优先级，命中行不再交给其它格式）
    const consumed = new Set();
    parseRowsFormat(lines).forEach(function (r) {
      consumed.add(r._line);
      push(r);
    });

    // 格式A：同行解析（命中过的行不再交给格式B，避免同一行被重复算）
    lines.forEach(function (l, i) {
      if (consumed.has(i)) return;
      const r = parseInlineLine(l);
      if (r) { consumed.add(i); push(r); }
    });

    // 格式B：块解析（自动去重）
    parseBlockFormat(lines, consumed).forEach(function (r) {
      push(r);
    });

    return out.slice(0, 80);
  }

  window.GuoLeParser = {
    parseCourseText: parseCourseText,
    parseIdentity: parseIdentity,
    parseRowsFormat: parseRowsFormat,
    parseInlineLine: parseInlineLine,
    parseBlockFormat: parseBlockFormat,
    bestNameCandidate: bestNameCandidate,
    isCourseNameCandidate: isCourseNameCandidate
  };
})();
