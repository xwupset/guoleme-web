(function () {
  'use strict';

  const S = GuoLe.state;
  const CFG = GuoLe.CONFIG;

  /* ---------- 基础工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function toast(msg, kind) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2400);
    setTimeout(() => el.remove(), 2800);
  }

  function openModal(title, bodyHtml, footHtml) {
    $('#modal-root').innerHTML =
      '<div class="modal-mask" id="modal-mask">' +
      '<div class="modal">' +
      '<div class="modal-head"><h3>' + title + '</h3><button class="modal-close" data-close>✕</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '') +
      '</div></div>';
    const mask = $('#modal-mask');
    mask.addEventListener('click', function (e) {
      if (e.target === mask || e.target.closest('[data-close]')) closeModal();
    });
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
  }

  function go(route) {
    if (('#' + route) === location.hash) { render(); return; }
    location.hash = route;
  }

  function copyText(text) {
    const okFn = function () { toast('已复制到剪贴板', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(okFn).catch(function () { legacyCopy(text, okFn); });
    } else { legacyCopy(text, okFn); }
  }
  function legacyCopy(text, okFn) {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.top = '-1000px';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); okFn(); }
    catch (e) { toast('复制失败，请手动选择文本后复制', 'err'); }
    t.remove();
  }

  function fmtCredit(n) {
    return parseFloat((+n || 0).toFixed(2));
  }

  function sanitizeCart() {
    const ids = new Set(S.courses.map(function (c) { return c.id; }));
    S.cart.courseIds = S.cart.courseIds.filter(function (id) { return ids.has(id); });
    if (S.membership.active) S.cart.wantsMember = false;
  }

  function setCourses(courses) {
    S.courses = courses.map(function (c, i) {
      return {
        id: c.id || GuoLe.newCourseId(),
        name: String(c.name || '').trim(),
        credit: parseFloat(c.credit) || 0,
        category: c.category || '',
        source: c.source || '手动添加'
      };
    }).filter(function (c) { return c.name && c.credit > 0; });
    S.cart.courseIds = [];
    sanitizeCart();
    GuoLe.save();
  }

  function updateCartBadge() {
    const n = S.cart.courseIds.length;
    const badge = $('#nav-cart-count');
    if (n > 0) { badge.textContent = n; badge.style.display = ''; }
    else badge.style.display = 'none';
  }

  /* ---------- 页面模板 ---------- */
  function courseCardHtml(c) {
    const pr = GuoLe.coursePricing(c);
    const inCart = S.cart.courseIds.includes(c.id);
    return (
      '<div class="card course-card">' +
      '<div class="cc-head">' +
      '<label class="switch"><input type="checkbox" data-add-course="' + c.id + '"' + (inCart ? ' checked' : '') + '><span class="slider"></span></label>' +
      '<div style="flex:1">' +
      '<h4>' + GuoLe.esc(c.name) + '</h4>' +
      '<div class="cc-sub">' + GuoLe.esc(c.category || '未分类') + ' · ' + fmtCredit(c.credit) + ' 学分 · 来源：' + GuoLe.esc(c.source || '手动') + '</div>' +
      '</div></div>' +
      '<div class="cc-sub">🧐 ' + GuoLe.esc(pr.diff.tag) + '：' + GuoLe.esc(pr.diff.reason) + '</div>' +
      '<div class="price-line">' +
      '<div><span class="price">' + GuoLe.money(pr.subtotal) + '</span> <span class="unit">（' + pr.unit + ' 元/学分 × ' + fmtCredit(c.credit) + ' 学分）</span></div>' +
      '<button class="btn btn-ghost" data-del-course="' + c.id + '" title="从课表中移除">移除</button>' +
      '</div></div>'
    );
  }

  /* ---------- 路由定义 ---------- */
  const routes = {
    '': { title: '首页', needSchool: false },
    'school': { title: '选择学校', needSchool: false },
    'portal': { title: '身份认证与课表导入', needSchool: true },
    'menu': { title: '选课菜单', needSchool: true },
    'cart': { title: '购物车', needSchool: true },
    'checkout': { title: '收银台', needSchool: true },
    'recruit': { title: '墨客招募', needSchool: false },
    'agreement': { title: '用户协议', needSchool: false },
    'about': { title: '关于本项目', needSchool: false }
  };

  function currentPath() {
    return location.hash.replace(/^#\/?/, '').split('?')[0];
  }

  function render() {
    const p = currentPath();

    /* 演示直达：一键铺好数据，再走正常页面（教学演示/自动化测试用） */
    const demoMap = {
      'demo-portal': { next: '#/portal', fillCart: false },
      'demo-menu': { next: '#/menu', fillCart: false },
      'demo-cart': { next: '#/cart', fillCart: true },
      'demo-checkout': { next: '#/checkout', fillCart: true }
    };
    const demo = demoMap[p];
    if (demo) {
      S.school = { id: CFG.SCHOOL.id, name: CFG.SCHOOL.name };
      S.membership.active = false;
      S.cart.wantsMember = false;
      S.cart.scorebao = false;
      setCourses(GuoLe.demoCourses());
      if (demo.fillCart) {
        S.cart.courseIds = S.courses.map(function (c) { return c.id; });
        if (p === 'demo-checkout') {
          S.cart.wantsMember = true;
          S.cart.scorebao = true;
          S.cart.scoreTarget = 90;
        }
        GuoLe.save();
      }
      location.hash = demo.next;
      return;
    }

    const route = routes[p] || routes[''];
    if (route.needSchool && !S.school) {
      toast('请先完成“选择学校”再继续哦');
      if (p !== 'school') { location.hash = '#/school'; return; }
    }
    sanitizeCart();
    document.title = '过了么 · ' + route.title;
    $('#view').innerHTML = route.render();
    $$('.main-nav a').forEach(function (a) {
      const href = a.getAttribute('href');
      a.classList.toggle('active', href === '#' + (p ? '/' + p : '/') || (p === '' && href === '#/'));
    });
    updateCartBadge();
    window.scrollTo(0, 0);
    afterRender[routeKey(p)] && afterRender[routeKey(p)]();
  }

  function routeKey(p) { return p || 'home'; }
  const afterRender = {};

  /* ================= 首页 ================= */
  routes[''].render = function () {
    return (
      '<section class="hero">' +
      '<span class="kicker">课程作业 · 校园内测体验版</span>' +
      '<h1>期末补考，稳了？<br>过了么，一单到手 🎯</h1>' +
      '<p>选学校、认证、导入本学期课表、像点外卖一样下单——「过了么」把“补考护航”做成了一份随手可点的菜单。这是一个界面完整、剧情整蛊的课程作业项目。</p>' +
      '<div class="btn-row"><a class="btn btn-lg" href="#/school">🚀 开始体验</a>' +
      '<a class="btn btn-lg" style="background:rgba(255,255,255,.16);color:#fff;border-color:transparent" href="#/agreement">先读用户协议</a></div>' +
      '</section>' +

      '<h2 class="section-title">我们提供的服务<span class="line"></span></h2>' +
      '<div class="grid">' +
      '<div class="card feature"><div class="ico">📚</div><h3>补考护航</h3><p>承诺补考 ≥ 60 分；未达标“全额退费 + 补偿重修费”。</p></div>' +
      '<div class="card feature"><div class="ico">💰</div><h3>按学分计费</h3><p>每学分 ¥99 起，难课/严师酌情少量加价，明码标价不玩套路。</p></div>' +
      '<div class="card feature"><div class="ico">🛡️</div><h3>准分宝</h3><p>加价锁定 ≥ 80 / 85 / 90 / 95 的分数范围，买一份安心。</p></div>' +
      '<div class="card feature"><div class="ico">🎓</div><h3>会员 49 元/学期</h3><p>每学分 95 折，还送“买三送一”：每满 3 学分免 1 学分费用。</p></div>' +
      '</div>' +

      '<h2 class="section-title">一次完整的使用流程<span class="line"></span></h2>' +
      '<div class="card steps">' +
      '<div class="step"><h3>选择学校</h3><p>当前演示版只适配了闽江学院，其它学校会提示“未找到 / 未适配”。</p></div>' +
      '<div class="step"><h3>统一身份认证</h3><p>跳转到学校官方平台登录（密码只交给学校系统，本项目不接触）。</p></div>' +
      '<div class="step"><h3>一键导入课程与学分</h3><p>进教务系统“选课信息”，复制一下，回来点“一键读取”，姓名、学号、课程、学分自动填好。</p></div>' +
      '<div class="step"><h3>选课下单</h3><p>像饿了么一样勾选课程、加入购物车、享受会员优惠。</p></div>' +
      '<div class="step"><h3>收银台结算</h3><p>微信/支付宝二选一，点“确认付款”后有整蛊彩蛋等你 🥚。</p></div>' +
      '</div>' +

      '<h2 class="section-title">学校支持<span class="line"></span></h2>' +
      '<div class="card school-result">' +
      '<p class="school-name">🏫 闽江学院</p>' +
      '<p class="school-meta">当前唯一适配学校 · 支持统一身份认证引导导入</p>' +
      '<div class="btn-row"><a class="btn btn-primary" href="#/school">选择学校开始</a>' +
      '<a class="btn" href="#/recruit">顺便看看墨客招募</a></div>' +
      '</div>' +

      '<h2 class="section-title">墨客招募<span class="line"></span></h2>' +
      '<div class="card">' +
      '<p>学习富有余力而无处施展？上过“过了么”的课表导入流程，顺便来应聘一名光荣的墨客（演示岗位）？平台考察已修课程与成绩，签约后与墨客平分收益。</p>' +
      '<a class="btn" href="#/recruit">去应聘 →</a>' +
      '</div>' +

      '<div class="card tip danger" style="margin-top:18px">' +
      '<strong>免责声明（请务必阅读）</strong><br>' +
      '本项目是课程作业/期末项目的虚构演示：①不提供任何真实的代考服务；②不会真实扣款；③不采集、不保存、不上传账号密码，任何身份与课程信息仅存于你本机浏览器；④文案中的“替考、收费、墨客”均为剧情设定，请勿模仿，真实考试请遵守校规校纪、诚信应考。' +
      '</div>' +

      '<div class="btn-row mt"><a class="btn btn-primary btn-lg" href="#/school">进入选校 →</a>' +
      '<button class="btn" data-reset>🗑 重置全部本地数据</button></div>'
    );
  };
  afterRender.home = function () {
    const btn = $('[data-reset]');
    btn && btn.addEventListener('click', function () {
      openModal(
        '重置本地数据',
        '<p>将清空本机浏览器里的学校、身份、课程、购物车等全部演示数据（localStorage）。</p>',
        '<button class="btn btn-primary" data-ok>确认重置</button><button class="btn" data-close>取消</button>'
      );
      const ok = $('[data-ok]');
      ok && ok.addEventListener('click', function () {
        GuoLe.resetAll();
        closeModal();
        toast('已重置全部本地数据', 'ok');
        setTimeout(render, 200);
      });
    });
  };

  /* ================= 选择学校 ================= */
  function schoolMatched(q) {
    q = String(q || '').trim();
    if (!q) return null;
    return CFG.SCHOOL.alias.some(function (k) { return q.indexOf(k) >= 0; });
  }

  routes['school'].render = function () {
    return (
      '<h1 class="page-title">选择学校</h1>' +
      '<p class="page-sub">演示版内置搜索不做 AI，采用本地关键词匹配：输入含“闽江/闽/江”等字眼才会命中。输入其它学校则提示未适配。</p>' +
      '<div class="card">' +
      '<div class="school-search">' +
      '<input id="school-q" type="search" placeholder="输入学校名称，例如：闽江学院" autocomplete="off">' +
      '<button class="btn btn-primary" id="school-go">搜索</button>' +
      '</div>' +
      '<div class="muted">💡 常见输入：<button class="btn btn-ghost" data-fill="闽江学院">闽江学院</button> <button class="btn btn-ghost" data-fill="闽江大学">闽江大学</button> <button class="btn btn-ghost" data-fill="闽">闽</button> <button class="btn btn-ghost" data-fill="江">江</button></div>' +
      '<div id="school-result" style="margin-top:16px"></div>' +
      '</div>'
    );
  };
  afterRender.school = function () {
    const input = $('#school-q');
    const resultBox = $('#school-result');

    function search() {
      const q = input.value;
      if (!q.trim()) {
        resultBox.innerHTML = '<div class="empty"><div class="big">🔍</div>输入学校名称开始搜索</div>';
        return;
      }
      if (schoolMatched(q)) {
        resultBox.innerHTML =
          '<div class="card school-result">' +
          '<p class="school-name">🏫 ' + GuoLe.esc(CFG.SCHOOL.name) + '</p>' +
          '<p class="school-meta">已适配 · 官方名称：闽江学院 · 所在地区：福建福州</p>' +
          '<p class="small muted">下一步将引导你前往学校统一身份认证平台，导入本学期课程与学分。</p>' +
          '<div class="btn-row">' +
          '<button class="btn btn-primary" id="pick-mju">选择闽江学院，继续 →</button>' +
          '<a class="btn" href="' + CFG.SCHOOL.officialUrl + '" target="_blank" rel="noopener">访问学校官网 ↗</a>' +
          '</div></div>';
        $('#pick-mju').addEventListener('click', function () {
          S.school = { id: CFG.SCHOOL.id, name: CFG.SCHOOL.name };
          GuoLe.save();
          toast('已选择：闽江学院', 'ok');
          go('#/portal');
        });
      } else {
        resultBox.innerHTML =
          '<div class="card school-miss">' +
          '<h3 style="margin:0 0 6px">😢 未找到或未适配</h3>' +
          '<p style="margin:0">没有找到“' + GuoLe.esc(q.trim()) + '”对应的适配版本。<br>演示版目前仅支持 <strong>闽江学院</strong>；其它学校将在后续版本按需适配。</p>' +
          '</div>';
      }
    }

    $('#school-go').addEventListener('click', search);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    $$('[data-fill]').forEach(function (b) {
      b.addEventListener('click', function () { input.value = b.getAttribute('data-fill'); search(); });
    });
    input.focus();
    search();
  };

  /* ================= 身份认证 + 课表导入 ================= */
  let pendingCourses = [];

  /* ---------- 安全验证（姓名 + 学号） ---------- */
  function identityDone() {
    return !!(String(S.identity.name || '').trim() && String(S.identity.sid || '').trim());
  }

  function updateIdentityState() {
    const hint = $('#identity-status');
    const card = $('#verify-card');
    const ok = identityDone();
    if (hint) {
      hint.className = 'verify-hint ' + (ok ? 'ok' : 'bad');
      hint.innerHTML = ok
        ? '✅ 验证通过：' + GuoLe.esc(S.identity.name) + ' · 学号 ' + GuoLe.esc(S.identity.sid) + '　<span class="muted">（已自动保存到本机）</span>'
        : '⚠️ 姓名与学号均为<strong>必填</strong>，填好后鼠标离开输入框即自动保存。';
    }
    if (card) card.classList.toggle('need-verify', !ok);
    const btn = $('#to-menu');
    if (btn) btn.textContent = ok ? '📋 保存并进入选课菜单' : '🔒 完成安全验证后进入选课菜单';
  }

  function syncIdentityInputs() {
    const n = $('#id-name'), d = $('#id-sid');
    if (n && document.activeElement !== n) n.value = S.identity.name || '';
    if (d && document.activeElement !== d) d.value = S.identity.sid || '';
    updateIdentityState();
  }

  function commitIdentity(silent) {
    const n = $('#id-name'), d = $('#id-sid');
    if (!n || !d) return;
    const name = n.value.trim();
    const sid = d.value.replace(/\s+/g, '');
    const changed = (name !== S.identity.name) || (sid !== S.identity.sid);
    S.identity.name = name;
    S.identity.sid = sid;
    GuoLe.save();
    updateIdentityState();
    if (changed && !silent && name && sid) toast('名称 / 学号已自动保存（仅本机）', 'ok');
  }

  /* ---------- 已导入课程列表 ---------- */
  function renderImportedList() {
    const box = $('#imported-list');
    if (!box) return;
    if (!S.courses.length) { box.innerHTML = '<p class="muted">当前还没有导入任何课程。</p>'; return; }
    box.innerHTML = '<p class="small muted">已导入 ' + S.courses.length + ' 门，共 ' + fmtCredit(S.courses.reduce(function (s, c) { return s + c.credit; }, 0)) + ' 学分：</p>' +
      S.courses.map(function (c) {
        return '<div class="cart-line"><span class="l-name">' + GuoLe.esc(c.name) + '</span><span>' + fmtCredit(c.credit) + ' 学分 <button class="btn btn-ghost" data-del-import="' + c.id + '">✕</button></span></div>';
      }).join('');
    $$('[data-del-import]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        S.courses = S.courses.filter(function (c) { return c.id !== b.getAttribute('data-del-import'); });
        sanitizeCart(); GuoLe.save(); renderImportedList();
      });
    });
  }

  /* ---------- 一键读取：一段教务系统文本 → 课表 + 身份 ---------- */
  function mergeCourses(list, source) {
    const existing = new Set(S.courses.map(function (c) { return c.name; }));
    const added = [];
    (list || []).forEach(function (c) {
      if (!c || !c.name || !(c.credit > 0)) return;
      if (existing.has(c.name)) return;
      existing.add(c.name);
      const item = { id: GuoLe.newCourseId(), name: c.name, credit: c.credit, category: c.category || '', source: source || '一键读取' };
      S.courses.push(item);
      added.push(item);
    });
    GuoLe.save();
    return added;
  }

  function ingestText(text, opts) {
    opts = opts || {};
    const raw = String(text || '');
    if (!raw.trim()) return null;
    const id = GuoLeParser.parseIdentity(raw);
    const courses = GuoLeParser.parseCourseText(raw);
    if (id.name) S.identity.name = id.name;
    if (id.sid) S.identity.sid = id.sid;
    GuoLe.save();
    const added = mergeCourses(courses, opts.source || '一键读取');
    syncIdentityInputs();
    renderImportedList();
    return { identity: id, found: courses.length, added: added, skipped: courses.length - added.length };
  }

  function ingestReportHtml(rep) {
    if (!rep) return '';
    const idOk = !!(rep.identity.name || rep.identity.sid);
    let html = '';
    if (idOk) {
      html += '<div class="read-line ok">🙋 身份已读取：<strong>' + GuoLe.esc(rep.identity.name || '—') + '</strong> · 学号 ' + GuoLe.esc(rep.identity.sid || '—') + '　<span class="muted">已自动填入下方“安全验证”</span></div>';
    }
    if (rep.added.length) {
      html += '<div class="read-line ok">📚 已导入 ' + rep.added.length + ' 门课程 · 共 ' + fmtCredit(rep.added.reduce(function (s, c) { return s + c.credit; }, 0)) + ' 学分<br><span class="muted">' +
        GuoLe.esc(rep.added.map(function (c) { return c.name + '（' + fmtCredit(c.credit) + '）'; }).join('、')) + '</span></div>';
    }
    if (rep.skipped) html += '<div class="read-line">↺ 有 ' + rep.skipped + ' 门课程已经在课表里，已自动跳过</div>';
    if (!idOk && !rep.added.length) {
      html += '<div class="tip danger">这段文本里没有读到课程或身份信息。请确认复制的是<strong>“选课信息”</strong>那一页（能同时看到课程名称与学分），或者改用下面的“方法 A”粘贴。</div>';
    }
    if (idOk && rep.added.length) {
      html += '<div class="btn-row mt"><button class="btn btn-primary btn-lg" id="oneshot-go">🎉 读取完成，进入选课菜单 →</button></div>';
    }
    return html;
  }

  function wireOneshotGo() {
    const b = $('#oneshot-go');
    if (b) b.addEventListener('click', function () { go('#/menu'); });
  }

  function readClipboardAndImport() {
    const box = $('#oneshot-result');
    const fallback = function (why) {
      if (box) box.innerHTML = '<div class="tip warn">' + why + '</div>';
      const ta = $('#paste-area');
      if (ta) { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus(); }
    };
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      fallback('当前打开方式不允许网页直接读取剪贴板（浏览器只在 https / localhost 下开放这个能力）。<br>请按 <code>Ctrl+V</code> 把课表粘到下面“方法 A”的输入框里，<strong>粘贴后会自动解析导入</strong>。');
      return;
    }
    if (box) box.innerHTML = '<div class="tip">⏳ 正在读取剪贴板……</div>';
    navigator.clipboard.readText().then(function (t) {
      if (!t || !t.trim()) { fallback('剪贴板里没有文字。请先在教务系统页面复制“选课信息”表格，再回来点一次。'); return; }
      const rep = ingestText(t, { source: '一键读取' });
      if (box) { box.innerHTML = ingestReportHtml(rep); wireOneshotGo(); }
      const ta = $('#paste-area');
      if (ta) ta.value = '';
      if (rep) toast('已读取 ' + rep.added.length + ' 门课程' + ((rep.identity.name || rep.identity.sid) ? '，身份信息已自动填入' : ''), 'ok');
    }).catch(function () {
      fallback('浏览器拒绝了读取剪贴板（未授权或非安全环境）。<br>请到下面“方法 A”的输入框按 <code>Ctrl+V</code> 粘贴，<strong>粘贴后会自动解析导入</strong>。');
    });
  }

  function guideFloatHtml() {
    return (
      '<div class="guide-float" id="guide-float">' +
      '<button class="guide-head" id="guide-toggle">📌 操作指引 · 点我展开／收起<span class="guide-caret">▾</span></button>' +
      '<ol class="guide-body">' +
      '<li>打开<strong>教务系统</strong>，用学号 + 密码登录</li>' +
      '<li>进入 <strong>信息查询 → 查询个人信息 → 选课信息</strong></li>' +
      '<li>学年选 <strong>2026-2027</strong> · 学期选 <strong>第 1 学期</strong></li>' +
      '<li>表格上 <strong>Ctrl+A</strong> → <strong>Ctrl+C</strong> 复制</li>' +
      '<li>回到本页点 <strong>⚡ 一键读取</strong>，读不到就直接粘贴</li>' +
      '</ol>' +
      '<button class="guide-x" id="guide-close" title="关闭指引">✕</button>' +
      '</div>'
    );
  }

  function renderPortal() {
    const sc = CFG.SCHOOL;
    const isFile = location.protocol === 'file:';
    return (
      '<h1 class="page-title">身份认证与课表导入</h1>' +
      '<p class="page-sub">当前学校：<strong>' + GuoLe.esc(S.school ? S.school.name : sc.name) + '</strong> · 目标：拿到“本学期课程 + 学分”清单，用于生成下单菜单。</p>' +

      '<div class="stepper">' +
      '<div class="s now">① 登录教务系统</div>' +
      '<div class="s">② 打开“选课信息”</div>' +
      '<div class="s">③ 一键读取</div>' +
      '<div class="s">④ 选课下单</div>' +
      '</div>' +

      '<div class="card oneshot" id="oneshot-card">' +
      '<h3 style="margin-top:0">⚡ 一键读取课表（推荐）</h3>' +
      '<p class="small muted">不用自己翻找课程、不用逐行核对。照着下面几步做，最后回到本页点一下按钮，<strong>姓名、学号、课程、学分</strong>会一次性自动填好。</p>' +
      '<ol class="guide-steps">' +
      '<li>点下面的按钮打开教务系统，用学号 + 密码登录；</li>' +
      '<li>顶部菜单进入 <strong>信息查询 → 查询个人信息 → 选课信息</strong>；</li>' +
      '<li>把<strong>学年</strong>选成 <strong>2026-2027</strong>、<strong>学期</strong>选成 <strong>第 1 学期</strong>，等表格刷出来；</li>' +
      '<li>在表格区域按 <strong>Ctrl+A</strong> 全选、<strong>Ctrl+C</strong> 复制（手机上是长按表格 → 全选 → 复制）；</li>' +
      '<li>回到本页，点下面的 <strong>⚡ 一键读取</strong>。</li>' +
      '</ol>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary btn-lg" id="oneshot-read">⚡ 一键读取（读取剪贴板）</button>' +
      '<a class="btn btn-lg" href="' + sc.xkxxUrl + '" target="_blank" rel="noopener">🔗 直达“选课信息”页 ↗</a>' +
      '<a class="btn" href="' + sc.portalUrl + '" target="_blank" rel="noopener">统一身份认证 ↗</a>' +
      '<a class="btn" href="' + sc.jwUrl + '" target="_blank" rel="noopener">教务系统登录页 ↗</a>' +
      '</div>' +
      '<div id="oneshot-result" class="mt"></div>' +
      '<div class="tip small">读不到也没关系：下面的<strong>方法 A</strong>支持直接粘贴（粘贴即自动解析），<strong>方法 B</strong>可以手动添加或载入演示课表；右上角的“操作指引”会全程跟着你。</div>' +
      '</div>' +

      '<div class="card">' +
      '<h3 style="margin-top:0">① 打开学校统一身份认证平台</h3>' +
      '<p class="small muted">推荐入口：' + GuoLe.esc(sc.portalName) + '（支持账号密码 / 微信扫码）</p>' +
      '<div class="btn-row">' +
      '<a class="btn btn-primary" href="' + sc.portalUrl + '" target="_blank" rel="noopener">打开 ' + GuoLe.esc(sc.portalName) + ' ↗</a>' +
      '<a class="btn" href="' + sc.jwUrl + '" target="_blank" rel="noopener">教务系统（需校园网）↗</a>' +
      '<a class="btn" href="' + sc.jwOuterUrl + '" target="_blank" rel="noopener">教务系统校外入口 ↗</a>' +
      '</div>' +
      '<div class="tip">🔐 账号密码只在闽江学院官方页面输入，由学校系统处理。<strong>本程序不接触、不保存、不上传你的密码</strong>，登录状态也只保留在浏览器里。</div>' +
      '</div>' +

      '<div class="card">' +
      '<h3 style="margin-top:0">② 登录后，打开“选课信息”</h3>' +
      '<div class="tip success">最稳的一条路径（教务系统 V9.0）：<strong>信息查询 → 查询个人信息 → 选课信息</strong>。<br>把<strong>学年</strong>选成 <strong>2026-2027</strong>、<strong>学期</strong>选成 <strong>第 1 学期</strong>，表格里就会给出每门课的<strong>课程名称</strong>与<strong>学分</strong>，以及你的<strong>姓名</strong>和<strong>学号</strong>。</div>' +
      '<ol class="small">' +
      '<li>在 <code>' + GuoLe.esc(sc.portalName) + '</code> 登录后，点击“教务管理系统”（若你直接用教务入口，跳过本步）；</li>' +
      '<li>依次点击 <strong>信息查询 → 查询个人信息 → 选课信息</strong>；</li>' +
      '<li>把学年 / 学期切换到<strong>本学期</strong>，确认表格里能看到课程名称与学分；</li>' +
      '<li>在表格上 <code>Ctrl+A</code> 全选、<code>Ctrl+C</code> 复制，然后回来点“⚡ 一键读取”。</li>' +
      '</ol>' +
      '<div class="btn-row"><a class="btn btn-primary" href="' + sc.xkxxUrl + '" target="_blank" rel="noopener">🔗 打开“选课信息”页 ↗</a>' +
      '<a class="btn" href="' + sc.kbUrl + '" target="_blank" rel="noopener">课表查询页 ↗</a>' +
      '<button class="btn btn-ghost" id="portal-done">✅ 我已经复制好了</button></div>' +
      '</div>' +

      '<div class="card" id="import-panel">' +
      '<h3 style="margin-top:0">③④ 把课程导进来</h3>' +
      '<div class="grid grid-2">' +
      '<div class="card" style="box-shadow:none">' +
      '<h4 style="margin-top:0">方法 A：粘贴文本（自动解析）</h4>' +
      '<p class="small muted">把复制的教务系统内容粘进来：<strong>一粘贴就会自动识别并导入</strong>；想逐门核对，可以点“预览 / 手动挑选”。</p>' +
      '<textarea class="import-box" id="paste-area" placeholder="在这里 Ctrl+V 粘贴“选课信息”表格内容……（粘贴后自动解析）"></textarea>' +
      '<div class="btn-row mt"><button class="btn" id="parse-btn">🔍 预览 / 手动挑选</button>' +
      '<button class="btn btn-ghost" id="clear-paste">清空</button></div>' +
      '<div id="parse-result" style="margin-top:12px"></div>' +
      '</div>' +
      '<div class="card" style="box-shadow:none">' +
      '<h4 style="margin-top:0">方法 B：演示课表 / 手动添加</h4>' +
      '<p class="small muted">在教室演示、没有校园网、或想快速体验完整下单流程时，可一键载入演示课表；也可以逐门手动添加。</p>' +
      '<div class="btn-row"><button class="btn btn-warn" id="load-demo">🎒 载入演示课表（7 门）</button>' +
      '<button class="btn btn-danger" id="clear-courses">清空已导入课程</button></div>' +
      '<hr>' +
      '<div class="manual-row"><input id="m-name" placeholder="课程名称，如：高等数学A"><input id="m-credit" type="number" min="0.1" step="0.05" placeholder="学分"><button class="btn" id="m-add">添加</button></div>' +
      '<div id="imported-list"></div>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<div class="card" id="verify-card">' +
      '<h3 style="margin-top:0">🔐 安全验证（必填）</h3>' +
      '<p class="small muted">请填写你的<strong>真实姓名</strong>与<strong>学号</strong>。信息只保存在你自己的浏览器里（localStorage），不会上传到任何服务器；用于核对订单身份、生成订单凭证。</p>' +
      '<div class="verify-grid">' +
      '<label><span>姓名 <b class="req">*</b></span><input id="id-name" autocomplete="off" placeholder="请输入姓名"></label>' +
      '<label><span>学号 <b class="req">*</b></span><input id="id-sid" autocomplete="off" inputmode="numeric" placeholder="请输入学号"></label>' +
      '</div>' +
      '<div class="verify-hint bad" id="identity-status"></div>' +
      '<p class="small muted">鼠标离开输入框就会<strong>自动保存</strong>，不需要点任何按钮。</p>' +
      '</div>' +

      '<div class="card">' +
      '<details>' +
      '<summary style="cursor:pointer">🧩 进阶玩法：书签小工具（在教务系统页面里一键提取）</summary>' +
      '<div style="margin-top:10px">' +
      '<p class="small muted">把下面这个按钮<strong>拖到浏览器书签栏</strong>（手机上：复制代码 → 新建书签 → 把代码粘到网址栏）。<br>之后在教务系统的页面上点一下这个书签，它会自动抓取页面里的课程与学分，并跳回本程序完成导入——这是纯网页能做到的最接近“全自动拉取”的方案。</p>' +
      '<a class="btn btn-warn" id="bm-link" href="javascript:void(0)" draggable="true">📎 过了么 · 一键提取课表</a>' +
      '<div class="btn-row mt"><button class="btn" id="bm-copy">📋 复制书签代码</button></div>' +
      '<textarea class="import-box bm-code" id="bm-code" readonly></textarea>' +
      (isFile ? '<div class="tip warn">检测到你现在是<strong>直接双击打开文件（file://）</strong>：浏览器不允许从学校网站跳回本地文件，书签小工具在这个模式下无法自动跳回。请改用上面的“⚡ 一键读取”，或者把项目用本地服务器 / 网址方式打开后再用书签。</div>' : '') +
      '</div></details>' +
      '</div>' +

      '<div class="card">' +
      '<details>' +
      '<summary style="cursor:pointer">🧪 在页面内打开学校官网（实验性，可能被学校安全策略拦截）</summary>' +
      '<div style="margin-top:10px">' +
      '<iframe id="portal-frame" src="' + sc.portalUrl + '" style="width:100%;height:430px;border:1px solid #e5e6eb;border-radius:10px;background:#fff"></iframe>' +
      '<p class="muted mt">如果上方空白或提示“拒绝连接”，说明学校网站禁止被嵌入（浏览器安全策略），请改用上方“新窗口打开”。<br>即使嵌入成功，受浏览器同源策略限制，本程序也<strong>无法读取页面内的登录后内容</strong>——所以请配合“⚡ 一键读取”或“方法 A”使用。</p>' +
      '</div></details>' +
      '</div>' +

      '<div class="btn-row mt"><button class="btn btn-primary btn-lg" id="to-menu">📋 保存并进入选课菜单</button>' +
      '<a class="btn btn-lg" href="#/school">← 重选学校</a></div>' +

      guideFloatHtml()
    );
  }

  routes['portal'].render = renderPortal;
  afterRender.portal = function () {
    syncIdentityInputs();
    renderImportedList();

    /* 安全验证：离开输入框（blur）即自动保存 */
    ['id-name', 'id-sid'].forEach(function (id) {
      const el = $('#' + id);
      if (!el) return;
      el.addEventListener('blur', function () { commitIdentity(); });
      el.addEventListener('change', function () { commitIdentity(); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); });
    });

    /* ⚡ 一键读取 */
    const readBtn = $('#oneshot-read');
    if (readBtn) readBtn.addEventListener('click', readClipboardAndImport);

    /* 方法 A：粘贴即自动解析导入 */
    const pasteArea = $('#paste-area');
    if (pasteArea) {
      pasteArea.addEventListener('paste', function () {
        setTimeout(function () {
          const rep = ingestText(pasteArea.value, { source: '粘贴解析' });
          if (!rep) return;
          const out = $('#parse-result');
          if (out) out.innerHTML = ingestReportHtml(rep);
          wireOneshotGo();
          if (rep.added.length) toast('已自动解析并导入 ' + rep.added.length + ' 门课程', 'ok');
        }, 40);
      });
    }

    const doneBtn = $('#portal-done');
    if (doneBtn) doneBtn.addEventListener('click', function () {
      const card = $('#oneshot-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      readClipboardAndImport();
    });

    /* 方法 A：预览 / 手动挑选 */
    function showPreview() {
      const text = pasteArea ? pasteArea.value : '';
      if (!text.trim()) { toast('请先粘贴课表内容', 'err'); return; }
      pendingCourses = GuoLeParser.parseCourseText(text);
      const out = $('#parse-result');
      if (!out) return;
      if (!pendingCourses.length) {
        out.innerHTML = '<div class="tip danger">没有识别到“课程名 + 学分”的组合。请确认复制的内容包含课程名称与学分；也可以点上面的“⚡ 一键读取”，或用“手动添加”。</div>';
        return;
      }
      let html = '<p class="small muted">识别到 ' + pendingCourses.length + ' 条候选，请核对并勾选：</p>' +
        '<table class="import-table"><tr><th>✓</th><th>课程名称（可改）</th><th>学分（可改）</th><th>来源行</th></tr>';
      pendingCourses.forEach(function (c, i) {
        html += '<tr><td><input type="checkbox" data-pick="' + i + '" checked></td>' +
          '<td><input data-pname="' + i + '" value="' + GuoLe.esc(c.name) + '"></td>' +
          '<td><input data-pcredit="' + i + '" type="number" min="0.1" step="0.05" value="' + c.credit + '" style="width:90px"></td>' +
          '<td class="muted">' + GuoLe.esc(c.rawLine || '') + '</td></tr>';
      });
      html += '</table><div class="btn-row mt"><button class="btn btn-primary" id="confirm-import">导入勾选的课程</button>' +
        '<button class="btn" id="pick-all">全选 / 全不选</button></div>';
      out.innerHTML = html;

      $('#pick-all').addEventListener('click', function () {
        const boxes = $$('[data-pick]');
        const someOff = boxes.some(function (b) { return !b.checked; });
        boxes.forEach(function (b) { b.checked = someOff; });
      });
      $('#confirm-import').addEventListener('click', function () {
        let picked = [];
        $$('[data-pick]').forEach(function (b) {
          if (!b.checked) return;
          const i = parseInt(b.getAttribute('data-pick'), 10);
          const base = pendingCourses[i];
          const name = $('[data-pname="' + i + '"]').value.trim();
          const credit = parseFloat($('[data-pcredit="' + i + '"]').value);
          if (name && credit > 0) {
            picked.push({ name: name, credit: credit, category: (base && base.category) || '', source: '粘贴解析' });
          }
        });
        if (!picked.length) { toast('没有选中任何有效课程', 'err'); return; }
        const added = mergeCourses(picked, '粘贴解析');
        if (added.length !== picked.length) toast('已跳过 ' + (picked.length - added.length) + ' 门同名课程');
        if (!added.length) { toast('所选课程都已在课表中', 'err'); return; }
        pendingCourses = [];
        out.innerHTML = '';
        if (pasteArea) pasteArea.value = '';
        renderImportedList();
        toast('成功导入 ' + added.length + ' 门课程', 'ok');
      });
    }
    if ($('#parse-btn')) $('#parse-btn').addEventListener('click', showPreview);

    if ($('#clear-paste')) $('#clear-paste').addEventListener('click', function () {
      if (pasteArea) pasteArea.value = '';
      pendingCourses = [];
      $('#parse-result').innerHTML = '';
    });

    /* 方法 B：演示课表 / 手动添加 / 清空 */
    if ($('#load-demo')) $('#load-demo').addEventListener('click', function () {
      openModal(
        '载入演示课表？',
        '<p>将用 7 门示例课程（共 21 学分）替换当前已导入课程，方便课堂演示与完整流程体验。</p>',
        '<button class="btn btn-primary" data-ok>载入</button><button class="btn" data-close>取消</button>'
      );
      $('[data-ok]').addEventListener('click', function () {
        setCourses(GuoLe.demoCourses());
        closeModal(); renderImportedList();
        toast('已载入演示课表（21 学分）', 'ok');
      });
    });

    if ($('#clear-courses')) $('#clear-courses').addEventListener('click', function () {
      setCourses([]);
      renderImportedList();
      toast('已清空课程');
    });

    if ($('#m-add')) $('#m-add').addEventListener('click', function () {
      const name = $('#m-name').value.trim();
      const credit = parseFloat($('#m-credit').value);
      if (!name || !(credit > 0)) { toast('请填写课程名称和有效学分', 'err'); return; }
      const added = mergeCourses([{ name: name, credit: credit }], '手动添加');
      $('#m-name').value = ''; $('#m-credit').value = '';
      renderImportedList();
      toast(added.length ? '已添加：' + name : '该课程已在课表中', added.length ? 'ok' : 'err');
    });

    /* 🧩 书签小工具 */
    const bmCode = 'javascript:' + GuoLeParser.buildBookmarklet(location.href.split('#')[0]);
    const bmLink = $('#bm-link');
    const bmText = $('#bm-code');
    if (bmText) bmText.value = bmCode;
    if (bmLink) {
      bmLink.setAttribute('href', bmCode);
      bmLink.addEventListener('click', function (e) {
        e.preventDefault();
        toast('请把这个按钮拖到浏览器书签栏；手机端请点“复制书签代码”后新建书签', 'ok');
      });
    }
    if ($('#bm-copy')) $('#bm-copy').addEventListener('click', function () { copyText(bmCode); });

    /* 悬浮操作指引 */
    const gf = $('#guide-float');
    if (gf) {
      if (window.innerWidth < 720) gf.classList.add('collapsed');
      if ($('#guide-toggle')) $('#guide-toggle').addEventListener('click', function () { gf.classList.toggle('collapsed'); });
      if ($('#guide-close')) $('#guide-close').addEventListener('click', function () { gf.remove(); });
    }

    /* 进入菜单（先卡安全验证，再卡课程） */
    $('#to-menu').addEventListener('click', function () {
      if (!identityDone()) {
        openModal(
          '🔐 请先完成安全验证',
          '<p>姓名和学号用于核对订单身份、生成订单凭证，<strong>两项都填写后才能进入选课菜单</strong>。</p>' +
          '<p class="muted small">信息只保存在你自己的浏览器里，不会上传到任何服务器。</p>',
          '<button class="btn btn-primary" data-ok>去填写</button>'
        );
        $('[data-ok]').addEventListener('click', function () {
          closeModal();
          const card = $('#verify-card');
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const n = $('#id-name');
          if (n) setTimeout(function () { n.focus(); }, 420);
        });
        return;
      }
      if (!S.courses.length) {
        openModal(
          '还没有课程',
          '<p>选课菜单需要至少一门课程。你可以：<br>① 一键读取 / 粘贴课表解析；<br>② 手动添加；<br>③ 直接载入“演示课表”快速体验。</p>',
          '<button class="btn btn-primary" data-ok>载入演示课表</button><button class="btn" data-close>先不弄</button>'
        );
        $('[data-ok]').addEventListener('click', function () {
          setCourses(GuoLe.demoCourses());
          closeModal();
          toast('已载入演示课表', 'ok');
          go('#/menu');
        });
        return;
      }
      go('#/menu');
    });
  };
  /* ================= 选课菜单 ================= */
  routes['menu'].render = function () {
    const memberOn = S.membership.active || S.cart.wantsMember;
    const sel = S.courses.filter(function (c) { return S.cart.courseIds.includes(c.id); });
    const selCredits = fmtCredit(sel.reduce(function (s, c) { return s + c.credit; }, 0));
    const selMoney = GuoLe.round2(sel.reduce(function (s, c) { return s + GuoLe.coursePricing(c).subtotal; }, 0));
    let body;
    if (!S.courses.length) {
      body = '<div class="card empty"><div class="big">🎒</div><p>还没有导入课程。</p><a class="btn btn-primary" href="#/portal">去身份认证并导入课表 →</a></div>';
    } else {
      body = '<div class="grid">' + S.courses.map(courseCardHtml).join('') + '</div>' +
        '<div class="sticky-bar"><div class="info">已选 <b>' + S.cart.courseIds.length + '</b> 门 · ' + selCredits + ' 学分 · 小计 ' + GuoLe.money(selMoney) + '</div>' +
        '<div class="btn-row"><a class="btn" href="#/cart">查看购物车</a><a class="btn btn-primary" href="#/cart">去结算 →</a></div></div>';
    }
    return (
      '<h1 class="page-title">选课菜单</h1>' +
      '<p class="page-sub">' + GuoLe.esc(S.school ? S.school.name : '') + ' · ' + GuoLe.esc(S.identity.name || '未填写姓名') + '（' + GuoLe.esc(S.identity.sid || '未填写学号') + '） · 共 ' + S.courses.length + ' 门课</p>' +
      '<div class="card tip">' +
      '<strong>计费规则：</strong>每学分基础价 ¥' + CFG.BASE_PRICE_PER_CREDIT + '；难度大/背诵量大的课程会酌情加价并注明原因。<br>' +
      (memberOn
        ? '<span class="ok-text">✓ 会员已生效：每学分 95 折 + 买三送一</span>'
        : '<a href="#/cart">还不是会员？结算时 49 元开通，享 95 折 + 买三送一 →</a>') +
      '<br><span class="muted">承诺：未达标全额退费并补偿重修费；可选“准分宝”锁定更高分数。</span>' +
      '</div>' +
      body
    );
  };
  afterRender.menu = function () {
    $$('[data-add-course]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        const id = chk.getAttribute('data-add-course');
        if (chk.checked) {
          if (!S.cart.courseIds.includes(id)) S.cart.courseIds.push(id);
          toast('已加入购物车 🛒');
        } else {
          S.cart.courseIds = S.cart.courseIds.filter(function (x) { return x !== id; });
          toast('已移出购物车');
        }
        GuoLe.save(); render();
      });
    });
    $$('[data-del-course]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-del-course');
        const c = S.courses.find(function (x) { return x.id === id; });
        if (!c) return;
        openModal('移除课程', '<p>确认从课表中移除「' + GuoLe.esc(c.name) + '」？</p>',
          '<button class="btn btn-danger" data-ok>移除</button><button class="btn" data-close>取消</button>');
        $('[data-ok]').addEventListener('click', function () {
          S.courses = S.courses.filter(function (x) { return x.id !== id; });
          sanitizeCart(); GuoLe.save(); closeModal(); render();
          toast('已移除');
        });
      });
    });
  };

  /* ================= 购物车 ================= */
  routes['cart'].render = function () {
    const order = GuoLe.calcOrder(S);
    const scoreOptions = GuoLe.scoreBaoOptions();
    let body;
    if (!S.cart.courseIds.length) {
      body = '<div class="card empty"><div class="big">🛒</div><p>购物车还是空的。</p><a class="btn btn-primary" href="#/menu">去选课菜单逛逛 →</a></div>';
    } else {
      body =
        '<div class="grid grid-2">' +
        '<div><div class="card">' +
        '<h3 style="margin-top:0">已选课程（' + S.cart.courseIds.length + ' 门）</h3>' +
        S.cart.courseIds.map(function (id) {
          const c = S.courses.find(function (x) { return x.id === id; });
          if (!c) return '';
          const pr = GuoLe.coursePricing(c);
          return '<div class="cart-line"><span class="l-name">' + GuoLe.esc(c.name) + '</span>' +
            '<span>' + fmtCredit(c.credit) + ' 学分 × ' + pr.unit + ' 元 <button class="btn btn-ghost" data-cart-del="' + c.id + '">✕</button></span></div>';
        }).join('') +
        '</div></div>' +
        '<div>' +
        '<div class="card">' +
        '<h3 style="margin-top:0">订单明细</h3>' +
        '<div class="cart-line"><span class="l-name">基础费用（' + order.credits + ' 学分）</span><span>' + GuoLe.money(order.rawTotal) + '</span></div>' +
        (order.isMember
          ? '<div class="cart-line"><span class="l-name">会员 95 折</span><span class="ok-text">− ' + GuoLe.money(order.memberDiscount) + '</span></div>' +
            (order.freeCredits > 0
              ? '<div class="cart-line"><span class="l-name">买三送一（免 ' + order.freeCredits + ' 学分）</span><span class="ok-text">− ' + GuoLe.money(order.buy3Value) + '</span></div>'
              : '<div class="cart-line"><span class="l-name">买三送一</span><span class="muted">再选满 3 学分即可触发</span></div>')
          : '') +
        (order.memberFeeNeeded ? '<div class="cart-line"><span class="l-name">会员费（本次一并开通）</span><span>' + GuoLe.money(CFG.MEMBER_FEE) + '</span></div>' : '') +
        (order.scorebao ? '<div class="cart-line"><span class="l-name">准分宝（目标 ≥ ' + order.scoreTarget + '）</span><span>' + GuoLe.money(order.scorebaoFee) + '</span></div>' : '') +
        '<div class="total-line flex-between"><span>应付合计</span><span class="amount">' + GuoLe.money(order.total) + '</span></div>' +
        '<p class="muted small">演示金额不会真实扣款。</p>' +
        '</div>' +

        '<div class="card">' +
        '<h3 style="margin-top:0">🎓 会员</h3>' +
        (S.membership.active
          ? '<p><span class="tag tag-success">会员已生效</span> 本单自动享受 95 折 + 买三送一。</p>'
          : '<label class="cart-line" style="cursor:pointer"><span class="l-name">本次一并开通会员（¥' + CFG.MEMBER_FEE + '）</span><input type="checkbox" id="member-box"' + (S.cart.wantsMember ? ' checked' : '') + '></label>' +
            '<p class="muted small">开通后本单立即生效：每学分 95 折，且每满 3 学分免 1 学分。</p>') +
        '</div>' +

        '<div class="card">' +
        '<h3 style="margin-top:0">🛡️ 准分宝（可选加购）</h3>' +
        '<label class="cart-line" style="cursor:pointer"><span class="l-name">加购准分宝，保障分数高于所选范围</span><input type="checkbox" id="score-box"' + (S.cart.scorebao ? ' checked' : '') + '></label>' +
        (S.cart.scorebao
          ? '<div class="mt"><select id="score-target" style="width:100%;padding:8px;border:1px solid #e5e6eb;border-radius:8px">' +
            scoreOptions.map(function (o) {
              return '<option value="' + o.target + '"' + (S.cart.scoreTarget === o.target ? ' selected' : '') + '>目标 ≥ ' + o.target + ' 分（每学分 +¥' + o.feePerCredit + '）</option>';
            }).join('') + '</select></div>'
          : '') +
        '</div>' +

        '<a class="btn btn-primary btn-lg btn-block mt" href="#/checkout">去收银台结算 →</a>' +
        '</div></div>';
    }
    return (
      '<h1 class="page-title">购物车</h1>' +
      '<p class="page-sub">像点外卖一样勾选“补考护航”课程（可自由增减、随时退单）。</p>' +
      body +
      '<div class="card tip mt"><strong>服务承诺：</strong>如果服务未达标，免费退还全部费用，并补偿相关学科重修费用。还可加价购买“准分宝”，保障分数大于你选定的范围。</div>'
    );
  };
  afterRender.cart = function () {
    $$('[data-cart-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.cart.courseIds = S.cart.courseIds.filter(function (x) { return x !== b.getAttribute('data-cart-del'); });
        GuoLe.save(); render();
        toast('已移出购物车');
      });
    });
    const memberBox = $('#member-box');
    if (memberBox) memberBox.addEventListener('change', function () {
      S.cart.wantsMember = memberBox.checked;
      GuoLe.save(); render();
    });
    const scoreBox = $('#score-box');
    if (scoreBox) scoreBox.addEventListener('change', function () {
      S.cart.scorebao = scoreBox.checked;
      GuoLe.save(); render();
    });
    const target = $('#score-target');
    if (target) target.addEventListener('change', function () {
      S.cart.scoreTarget = parseInt(target.value, 10);
      GuoLe.save(); render();
    });
  };

  /* ================= 模拟收银台 ================= */
  function drawFakeQr(canvas, seed) {
    const ctx = canvas.getContext('2d');
    const n = 29;
    const size = canvas.width;
    const cell = size / n;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
    const rand = function () { h = ((h * 1103515245) + 12345) >>> 0; return h / 4294967296; };
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const finder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
        const on = finder ? true : rand() < 0.42;
        if (on) { ctx.fillStyle = '#000'; ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5); }
      }
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 7 * cell, 7 * cell);
    ctx.fillStyle = '#fff';
    ctx.fillRect(cell, cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#000';
    ctx.fillRect(2 * cell, 2 * cell, 3 * cell, 3 * cell);
    ctx.fillStyle = '#000';
    ctx.fillRect((n - 7) * cell, 0, 7 * cell, 7 * cell);
    ctx.fillStyle = '#fff';
    ctx.fillRect((n - 6) * cell, cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#000';
    ctx.fillRect((n - 5) * cell, 2 * cell, 3 * cell, 3 * cell);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, (n - 7) * cell, 7 * cell, 7 * cell);
    ctx.fillStyle = '#fff';
    ctx.fillRect(cell, (n - 6) * cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#000';
    ctx.fillRect(2 * cell, (n - 5) * cell, 3 * cell, 3 * cell);
  }

  let payMethod = 'wechat';

  routes['checkout'].render = function () {
    const order = GuoLe.calcOrder(S);
    if (!S.cart.courseIds.length) {
      return '<div class="card empty"><div class="big">🧾</div><p>没有待结算的订单。</p><a class="btn btn-primary" href="#/menu">去选课 →</a></div>';
    }
    const isWechat = payMethod === 'wechat';
    const payTitle = isWechat ? '微信支付' : '支付宝';
    return (
      '<h1 class="page-title">收银台</h1>' +
      '<p class="page-sub">第 ' + (S.orderSeq + 1) + ' 笔订单 · 不会真实扣款</p>' +
      '<div class="grid grid-2">' +
      '<div class="card">' +
      '<h3 style="margin-top:0">订单确认</h3>' +
      '<p class="small">' + order.courses.map(function (c) { return GuoLe.esc(c.name) + '（' + fmtCredit(c.credit) + ' 学分）'; }).join('、') + '</p>' +
      '<hr>' +
      '<div class="cart-line"><span class="l-name">课程数 / 总学分</span><span>' + order.courses.length + ' 门 / ' + order.credits + ' 学分</span></div>' +
      '<div class="cart-line"><span class="l-name">基础费用</span><span>' + GuoLe.money(order.rawTotal) + '</span></div>' +
      (order.isMember ? '<div class="cart-line"><span class="l-name">会员优惠（95折+买三送一）</span><span class="ok-text">− ' + GuoLe.money(GuoLe.round2(order.memberDiscount + order.buy3Value)) + '</span></div>' : '') +
      (order.memberFeeNeeded ? '<div class="cart-line"><span class="l-name">会员费</span><span>' + GuoLe.money(CFG.MEMBER_FEE) + '</span></div>' : '') +
      (order.scorebao ? '<div class="cart-line"><span class="l-name">准分宝（≥' + order.scoreTarget + '）</span><span>' + GuoLe.money(order.scorebaoFee) + '</span></div>' : '') +
      '<div class="total-line flex-between"><span>应付金额</span><span class="amount">' + GuoLe.money(order.total) + '</span></div>' +
      (identityDone()
        ? '<div class="tip"><strong>已绑定身份：</strong>' + GuoLe.esc(S.identity.name) + ' · ' + GuoLe.esc(S.identity.sid) + '<br><span class="muted">订单凭证将使用以上信息，可在“身份认证与课表导入”页修改。</span></div>'
        : '<div class="tip warn"><strong>尚未完成安全验证：</strong>请先填写姓名与学号，订单凭证才能关联到你的身份。<br><a href="#/portal">→ 去完成安全验证</a></div>') +
      '</div>' +

      '<div class="card">' +
      '<h3 style="margin-top:0">选择支付方式</h3>' +
      '<div class="pay-tabs">' +
      '<button class="pay-tab' + (isWechat ? ' active' : '') + '" data-pay="wechat">💚 微信支付</button>' +
      '<button class="pay-tab' + (!isWechat ? ' active' : '') + '" data-pay="alipay">💙 支付宝</button>' +
      '</div>' +
      '<div class="qrcode-wrap">' +
      '<canvas class="qrcode-canvas" id="pay-qr" width="180" height="180"></canvas>' +
      '<p class="qrcode-hint">' + GuoLe.esc(payTitle) + ' · 请使用演示金额 ' + GuoLe.money(order.total) + ' 完成付款<br>（示意二维码，不会真实跳转）</p>' +
      '</div>' +
      '<div class="tip warn" style="text-align:center">本页面不会真正扣款，请放心点击。</div>' +
      '<button class="btn btn-success btn-lg btn-block" id="confirm-pay">✅ 确认付款</button>' +
      '<p class="muted small" style="text-align:center">点击后会出现“整蛊彩蛋”，全程没有真实支付。</p>' +
      '</div>' +
      '</div>'
    );
  };
  afterRender.checkout = function () {
    const order = GuoLe.calcOrder(S);
    const canvas = $('#pay-qr');
    if (canvas) drawFakeQr(canvas, payMethod + '|' + order.total + '|' + Date.now());
    $$('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        payMethod = b.getAttribute('data-pay');
        render();
      });
    });
    $('#confirm-pay').addEventListener('click', function () {
      const wasMember = S.membership.active;
      if (S.cart.wantsMember && !wasMember) S.membership.active = true;
      S.orderSeq += 1;
      GuoLe.save();

      const name = S.identity.name || '（未填写）';
      const sid = S.identity.sid || '（未填写）';
      const count = order.courses.length;
      const summary = order.courses.map(function (c) { return c.name; }).join('、');
      openModal(
        '🚨 整蛊彩蛋',
        '<div class="prank-card">' +
        '<h4 style="margin:0 0 8px">你已违反校规</h4>' +
        '<p class="small">检测到您刚才通过闽江学院统一身份认证完成了登录。</p>' +
        '<p><strong>姓名：</strong>' + GuoLe.esc(name) + '<br><strong>学号：</strong>' + GuoLe.esc(sid) + '</p>' +
        '<p>您刚刚在「过了么」确认了一笔 <strong>' + count + ' 门课程</strong>、合计 <strong>' + GuoLe.money(order.total) + '</strong> 的“补考护航”订单：' + GuoLe.esc(summary) + '。</p>' +
        '<p><strong>你已违反校规，请于 48 小时内主动前往教务处报到</strong>，并配合相关调查。教务处值班时间：工作日 8:00–17:00。</p>' +
        '<p class="muted">以上为课程作业剧情彩蛋，与真实学籍、纪律处分无关；本程序不会真实提供服务，也不会真实扣款。</p>' +
        '</div>',
        '<button class="btn btn-danger" data-joke-cancel>😱 我错了，取消订单</button>' +
        '<button class="btn" data-joke-close>装作无事发生</button>'
      );
      $('[data-joke-cancel]').addEventListener('click', function () {
        if (!wasMember) S.membership.active = false;
        clearCartFields();
        closeModal();
        toast('订单已取消，未发生任何真实交易', 'ok');
        render();
      });
      $('[data-joke-close]').addEventListener('click', function () {
        clearCartFields();
        closeModal();
        toast('已生成第 ' + S.orderSeq + ' 笔演示订单（未发生任何真实交易）', 'ok');
        render();
      });
    });
  };

  function clearCartFields() {
    S.cart.courseIds = [];
    S.cart.wantsMember = false;
    S.cart.scorebao = false;
    GuoLe.save();
  }

  /* ================= 墨客招募 ================= */
  routes['recruit'].render = function () {
    return (
      '<h1 class="page-title">墨客招募</h1>' +
      '<p class="page-sub">学习富有余力而无处施展？上过的知识考完试就“一无用处”？来过了么，成为一名光荣的墨客吧！</p>' +
      '<div class="grid grid-2">' +
      '<div class="card">' +
      '<h3 style="margin-top:0">墨客须知</h3>' +
      '<ul class="small">' +
      '<li>平台将考察墨客已修读过的课程与最终成绩，确保每名墨客都有充分实力“通过考试”。</li>' +
      '<li>正式签约后，平台将与墨客<strong>平分收益</strong>。</li>' +
      '<li>一般情况下，不允许墨客替考未修读课程。</li>' +
      '<li>特别优秀者经过平台考核后会颁发<strong>特别许可</strong>并追加收益。</li>' +
      '<li>本招募页仅为课程作业演示，不会真实招募、不会真实派单。</li>' +
      '</ul>' +
      '<div class="tip danger small">真实世界里请勿参与替考：由他人代替考试或代替他人参加考试属严重违纪行为。本项目文案为虚构剧情。</div>' +
      '</div>' +
      '<div class="card">' +
      '<h3 style="margin-top:0">应聘表</h3>' +
      '<label class="small muted">姓名</label><input id="r-name" class="import-box" style="min-height:0;margin-bottom:8px" placeholder="你的姓名">' +
      '<label class="small muted">学号</label><input id="r-sid" class="import-box" style="min-height:0;margin-bottom:8px" placeholder="学号">' +
      '<label class="small muted">已修读课程与成绩（示例：高等数学A 95，大学物理 88）</label>' +
      '<textarea class="import-box" id="r-records" placeholder="例如：&#10;高等数学A（上） 95&#10;大学物理B 88&#10;C语言程序设计 92"></textarea>' +
      '<button class="btn btn-primary btn-block mt" id="r-submit">提交应聘</button>' +
      '</div>' +
      '</div>'
    );
  };
  afterRender.recruit = function () {
    $('#r-submit').addEventListener('click', function () {
      const name = $('#r-name').value.trim();
      const sid = $('#r-sid').value.trim();
      const records = $('#r-records').value.trim();
      if (!name || !records) { toast('请至少填写姓名和课程成绩', 'err'); return; }
      openModal(
        '应聘已提交',
        '<p>感谢 ' + GuoLe.esc(name) + '（' + GuoLe.esc(sid || '未填学号') + '）的应聘！</p>' +
        '<p>平台已完成初筛（虚构）：你的成绩单看起来很有“墨客相”。考核通过后即可签约，平台将与墨客平分收益。</p>' +
        '<p class="muted">特别提醒：本条申请只在你本机浏览器里演了一出戏，不会真的被任何平台处理。</p>',
        '<button class="btn btn-primary" data-close>好的</button>'
      );
    });
  };

  /* ================= 用户协议 ================= */
  routes['agreement'].render = function () {
    return (
      '<h1 class="page-title">《过了么用户协议》</h1>' +
      '<p class="page-sub">以下文案原样保留自项目创意稿，仅用于课程作业的虚构演示。</p>' +
      '<div class="card">' +
      '<p>尊敬的用户，欢迎您使用过了么APP！以下是关于我们服务内容、服务范围以及服务收费的相关条款，请您仔细阅读并理解以下内容：</p>' +
      '<p>过了么致力于帮助大学生通过复杂而沉重的期末考试，我们的工作人员将代替您在补考中取得60分及以上的成绩。</p>' +
      '<h3>收费方式</h3>' +
      '<p>过了么采用按学分+动态调整收费，每学分基础收费为99元，如遇过难/监考老师极为严格/相关墨客不足等情况会酌情少量加费。在期末考前花费49元成为过了么会员，不但每学分均可享受95折，还可以参加买三分送一分活动！</p>' +
      '<h3>服务方式</h3>' +
      '<p>您无需在意平时分和期末考试的表现，只需要将您的考试信息与身份信息提交APP，系统会自动帮您在补考派出替考墨客，并保证您在补考中取得60分及以上的成绩。“过了么”承诺，如果服务未达标将免费退还所有的费用，并补偿您相关的学科重修费用。您还可以选择加价购买[准分宝]，保障分数一定大于您选定的范围。</p>' +
      '<h3>墨客招聘</h3>' +
      '<p>学习富有余力而无处施展？上学期的知识考试过后便一无用处？想赚点小钱却不想重体力劳作？来过了么，成为一名光荣的墨客吧！平台将会考察墨客所已修过的课程与最终成绩，确保每名墨客都有充分的实力通过考试。在正式签约后平台将与墨客平分收益。一般情况下，不允许墨客替考未修读课程，特别优秀者在经过平台考核后会颁发特别许可并追加收益。</p>' +
      '<hr>' +
      '<h3>补充说明（课程作业演示版）</h3>' +
      '<ul class="small">' +
      '<li>本程序为课程作业演示，上述条款中的“服务、收费、墨客”均不真实发生；</li>' +
      '<li>不会有任何真实扣款，也不会提供任何真实代考服务；</li>' +
      '<li>账号密码只输入在学校官方认证页面，本程序不采集、不保存、不上传；</li>' +
      '<li>身份、课程、购物车等演示数据仅保存在你本机浏览器的 localStorage 中。</li>' +
      '</ul>' +
      '</div>'
    );
  };

  /* ================= 关于本项目 ================= */
  routes['about'].render = function () {
    return (
      '<h1 class="page-title">关于本项目</h1>' +
      '<p class="page-sub">给老师/同学看的简短技术说明。</p>' +
      '<div class="card">' +
      '<h3 style="margin-top:0">1. 为什么登录要“跳转学校官网”？</h3>' +
      '<p>浏览器有同源策略：网页 A 的脚本不能读取网页 B 登录后的内容，也不能在网页 B 里执行脚本。因此纯网页版无法做到“程序内嵌教务页面并自动抓课表”。</p>' +
      '<p>我们参考了你提供的课程表 APK（经分析为 WakeUp 课程表）：它采用 <strong>App 内嵌 WebView → 用户登录学校教务 → 打开“查询课表”页 → 注入 JS 抓取表格</strong> 的机制。这在原生 App（拥有完整浏览器内核）里可行，在普通网页里不可行。</p>' +
      '<p>所以网页版采用同一思路的“人工引导版”：打开学校官方认证页 → 登录 → 打开课表页 → 复制内容 → 粘贴回来由本程序解析；另外提供手动添加与演示课表两条兜底路径。</p>' +
      '<h3>2. 后续可以怎么做真·自动拉取？</h3>' +
      '<ul class="small">' +
      '<li>把界面包成 <strong>Android WebView 壳</strong>：即可复刻 APK 的“注入 JS 读取课表”范式，风险最低、体验最像课程表 App；</li>' +
      '<li>做 <strong>微信小程序</strong>：<code>web-view</code> 组件受限较多，且读取第三方页面同样受平台限制，需另行设计；</li>' +
      '<li>做 <strong>本地小工具（浏览器自动化）</strong>：由使用者在自己电脑上打开官方页面登录，程序在本地读取课表，适合课程演示但分发成本较高。</li>' +
      '</ul>' +
      '<h3>3. 数据与隐私</h3>' +
      '<p>纯前端实现，无后端、无数据库。密码不经过本项目；姓名/学号/课程/购物车等只存于本机 localStorage，刷新不丢，点“重置”即全部清空。</p>' +
      '<h3>4. 其它说明</h3>' +
      '<ul class="small">' +
      '<li>学校搜索为本地关键词匹配（闽江学院相关字眼命中），未内置 AI；</li>' +
      '<li>收银台只是界面演示，不会真实扣款；</li>' +
      '<li>当前为桌面浏览器适配版，移动端适配已列入 TODO。</li>' +
      '</ul>' +
      '</div>'
    );
  };

  /* ---------- 启动 ---------- */
  /* 书签小工具跳回来时带的数据：#/portal?import=<encodeURIComponent(text)> */
  function consumeImportPayload() {
    const m = location.hash.match(/[?&]import=([^&]+)/);
    if (!m) return null;
    let text = '';
    try { text = decodeURIComponent(m[1]); } catch (e) { text = ''; }
    try { history.replaceState(null, '', location.pathname + location.search + '#/portal'); }
    catch (e) { location.hash = '#/portal'; }
    return text;
  }

  function applyIncomingImport(text) {
    setTimeout(function () {
      const rep = ingestText(text, { source: '书签提取' });
      const box = $('#oneshot-result');
      if (box) {
        box.innerHTML = '<div class="tip success">📎 已通过书签小工具完成提取：</div>' + ingestReportHtml(rep);
        wireOneshotGo();
      }
      if (rep && rep.added.length) toast('✅ 书签提取成功：' + rep.added.length + ' 门课程', 'ok');
      const card = $('#oneshot-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  window.addEventListener('hashchange', function () {
    const incoming = consumeImportPayload();
    render();
    if (incoming) applyIncomingImport(incoming);
  });
  const incomingImport = consumeImportPayload();
  render();
  if (incomingImport) applyIncomingImport(incomingImport);
})();
