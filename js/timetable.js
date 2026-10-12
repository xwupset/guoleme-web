/* 过了么 · 课表文本解析（在既有 parser.js 之上做事后汇总）
   ---------------------------------------------------------------
   解决 parser.js 处理不了的一类真实输入：教务系统导出的
   「周课表网格」（列=星期一~日，行=第 1~12 节）。

   这类文本长这样：
     时间段节次星期一星期二星期三星期四星期五星期六星期日
     1 创业与创新实践（S）创业与创新实践（S）创业与创新实践（S）
     (1-2节)1-5周,7-9周/校区:校本部/场地:新华都A202/教师:陈修齐/教学班:...
     ...
     实践课程：毕业实习（S）孙淑晓(共2周)/17-18周; 毕业论文（设计）（S）孙淑晓(共6周)/11-16周;
     其他课程：形势与政策 7 林诺诚(共11周)/6-16周/无; 劳动教育 邹瑞萍(共16周)/1-16周/无;

   做的事：
     1) 去掉行首的「节次数字」和行尾的「星期/上午下午晚上/时间段」噪音；
     2) 合并被空格或换行切碎的课程名；
     3) 按名字去重（同一门课在网格里出现多次）；
     4) 底部「实践课程 / 其他课程」用分号拆开，单独识别；
     5) 尽量补上教师、周次；学分缺失时如实标注 source。
*/
(function () {
  'use strict';

  var DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日', '星期天'];
  var PERIOD_NOISE = /^(上午|下午|晚上|凌晨|时间段节次|时间段|节次)$/;

  /* 中文常见姓氏（含复姓首字）。用于判断「这 2~4 个字像不像人名」。 */
  var SURNAME = /^[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊甄封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭历戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公]/;

  /* 常见的「课程名结尾」字/词。用于判断切分点是否落在课名内部。 */
  var SUFFIX_END = /(教育|设计|实践|实习|管理|原理|概论|导论|基础|技术|科学|英语|数学|物理|化学|写作|听说|研究|实训|论文|政策|思想|道德|法治|史纲|体育|课程|实验|训练|分析|统计|力学|程序|结构|系统|工程|经济|会计|法律|营销|商务|策划|修养|军事|心理|健康|美育|劳动)$/;

  function stripNoise(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    // 行首节次：1 / 2 / … / 12 （后面可能紧跟课程名）
    t = t.replace(/^(\d{1,2})\s+(?=[^\d\s])/, '');
    t = t.replace(/^(上午|下午|晚上|凌晨)\s*/, '');
    // 行尾的排课说明括注，保留在 meta 里更有用，这里先不动
    DAYS.forEach(function (d) { t = t.split(d).join(' '); });
    return t.replace(/\s+/g, ' ').trim();
  }

  /* 课程名候选：中文/字母开头，含至少 2 个中文或字母，长度合理 */
  var NOISE_PAT = /课表|打印|时间段|节次|校区|场地|教学班|组成|星期|^[\u4e00-\u9fa5]{2,}\d+班$/;
  function isNameLike(s) {
    if (!s) return false;
    var t = s.trim();
    if (t.length < 2 || t.length > 40) return false;
    if (!/^[\u4e00-\u9fa5A-Za-z*]/.test(t)) return false;
    if (/^[\d.]+$/.test(t)) return false;
    if (/^(第|共|讲课|实验|实训|实践|其他|其它)/.test(t)) return false;
    if (NOISE_PAT.test(t)) return false;
    if (/\d{6,}/.test(t)) return false;                        // 学号
    if (/\d{1,2}节|[，,]?\s*\d{1,2}\s*-\s*\d{1,2}\s*周/.test(t)) return false;
    if (/[\/／:：（）()]/.test(t)) return false;                 // 含标点的都不是纯课名
    if (/^工商管理|^[\u4e00-\u9fa5]{2,}\d?班$/.test(t)) return false;   // 班级名
    if ((t.match(/[\u4e00-\u9fa5]/g) || []).length < 2) return false;
    return true;
  }

  /* 从一段排课说明里抽 教师 / 周次 */
  function parseMeta(s) {
    var meta = { teacher: '', weeks: '', room: '', cls: '' };
    if (!s) return meta;
    var t = s.replace(/\s+/g, ' ');
    var tc = t.match(/教师\s*[:：]\s*([\u4e00-\u9fa5·]{2,4})/);
    if (tc) meta.teacher = tc[1];
    var wk = t.match(/(\d{1,2}\s*-\s*\d{1,2}\s*周(?:[,，]\s*\d{1,2}\s*-\s*\d{1,2}\s*周)*)/);
    if (wk) meta.weeks = wk[1].replace(/\s+/g, '');
    var rm = t.match(/场地\s*[:：]\s*([A-Za-z0-9\u4e00-\u9fa5]{1,20})/);
    if (rm) meta.room = rm[1];
    return meta;
  }

  /* 底部「实践课程：… ; … ;」与「其他课程：… ; … ;」 */
  function parseTailLists(text) {
    var found = [];
    var re = /(实践课程|其它课程|其他课程)\s*[:：]\s*([^\n]*)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var body = m[2];
      body.split(/[;；]/).forEach(function (chunk) {
        var piece = chunk.trim();
        if (!piece) return;
        // 形如：毕业实习（S）孙淑晓(共2周)/17-18周
        //      形势与政策 7林诺诚(共11周)/6-16周/无
        //      劳动教育邹瑞萍(共16周)/1-16周/无   ← 括号可有可无
        //      毕业论文（设计）（S）孙淑晓(共6周)/11-16周
        //
        // 不能用「正则回退」找教师：对「劳动教育邹瑞萍」它会从「育」开始匹配，
        // 把「育邹瑞萍」当成教师，把课程名切成「劳动教」。
        // 改为：先定位「共N周」，再【从长到短】枚举前面的中文段作为教师，
        //       取第一个让「课程名」也合法的切法。
        var wkAnchor = piece.search(/[（(]?\s*共\s*\d+\s*周/);
        var name = piece, rest = '', teacher = '', weeks = '';
        if (wkAnchor > 0) {
          weeks = (piece.slice(wkAnchor).match(/共\s*(\d+)\s*周/) || []);
          weeks = weeks[1] ? ('共' + weeks[1] + '周') : '';
          // 教师名紧贴在「(共N周」左边。用【打分制】而不是试长度：
          //   「劳动教育邹瑞萍」→ 切在 4 字（课名=劳动教, 教师=育邹瑞萍）与
          //                       切在 3 字（课名=劳动教育, 教师=邹瑞萍）都合法，
          //   但「教育」是极常见的课名结尾，而「育」做姓氏极罕见 → 3 字胜出。
          var head = piece.slice(0, wkAnchor).replace(/\s+$/, '');
          var best = null;
          for (var len = 2; len <= 4; len++) {
            if (head.length <= len) continue;
            var t = head.slice(head.length - len);
            var n = head.slice(0, head.length - len).replace(/\s+$/, '');
            if (!/^[\u4e00-\u9fa5·]+$/.test(t)) continue;
            if ((n.match(/[\u4e00-\u9fa5]/g) || []).length < 2) continue;

            var score = 0;
            // 课名结尾是典型的课程名后缀 → 加分
            if (SUFFIX_END.test(n)) score += 10;
            // 教师名以常见姓氏开头 → 加分
            if (SURNAME.test(t.charAt(0))) score += 8;
            if (t.length === 3) score += 2;          // 三字名最常见
            // 课名以常见姓氏字结尾且教师首字不像姓氏 → 减分
            if (SURNAME.test(n.charAt(n.length - 1)) && !SURNAME.test(t.charAt(0))) score -= 6;

            if (!best || score > best.score) best = { name: n, teacher: t, score: score };
          }
          if (best) {
            name = best.name;
            teacher = best.teacher;
            rest = piece.slice(wkAnchor);
          }
        } else {
          var cut = piece.search(/[\u4e00-\u9fa5·]{2,4}\s*[（(]\s*共\s*\d+\s*周/);
          name = cut > 0 ? piece.slice(0, cut) : piece;
          rest = cut > 0 ? piece.slice(cut) : '';
        }

        name = name.trim();
        // 去掉「（S）」这类纯标记，但保留「（设计）」这种真名字的一部分
        name = name.replace(/[（(]\s*[SＭM]?\s*[）)]\s*$/i, '').trim();
        // 末尾如果挂着孤立的学年数字（如「形势与政策 7」），拆出来另存
        var yearNo = '';
        var ym = name.match(/^(.*?)[\s]+(\d{1,2})$/);
        if (ym && (ym[1].match(/[\u4e00-\u9fa5]/g) || []).length >= 2) {
          name = ym[1].trim();
          yearNo = ym[2];
        }
        if (!name) return;

        var meta = parseMeta(piece);
        if (teacher) meta.teacher = teacher;
        if (weeks) meta.weeks = weeks;
        var wk = rest.match(/(\d{1,2}\s*-\s*\d{1,2}\s*周)/);
        if (wk) meta.weeks = meta.weeks ? (meta.weeks + '/' + wk[1].replace(/\s+/g, '')) : wk[1].replace(/\s+/g, '');
        meta.yearNo = yearNo;

        if (!/[\u4e00-\u9fa5]/.test(name)) return;
        found.push({ name: name.replace(/\s+/g, ' ').trim(), meta: meta, from: m[1] });
      });
    }
    return found;
  }

  /* 从网格正文里抽课程名（去掉噪音、去重） */
  function parseGrid(text, skipNames) {
    var skip = {};
    (skipNames || []).forEach(function (n) { skip[n] = 1; });
    var out = [];
    var seen = {};

    text.split('\n').forEach(function (line) {
      var t = stripNoise(line);
      if (!t) return;
      if (PERIOD_NOISE.test(t)) return;
      if (/^(时间段|节次|实践课程|其它课程|其他课程|打印时间|讲课|实验|实训|实践)/.test(t)) return;
      // 排课说明行整行跳过
      if (/\(\d{1,2}\s*-\s*\d{1,2}\s*节\)|校区\s*[:：]|教学班\s*[:：]/.test(t)) return;
      // 纯节次行（1 / 2 / … / 12）
      if (/^\d{1,2}$/.test(t)) return;

      // 一行里可能并排多门同名课：在「（…）」之后断开
      var parts = t.split(/(?<=）)\s*(?=[\u4e00-\u9fa5A-Za-z*])/);
      parts.forEach(function (p) {
        var cand = p.replace(/[*＊]/g, '').trim();
        // 只去掉「（S）」这种纯标记，保留「（设计）」
        cand = cand.replace(/[（(]\s*[SＭM]?\s*[）)]\s*$/i, '').trim();
        if (!isNameLike(cand)) return;
        if (seen[cand]) return;
        seen[cand] = 1;
        if (skip[cand]) return;
        out.push(cand);
      });
    });
    return out;
  }

  /* 判断这段文本是不是「周课表网格」 */
  function looksLikeTimetableGrid(text) {
    var t = String(text || '');
    var dayHits = DAYS.filter(function (d) { return t.indexOf(d) >= 0; }).length;
    var hasPeriod = /时间段|节次/.test(t);
    var hasGrid = /\d{1,2}\s*-\s*\d{1,2}\s*节/.test(t);
    return (dayHits >= 3 && hasGrid) || (hasPeriod && hasGrid && dayHits >= 2);
  }

  /* 主入口：返回 {courses:[{name,credit,teacher,weeks,source}], grid:bool, hasCredit:bool} */
  function parseTimetable(text) {
    var raw = String(text || '');
    var grid = looksLikeTimetableGrid(raw);

    var tail = parseTailLists(raw);
    var tailNames = tail.map(function (x) { return x.name; });
    var gridNames = parseGrid(raw, tailNames);

    var courses = [];
    var seen = {};

    function add(name, meta, source, credit) {
      var key = name + '|' + (credit || '');
      if (seen[name]) {
        // 已有同名课程：补充缺失的教师/周次
        var ex = seen[name];
        if (!ex.teacher && meta && meta.teacher) ex.teacher = meta.teacher;
        if (!ex.weeks && meta && meta.weeks) ex.weeks = meta.weeks;
        return;
      }
      var item = {
        name: name,
        credit: credit || 0,
        teacher: (meta && meta.teacher) || '',
        weeks: (meta && meta.weeks) || '',
        source: source
      };
      seen[name] = item;
      courses.push(item);
    }

    tail.forEach(function (x) { add(x.name, x.meta, x.from); });
    gridNames.forEach(function (n) { add(n, null, '课表'); });

    // 学分是否可得：文本里若出现成列的学分数字，这里无法可靠判断，
    // 交给上层（导入引擎）另行解析；此处只报告网格事实。
    return {
      courses: courses,
      grid: grid,
      hasCredit: false,
      tailCount: tail.length,
      gridCount: gridNames.length
    };
  }

  window.GuoLeTimetable = {
    parseTimetable: parseTimetable,
    looksLikeTimetableGrid: looksLikeTimetableGrid,
    parseTailLists: parseTailLists,
    parseGrid: parseGrid
  };
})();
