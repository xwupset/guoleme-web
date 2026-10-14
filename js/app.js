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

  function sanitizeCart() {
    const ids = new Set(S.courses.map(function (c) { return c.id; }));
    S.cart.courseIds = S.cart.courseIds.filter(function (id) { return ids.has(id); });
    if (S.membership.active) S.cart.wantsMember = false;
  }

  function setCourses(courses) {
    S.courses = courses.map(function (c) {
      return {
        id: c.id || GuoLe.newCourseId(),
        name: String(c.name || '').trim(),
        category: c.category || '',
        source: c.source || '手动添加',
        teacher: c.teacher || '',
        weeks: c.weeks || ''
      };
    }).filter(function (c) { return c.name; });
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
      '<div class="cc-sub">' + GuoLe.esc(c.category || '未分类') +
      (c.teacher ? ' · ' + GuoLe.esc(c.teacher) : '') +
      ' · 来源：' + GuoLe.esc(c.source || '手动') + '</div>' +
      '</div></div>' +
      '<div class="cc-sub">🧐 ' + GuoLe.esc(pr.diff.tag) + '：' + GuoLe.esc(pr.diff.reason) + '</div>' +
      '<div class="price-line">' +
      '<div><span class="price">' + GuoLe.money(pr.subtotal) + '</span> <span class="unit">/ 门</span></div>' +
      '<button class="btn btn-ghost" data-del-course="' + c.id + '" title="从课表中移除">移除</button>' +
      '</div></div>'
    );
  }

  /* ---------- 路由定义 ---------- */
  const routes = {
    '': { title: '首页', needSchool: false },
    'school': { title: '选择学校', needSchool: false },
    'portal': { title: '身份认证与课表导入', needSchool: true },
    'import': { title: '导入课表', needSchool: false },
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

  /* 记录上一次渲染的路由，用来判断「是不是真的换页了」 */
  let lastRenderedPath = null;

  function render() {
    const p = currentPath();

    /* 演示直达：一键铺好数据，再走正常页面（教学演示/自动化测试用） */
    const demoMap = {
      'demo-portal': { next: '#/portal', fillCart: false },
      'demo-menu': { next: '#/menu', fillCart: false },
      /* 收银台已与购物车合并，这两个都指向 #/cart */
      'demo-cart': { next: '#/cart', fillCart: true },
      'demo-checkout': { next: '#/cart', fillCart: true }
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
    /* 只有「真的换了页」才滚到顶部。
       勾选课程 / 勾选准分宝 这类操作也会调 render() 重建整页，
       如果每次都滚回顶部，用户往下滚着挑课就会被反复弹回最上面。 */
    if (lastRenderedPath !== p) window.scrollTo(0, 0);
    lastRenderedPath = p;
    afterRender[routeKey(p)] && afterRender[routeKey(p)]();
  }

  function routeKey(p) { return p || 'home'; }
  const afterRender = {};

  /* ================= 首页 ================= */
  routes[''].render = function () {
    return (
      '<section class="hero">' +
      '<span class="kicker">课程作业 · 校园内测体验版</span>' +
      '<h1>期末考试！稳了！<br>过了么，一单到手 🎯</h1>' +
      '<p>选学校、认证、导入本学期课表、像点外卖一样下单——「过了么」把“期末护航”做成了一份随手可点的菜单。这是一个界面完整、剧情整蛊的课程作业项目。</p>' +
      '<div class="btn-row"><a class="btn hero-cta" href="#/school">🚀 开始体验</a></div>' +
      '</section>' +

      '<h2 class="section-title">我们提供的服务<span class="line"></span></h2>' +
      '<p class="small muted" style="margin:-4px 0 12px">点下面任意一项，直接开始体验 →</p>' +
      '<div class="grid">' +
      '<a class="card feature feature-link" href="#/school"><div class="ico">📚</div><h3>期末护航</h3><p>承诺期末考 ≥ 60 分；未达标“全额退费 + 补偿重修费”。</p></a>' +
      '<a class="card feature feature-link" href="#/school"><div class="ico">💰</div><h3>按门计费</h3><p>每门课 ¥' + CFG.COURSE_FEE + ' 起，难课/严师酌情少量加价，明码标价不玩套路。</p></a>' +
      '<a class="card feature feature-link" href="#/school"><div class="ico">🛡️</div><h3>准分宝</h3><p>加价锁定 ≥ 80 / 85 / 90 / 95 的分数范围，买一份安心。</p></a>' +
      '<a class="card feature feature-link" href="#/school"><div class="ico">🎓</div><h3>会员 ' + CFG.MEMBER_FEE + ' 元/学期</h3><p>95 折，还送“买三送一”：每选满 4 门免 1 门。</p></a>' +
      '</div>' +

      '<h2 class="section-title">一次完整的使用流程<span class="line"></span></h2>' +
      '<div class="card steps">' +
      '<div class="step"><h3>选择学校</h3><p>当前演示版只适配了闽江学院，点一下就能进入，其它学校会提示“未适配”。</p></div>' +
      '<div class="step"><h3>一键打开教务系统</h3><p>我们直接把你送到教务系统，照着图文指引导出课表 PDF。</p></div>' +
      '<div class="step"><h3>导入课表</h3><p>把导出的 PDF 交给本程序，课程和你的姓名学号会自动填好。</p></div>' +
      '<div class="step"><h3>选课下单</h3><p>像饿了么一样勾选课程，享受会员优惠。</p></div>' +
      '<div class="step"><h3>扫码结算</h3><p>微信/支付宝二选一，点“确认付款”后有整蛊彩蛋等你 🥚。</p></div>' +
      '</div>' +

      '<h2 class="section-title">学校支持<span class="line"></span></h2>' +
      '<div class="card school-result">' +
      '<p class="school-name">🏫 闽江学院</p>' +
      '<p class="school-meta">当前唯一适配学校 · 支持一键导入课表</p>' +
      '<div class="btn-row"><a class="btn btn-primary" href="#/school">选择学校开始 →</a>' +
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

  /* 选中闽江学院并直接进入下一步（不再出现二级确认） */
  function pickMju(from) {
    S.school = { id: CFG.SCHOOL.id, name: CFG.SCHOOL.name };
    GuoLe.save();
    toast('已选择：闽江学院', 'ok');
    go(from || '#/portal');
  }

  routes['school'].render = function () {
    const sc = CFG.SCHOOL;
    return (
      '<h1 class="page-title">选择学校</h1>' +
      '<p class="page-sub">当前演示版只适配了 <strong>' + GuoLe.esc(sc.name) + '</strong>，点下面的按钮直接进入。</p>' +

      /* 主角：超大的直接进入按钮 */
      '<button class="school-pick" id="pick-mju-big">' +
      '<span class="school-pick-logo">🏫</span>' +
      '<span class="school-pick-body">' +
      '<span class="school-pick-name">' + GuoLe.esc(sc.name) + '</span>' +
      '<span class="school-pick-meta">福建福州 · 已适配 · 支持一键导入课表</span>' +
      '</span>' +
      '<span class="school-pick-go">进入 →</span>' +
      '</button>' +

      /* 次要：搜索其它学校（目前都会提示未适配） */
      '<div class="card">' +
      '<h3 style="margin-top:0">搜索其它学校</h3>' +
      '<p class="small muted">演示版采用本地关键词匹配，不接入 AI。目前只有闽江学院适配，搜其它学校会提示未适配。</p>' +
      '<div class="school-search">' +
      '<input id="school-q" type="search" placeholder="输入学校名称，例如：闽江学院" autocomplete="off">' +
      '<button class="btn btn-primary" id="school-go">搜索</button>' +
      '</div>' +
      '<div class="muted">💡 常见输入：<button class="btn btn-ghost" data-fill="闽江学院">闽江学院</button> <button class="btn btn-ghost" data-fill="闽江大学">闽江大学</button> <button class="btn btn-ghost" data-fill="闽">闽</button> <button class="btn btn-ghost" data-fill="江">江</button></div>' +
      '<div id="school-result" style="margin-top:16px"></div>' +
      '</div>' +
      '<div class="btn-row mt"><a class="btn" href="' + sc.officialUrl + '" target="_blank" rel="noopener">访问学校官网 ↗</a></div>'
    );
  };
  afterRender.school = function () {
    const input = $('#school-q');
    const resultBox = $('#school-result');

    /* 大按钮：一步进入，不再二次确认 */
    $('#pick-mju-big').addEventListener('click', function () { pickMju(); });

    function search() {
      const q = input.value;
      if (!q.trim()) {
        resultBox.innerHTML = '<div class="empty"><div class="big">🔍</div>输入学校名称开始搜索</div>';
        return;
      }
      if (schoolMatched(q)) {
        /* 命中闽江学院 —— 直接进，不再二次确认 */
        pickMju();
      } else {
        resultBox.innerHTML =
          '<div class="card school-miss">' +
          '<h3 style="margin:0 0 6px">😢 未找到或未适配</h3>' +
          '<p style="margin:0">没有找到“' + GuoLe.esc(q.trim()) + '”对应的适配版本。<br>演示版目前仅支持 <strong>' + GuoLe.esc(CFG.SCHOOL.name) + '</strong>；其它学校将在后续版本按需适配。</p>' +
          '<div class="btn-row mt"><button class="btn btn-primary" id="miss-pick-mju">那就选闽江学院 →</button></div>' +
          '</div>';
        $('#miss-pick-mju').addEventListener('click', function () { pickMju(); });
      }
    }

    $('#school-go').addEventListener('click', search);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    $$('[data-fill]').forEach(function (b) {
      b.addEventListener('click', function () { input.value = b.getAttribute('data-fill'); search(); });
    });
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
    box.innerHTML = '<p class="small muted">已导入 ' + S.courses.length + ' 门课程：</p>' +
      S.courses.map(function (c) {
        return '<div class="cart-line"><span class="l-name">' + GuoLe.esc(c.name) + '</span><span><button class="btn btn-ghost" data-del-import="' + c.id + '">✕</button></span></div>';
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
      if (!c || !c.name) return;
      if (existing.has(c.name)) return;
      existing.add(c.name);
      const item = {
        id: GuoLe.newCourseId(),
        name: c.name,
        category: c.category || '',
        source: source || '一键读取',
        teacher: c.teacher || '',
        weeks: c.weeks || ''
      };
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

  function renderPortal() {
    const sc = CFG.SCHOOL;
    const hasCourses = S.courses.length > 0;
    return (
      '<h1 class="page-title">身份认证与课表导入</h1>' +
      '<p class="page-sub">当前学校：<strong>' + GuoLe.esc(S.school ? S.school.name : sc.name) + '</strong></p>' +

      /* 第一步：先把攻略讲清楚，再放按钮 ——
         否则用户点完按钮就跳走了，后面几步永远看不到。 */
      '<div class="card imp-primary" id="open-jw-card">' +
      '<h3 style="margin-top:0">🌐 第一步：登录教务系统</h3>' +
      '<p class="small muted">先花 10 秒看完下面<strong>三步</strong>再点按钮，免得登录进去以后找不到路。</p>' +
      '<ol class="jw-steps">' +
      '<li>点开页面<strong>右上角</strong>的菜单按钮' +
      '<span class="jw-icon-line">' +
      '<span class="jw-icon-demo" aria-label="右上角菜单按钮">' +
      '<span class="jw-icon-bar"></span><span class="jw-icon-bar"></span><span class="jw-icon-bar"></span>' +
      '</span>' +
      '<span class="jw-icon-note">← 就是这个</span>' +
      '</span></li>' +
      '<li>依次点击 <strong>信息查询</strong> → <strong>个人课表查询</strong></li>' +
      '<li>点页面上的<strong>输出 PDF</strong> 按钮，把课表存到手机里</li>' +
      '</ol>' +
      '<div class="jw-return">看完上面三步，再点这里去登录：</div>' +
      '<a class="btn btn-primary btn-block btn-xl" href="' + (sc.authUrl || sc.jwUrl) + '" target="_blank" rel="noopener" id="open-jw">🚀 统一身份认证登录 ↗</a>' +
      '<p class="small muted mt">按钮会直达闽江学院的<strong>统一身份认证</strong>页面，用学号密码登录（密码只交给学校系统）。登录成功后会直接进入<strong>教学管理信息服务平台</strong>。</p>' +
      '<div class="tip">🔐 本程序<strong>不接触、不保存、不上传你的密码</strong>。</div>' +
      '<div class="tip success">💡 <strong>导完课表记得回到本页</strong> —— 切回来时我们会自动提醒你进入下一步。</div>' +
      '</div>' +

      /* 第二步：去导入（切回来会高亮这一块） */
      '<div class="card" id="go-import-card">' +
      '<h3 style="margin-top:0">📥 第二步：把刚下载的课表导进来</h3>' +
      '<p class="small muted">导入时会<strong>自动识别你的姓名和学号</strong>，你只需要核对课程。</p>' +
      '<a class="btn btn-primary btn-block btn-xl" href="#/import" id="go-import">去导入课表 →</a>' +
      (hasCourses
        ? '<p class="small ok-text mt">✓ 当前已导入 ' + S.courses.length + ' 门课程</p>'
        : '<p class="small muted mt">还没有导入任何课程。</p>') +
      '</div>' +

      '<div class="card" id="verify-card">' +
      '<h3 style="margin-top:0">🔐 安全验证（必填）</h3>' +
      '<p class="small muted">请填写你的<strong>真实姓名</strong>与<strong>学号</strong>。' +
      '如果刚才在导入页上传了课表 PDF，<strong>这两项已经自动填好了</strong>。' +
      '信息只保存在你自己的浏览器里（localStorage），不会上传到任何服务器。</p>' +
      '<div class="verify-grid">' +
      '<label><span>姓名 <b class="req">*</b></span><input id="id-name" autocomplete="off" placeholder="请输入姓名"></label>' +
      '<label><span>学号 <b class="req">*</b></span><input id="id-sid" autocomplete="off" inputmode="numeric" placeholder="请输入学号"></label>' +
      '</div>' +
      '<div class="verify-hint bad" id="identity-status"></div>' +
      '<p class="small muted">鼠标离开输入框就会<strong>自动保存</strong>，不需要点任何按钮。</p>' +
      '</div>' +

      '<div class="card">' +
      '<details>' +
      '<summary style="cursor:pointer">🛠 手动添加 / 载入演示课表（没网或演示时用）</summary>' +
      '<div style="margin-top:12px">' +
      '<div class="btn-row"><button class="btn btn-warn" id="load-demo">🎒 载入演示课表（7 门）</button>' +
      '<button class="btn btn-danger" id="clear-courses">清空已导入课程</button></div>' +
      '<hr>' +
      '<div class="manual-row"><input id="m-name" placeholder="课程名称，如：高等数学A"><button class="btn" id="m-add">添加</button></div>' +
      '<div id="imported-list"></div>' +
      '</div></details>' +
      '</div>' +

      '<div class="btn-row mt"><button class="btn btn-primary btn-lg" id="to-menu">📋 保存并进入选课菜单</button></div>'
    );
  }

  routes['portal'].render = renderPortal;
  afterRender.portal = function () {
    syncIdentityInputs();
    renderImportedList();

    /* 「一键打开教务系统」→ 记录我们把人送出去了，
       等他回来（visibilitychange）就把「去导入课表」高亮出来。 */
    const openJw = $('#open-jw');
    if (openJw) {
      openJw.addEventListener('click', function () {
        try { sessionStorage.setItem('glm_left_for_jw', '1'); } catch (e) { /* 隐私模式忽略 */ }
      });
    }

    /* 安全验证：离开输入框（blur）即自动保存 */
    ['id-name', 'id-sid'].forEach(function (id) {
      const el = $('#' + id);
      if (!el) return;
      el.addEventListener('blur', function () { commitIdentity(); });
      el.addEventListener('change', function () { commitIdentity(); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); });
    });

    /* 方法 A/B：演示课表 / 手动添加 / 清空（导课页折叠区里） */
    if ($('#load-demo')) $('#load-demo').addEventListener('click', function () {
      openModal(
        '载入演示课表？',
        '<p>将用 7 门示例课程替换当前已导入课程，方便课堂演示与完整流程体验。</p>',
        '<button class="btn btn-primary" data-ok>载入</button><button class="btn" data-close>取消</button>'
      );
      $('[data-ok]').addEventListener('click', function () {
        setCourses(GuoLe.demoCourses());
        closeModal(); renderImportedList();
        toast('已载入演示课表（7 门）', 'ok');
      });
    });

    if ($('#clear-courses')) $('#clear-courses').addEventListener('click', function () {
      setCourses([]);
      renderImportedList();
      toast('已清空课程');
    });

    if ($('#m-add')) $('#m-add').addEventListener('click', function () {
      const name = $('#m-name').value.trim();
      if (!name) { toast('请填写课程名称', 'err'); return; }
      const added = mergeCourses([{ name: name }], '手动添加');
      $('#m-name').value = '';
      renderImportedList();
      toast(added.length ? '已添加：' + name : '该课程已在课表中', added.length ? 'ok' : 'err');
    });

    /* 回到本页：把「去导入课表」高亮出来。
       纯网页能感知「用户切走了又切回来」—— 用 document.visibilityState。 */
    function highlightImportCard() {
      const card = document.getElementById('go-import-card');
      if (!card) return;
      card.classList.add('flash-import');
      const btn = document.getElementById('go-import');
      if (btn) {
        btn.classList.add('pulse');
        try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
      }
      toast('课表下载好了吗？点「去导入课表」就能导入 →', 'ok');
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      let left = false;
      try { left = sessionStorage.getItem('glm_left_for_jw') === '1'; } catch (e) { left = false; }
      if (!left) return;
      try { sessionStorage.removeItem('glm_left_for_jw'); } catch (e) { /* ignore */ }
      // 稍等一下再做高亮，避免和浏览器恢复页面打架
      setTimeout(highlightImportCard, 400);
    }
    /* 每次进本页都会重新绑定，先把上一轮的摘掉，避免监听器堆积 */
    if (window.__glmVisHandler) {
      document.removeEventListener('visibilitychange', window.__glmVisHandler);
      window.removeEventListener('focus', window.__glmVisHandler);
    }
    window.__glmVisHandler = onVisible;
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

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
  /* ================= 导入课表（手机优先，见 js/importui.js） ================= */
  routes['import'].render = function () {
    if (window.GuoLeImportUI) return window.GuoLeImportUI.render();
    return '<div class="card empty"><div class="big">📥</div><p>导入模块未加载。</p></div>';
  };
  afterRender.import = function () {
    if (window.GuoLeImportUI) window.GuoLeImportUI.mount();
  };

  /* ================= 选课菜单 ================= */
  routes['menu'].render = function () {
    const memberOn = S.membership.active || S.cart.wantsMember;
    const sel = S.courses.filter(function (c) { return S.cart.courseIds.includes(c.id); });
    const selMoney = GuoLe.round2(sel.reduce(function (s, c) { return s + GuoLe.coursePricing(c).subtotal; }, 0));
    let body;
    if (!S.courses.length) {
      body = '<div class="card empty"><div class="big">🎒</div><p>还没有导入课程。</p><a class="btn btn-primary" href="#/portal">去导入课表 →</a></div>';
    } else {
      body = '<div class="grid">' + S.courses.map(courseCardHtml).join('') + '</div>' +
        '<div class="sticky-bar"><div class="info">已选 <b>' + S.cart.courseIds.length + '</b> 门 · 小计 ' + GuoLe.money(selMoney) + '</div>' +
        '<div class="btn-row"><a class="btn btn-primary" href="#/cart">去结算 →</a></div></div>';
    }
    return (
      '<h1 class="page-title">选课菜单</h1>' +
      '<p class="page-sub">' + GuoLe.esc(S.school ? S.school.name : '') + ' · ' + GuoLe.esc(S.identity.name || '未填写姓名') + '（' + GuoLe.esc(S.identity.sid || '未填写学号') + '） · 共 ' + S.courses.length + ' 门课</p>' +
      '<div class="card tip">' +
      '<strong>计费规则：</strong>每门课 ¥' + CFG.COURSE_FEE + '；难度大/背诵量大的课程会酌情加价并注明原因。<br>' +
      (memberOn
        ? '<span class="ok-text">✓ 会员已生效：95 折 + 买三送一</span>'
        : '<a href="#/cart">还不是会员？结算时 ' + CFG.MEMBER_FEE + ' 元开通，享 95 折 + 买三送一 →</a>') +
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

  /* ================= 购物车 + 收银台（合并为一页） ================= */
  routes['cart'].render = function () {
    const order = GuoLe.calcOrder(S);
    const scoreOptions = GuoLe.scoreBaoOptions();
    if (!S.cart.courseIds.length) {
      return '<h1 class="page-title">结算</h1>' +
        '<div class="card empty"><div class="big">🛒</div><p>还没有选课。</p>' +
        '<a class="btn btn-primary" href="#/menu">去选课菜单逛逛 →</a></div>';
    }

    const isWechat = payMethod === 'wechat';
    const payTitle = isWechat ? '微信支付' : '支付宝';

    return (
      '<h1 class="page-title">结算</h1>' +
      '<p class="page-sub">第 ' + (S.orderSeq + 1) + ' 笔订单 · 不会真实扣款</p>' +

      /* ① 已选课程 */
      '<div class="card">' +
      '<h3 style="margin-top:0">已选课程（' + order.count + ' 门）</h3>' +
      S.cart.courseIds.map(function (id) {
        const c = S.courses.find(function (x) { return x.id === id; });
        if (!c) return '';
        const pr = GuoLe.coursePricing(c);
        return '<div class="cart-line"><span class="l-name">' + GuoLe.esc(c.name) + '</span>' +
          '<span>' + GuoLe.money(pr.subtotal) +
          ' <button class="btn btn-ghost" data-cart-del="' + c.id + '">✕</button></span></div>';
      }).join('') +
      '<a class="btn btn-ghost small mt" href="#/menu">＋ 继续选课</a>' +
      '</div>' +

      /* ② 会员 / 准分宝：并排两小格，省空间 */
      '<div class="opt-grid">' +
      '<label class="opt-cell' + (S.membership.active || S.cart.wantsMember ? ' on' : '') + '">' +
      '<span class="opt-ico">🎓</span>' +
      '<span class="opt-name">' + (S.membership.active ? '会员已生效' : '开通会员') + '</span>' +
      '<span class="opt-desc">' + (S.membership.active
        ? '本单已享 95 折 + 买三送一'
        : '¥' + CFG.MEMBER_FEE + ' / 学期<br>95 折 + 买三送一') + '</span>' +
      (S.membership.active
        ? '<span class="tag tag-success">已生效</span>'
        : '<input type="checkbox" id="member-box"' + (S.cart.wantsMember ? ' checked' : '') + '>') +
      '</label>' +

      '<label class="opt-cell' + (S.cart.scorebao ? ' on' : '') + '">' +
      '<span class="opt-ico">🛡️</span>' +
      '<span class="opt-name">准分宝</span>' +
      '<span class="opt-desc">' + (S.cart.scorebao
        ? '目标 ≥ ' + S.cart.scoreTarget + ' 分'
        : '加价锁定更高分数') + '</span>' +
      '<input type="checkbox" id="score-box"' + (S.cart.scorebao ? ' checked' : '') + '>' +
      '</label>' +
      '</div>' +

      (S.cart.scorebao
        ? '<div class="card"><h3 style="margin-top:0">🛡️ 准分宝目标分数</h3>' +
          '<select id="score-target" class="full-select">' +
          scoreOptions.map(function (o) {
            return '<option value="' + o.target + '"' + (S.cart.scoreTarget === o.target ? ' selected' : '') + '>目标 ≥ ' + o.target + ' 分（每门 +¥' + o.feePerCourse + '）</option>';
          }).join('') + '</select></div>'
        : '') +

      /* ③ 订单明细 */
      '<div class="card">' +
      '<h3 style="margin-top:0">订单明细</h3>' +
      '<div class="cart-line"><span class="l-name">课程费用（' + order.count + ' 门 × ¥' + CFG.COURSE_FEE + ' 起）</span><span>' + GuoLe.money(order.rawTotal) + '</span></div>' +
      (order.isMember
        ? '<div class="cart-line"><span class="l-name">会员 95 折</span><span class="ok-text">− ' + GuoLe.money(order.memberDiscount) + '</span></div>' +
          (order.freeCount > 0
            ? '<div class="cart-line"><span class="l-name">买三送一（免 ' + order.freeCount + ' 门）</span><span class="ok-text">− ' + GuoLe.money(order.buy3Value) + '</span></div>'
            : '<div class="cart-line"><span class="l-name">买三送一</span><span class="muted">再选满 ' + (4 - order.count % 4) + ' 门即可免 1 门</span></div>')
        : '') +
      (order.memberFeeNeeded ? '<div class="cart-line"><span class="l-name">会员费（本次一并开通）</span><span>' + GuoLe.money(CFG.MEMBER_FEE) + '</span></div>' : '') +
      (order.scorebao ? '<div class="cart-line"><span class="l-name">准分宝（目标 ≥ ' + order.scoreTarget + '）</span><span>' + GuoLe.money(order.scorebaoFee) + '</span></div>' : '') +
      '<div class="total-line flex-between"><span>应付合计</span><span class="amount">' + GuoLe.money(order.total) + '</span></div>' +
      (identityDone()
        ? '<div class="tip small"><strong>已绑定身份：</strong>' + GuoLe.esc(S.identity.name) + ' · ' + GuoLe.esc(S.identity.sid) + '</div>'
        : '<div class="tip warn small"><strong>尚未完成安全验证：</strong><a href="#/portal">去填写姓名与学号 →</a></div>') +
      '</div>' +

      /* ④ 付款方式 + 二维码 + 确认付款 */
      '<div class="card">' +
      '<h3 style="margin-top:0">扫码付款</h3>' +
      '<div class="pay-tabs">' +
      '<button class="pay-tab' + (isWechat ? ' active' : '') + '" data-pay="wechat">💚 微信支付</button>' +
      '<button class="pay-tab' + (!isWechat ? ' active' : '') + '" data-pay="alipay">💙 支付宝</button>' +
      '</div>' +
      '<div class="qrcode-wrap">' +
      '<canvas class="qrcode-canvas" id="pay-qr" width="180" height="180"></canvas>' +
      '<p class="qrcode-hint">' + GuoLe.esc(payTitle) + ' · 演示金额 <strong>' + GuoLe.money(order.total) + '</strong><br>（示意二维码，不会真实跳转）</p>' +
      '</div>' +
      '<div class="tip warn" style="text-align:center">本页面不会真正扣款，请放心点击。</div>' +
      '<button class="btn btn-success btn-lg btn-block" id="confirm-pay">✅ 确认付款 ' + GuoLe.money(order.total) + '</button>' +
      '<p class="muted small" style="text-align:center">点击后会出现“整蛊彩蛋”，全程没有真实支付。</p>' +
      '</div>' +

      '<div class="card tip mt"><strong>服务承诺：</strong>如果服务未达标，免费退还全部费用，并补偿相关学科重修费用。还可加价购买“准分宝”，保障分数大于你选定的范围。</div>'
    );
  };
  afterRender.cart = function () {
    /* 二维码 */
    const order = GuoLe.calcOrder(S);
    const canvas = $('#pay-qr');
    if (canvas) drawFakeQr(canvas, payMethod + '|' + order.total + '|' + Date.now());

    /* 支付方式 */
    $$('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        payMethod = b.getAttribute('data-pay');
        render();
      });
    });

    /* 移除课程 */
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

    wireConfirmPay(order);
  };

  /* 两个入口共用（旧的 #/checkout 也走这里） */
  afterRender.checkout = function () {
    afterRender.cart();
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

  /* 旧的收银台已与购物车合并，这里只做重定向（保留老链接可用） */
  routes['checkout'].render = function () {
    return '<div class="card empty"><div class="big">🧾</div>' +
      '<p>结算已合并到同一页。</p><a class="btn btn-primary" href="#/cart">前往结算 →</a></div>';
  };

  /* ================= 确认付款 + 整蛊彩蛋 ================= */
  function wireConfirmPay(order) {
    const btn = $('#confirm-pay');
    if (!btn) return;
    btn.addEventListener('click', function () {
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
        '<h4 class="prank-title">你已违反校规</h4>' +
        '<p><strong>姓名：</strong>' + GuoLe.esc(name) + '<br><strong>学号：</strong>' + GuoLe.esc(sid) + '</p>' +
        '<p>您刚刚在「过了么」确认了一笔 <strong>' + count + ' 门课程</strong>、合计 <strong>' + GuoLe.money(order.total) + '</strong> 的“期末护航”订单：' + GuoLe.esc(summary) + '。</p>' +
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
  }

  /* ---------- 已废弃：旧收银台模板（保留函数名以免影响阅读顺序） ---------- */

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
  /* 供其它模块（导入页等）复用路由器与提示 */
  window.GuoLeUI = {
    go: go,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    render: render,
    state: S
  };

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

  /* 书签小工具跳回来时把文本交给【导入页】处理，复用同一套核对界面 */
  function applyIncomingImport(text) {
    setTimeout(function () {
      if (currentPath() !== 'import') {
        try { history.replaceState(null, '', location.pathname + '#/import'); }
        catch (e) { location.hash = '#/import'; }
        render();
      }
      setTimeout(function () {
        if (window.GuoLeImportUI) {
          window.GuoLeImportUI.handleSharedText(text);
          toast('📎 已通过书签小工具提取，请核对课程', 'ok');
        } else {
          // 导入模块不可用时退化为直接合并（少见）
          const rep = ingestText(text, { source: '书签提取' });
          if (rep && rep.added && rep.added.length) {
            toast('✅ 书签提取成功：' + rep.added.length + ' 门课程', 'ok');
          }
        }
      }, 80);
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

  /* ================= PWA：分享目标 / 文件打开 / 离线 =================
     这一块是「手机傻瓜式导入」的关键：
       - 用户在「文件管理」里长按导出的 PDF → 分享 → 选「过了么」
         → 页面收到 ?share= 参数（或 File Handling 的文件句柄）→ 直接开始解析。
       - 用户不需要在文件选择器里再翻一遍文件。
     ================================================================ */

  /* 从 URL 取出分享进来的文字（PWA share_target 用 GET 传参） */
  function consumeSharePayload() {
    var q = location.search || '';
    if (!q) return null;
    var params = new URLSearchParams(q);
    var parts = [params.get('text'), params.get('title'), params.get('url')]
      .filter(function (x) { return x && x.trim(); });
    if (!parts.length) return null;
    // 解析完就把参数清掉，避免刷新时重复导入
    try { history.replaceState(null, '', location.pathname + '#/import'); }
    catch (e) { location.hash = '#/import'; }
    return parts.join('\n');
  }

  function bootImportUI() {
    return window.GuoLeImportUI && window.GuoLeImportUI;
  }

  /* 分享文字进来。
     两个坑：
       1) history.replaceState 改 hash 【不会】触发 hashchange，必须自己 render()；
       2) 不能只在「路径不是 import」时才 render —— 首屏渲染可能发生在
          hash 还是空的时候，此时路径恰好已经是 import，却被跳过。
     所以这里【无条件】确保一次渲染，再交给导入页处理文字。 */
  var sharedText = consumeSharePayload();
  if (sharedText) {
    try { history.replaceState(null, '', location.pathname + '#/import'); }
    catch (e) { location.hash = '#/import'; }
    render();
    setTimeout(function () {
      var ui = bootImportUI();
      if (ui) ui.handleSharedText(sharedText);
    }, 80);
  }

  /* 用「过了么」打开文件（File Handling API，安卓 Chrome/Edge 支持） */
  if ('launchQueue' in window && typeof window.launchQueue.setConsumer === 'function') {
    window.launchQueue.setConsumer(function (params) {
      if (!params || !params.files || !params.files.length) return;
      var handles = params.files;
      Promise.all(handles.map(function (h) {
        return h.getFile ? h.getFile() : Promise.resolve(null);
      })).then(function (files) {
        files = files.filter(Boolean);
        if (!files.length) return;
        try { history.replaceState(null, '', location.pathname + '#/import'); }
        catch (e) { location.hash = '#/import'; }
        render();                        // 同上：replaceState 不触发 hashchange
        setTimeout(function () {
          var ui = bootImportUI();
          if (ui) ui.handleFiles(files);
        }, 100);
      }).catch(function () { /* 用户取消或权限问题，忽略 */ });
    });
  }

  /* 注册 Service Worker（PWA 可安装的前提） */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* 本地 file:// 或子路径问题时静默降级，不影响主流程 */
      });
    });
  }
})();
