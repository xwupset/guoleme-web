/* 过了么 · 手机优先导入页
   ---------------------------------------------------------------
   设计原则（针对手机）：
     1) 一个页面只做一件事：把文件/文字弄进来；
     2) 主入口是一个【占满屏幕宽度的巨大按钮】，不是小按钮排一行；
     3) 整页都能接住拖拽与粘贴，用户不需要精确点中某个输入框；
     4) 导入结果先给「清单」，让用户一屏核对完；
     5) 底部固定操作条，拇指够得着。

   对外：window.GuoLeImportUI = { render, mount, handleSharedText, handleFiles }
*/
(function () {
  'use strict';

  var S = null;
  function state() {
    if (!S) S = window.GuoLe.state;
    return S;
  }

  /* 本页临时状态（不进 localStorage） */
  var pending = {
    report: null,       // GuoLeImport 的返回
    courses: [],        // 待确认课程
    status: '',         // 'reading' | 'done' | 'error'
    message: '',
    via: ''
  };

  function esc(s) { return window.GuoLe.esc(s); }

  /* ============ 导入动作 ============ */

  function ingestFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!list.length) return;
    if (list.length > 1) {
      // 多文件：只取第一个，避免用户误选一堆
      pending.message = '一次只处理一个文件，已使用「' + list[0].name + '」。';
    }
    var file = list[0];
    pending.status = 'reading';
    pending.message = '正在读取「' + file.name + '」…';
    pending.via = '';
    renderInto();

    window.GuoLeImport.readFile(file, function (page, total) {
      pending.message = '正在读取 PDF：第 ' + page + '/' + total + ' 页…';
      renderInto();
    }).then(function (rep) {
      pending.report = rep;
      pending.status = rep.ok ? 'done' : 'error';
      pending.message = rep.error || '';
      pending.via = rep.via || '';
      pending.courses = (rep.courses || []).map(function (c) {
        return {
          name: c.name,
          teacher: c.teacher || '',
          weeks: c.weeks || '',
          source: c.source || '导入',
          include: true
        };
      });
      // 自动填入安全验证（姓名 / 学号）
      if (rep.identity) autoFillIdentity(rep.identity);
      renderInto();
      updateBar();          // 状态变成 done，底部操作条要跟着出现
    }).catch(function (e) {
      pending.status = 'error';
      pending.message = '读取失败：' + (e && e.message ? e.message : e);
      renderInto();
      updateBar();
    });
  }

  function ingestText(text, source) {
    text = String(text || '');
    if (!text.trim()) return;
    pending.status = 'reading';
    pending.message = '正在解析粘贴的内容…';
    renderInto();

    var parsed = window.GuoLeImport.toCourses(text);
    var rep = {
      ok: !!(parsed.courses.length || parsed.identity.name || parsed.identity.sid),
      format: 'text',
      text: text,
      identity: parsed.identity,
      courses: parsed.courses,
      structure: parsed.structure,
      warnings: []
    };
    pending.report = rep;
    pending.status = rep.ok ? 'done' : 'error';
    pending.via = 'paste';
    pending.message = rep.ok ? '' : '这段文字里没有读到课程。请确认复制的是「选课信息」或「课表」页面。';
    pending.courses = (rep.courses || []).map(function (c) {
      return {
        name: c.name, teacher: c.teacher || '',
        weeks: c.weeks || '', source: source || '粘贴', include: true
      };
    });
    if (rep.identity) autoFillIdentity(rep.identity);
    renderInto();
    updateBar();
  }

  function autoFillIdentity(id) {
    var st = state();
    var changed = false;
    if (id.name && !String(st.identity.name || '').trim()) { st.identity.name = id.name; changed = true; }
    if (id.sid && !String(st.identity.sid || '').trim()) { st.identity.sid = id.sid; changed = true; }
    if (changed) window.GuoLe.save();
  }

  /* 把勾选的课程写进正式课表 */
  function commit() {
    var st = state();
    var picked = pending.courses.filter(function (c) { return c.include && c.name; });
    if (!picked.length) {
      window.GuoLeUI.toast('请至少勾选一门课程', 'err');
      return;
    }

    // 选课菜单要求先选学校；只适配闽江学院，直接替用户选好，别让流程断在这里
    if (!st.school) {
      st.school = { id: window.GuoLe.CONFIG.SCHOOL.id, name: window.GuoLe.CONFIG.SCHOOL.name };
    }

    var existing = {};
    st.courses.forEach(function (c) { existing[c.name] = c; });

    var added = 0;
    picked.forEach(function (c) {
      if (existing[c.name]) return;
      var item = {
        id: window.GuoLe.newCourseId(),
        name: c.name,
        category: '',
        source: c.source || '文件导入',
        teacher: c.teacher || '',
        weeks: c.weeks || ''
      };
      st.courses.push(item);
      existing[c.name] = item;
      added++;
    });
    window.GuoLe.save();
    pending.message = '';
    window.GuoLeUI.toast(added
      ? ('已导入 ' + added + ' 门课程' + (added < picked.length ? '（' + (picked.length - added) + ' 门同名已跳过）' : ''))
      : '这些课程都已在课表里了', 'ok');
    window.GuoLeUI.go('#/menu');
  }

  /* ============ 渲染 ============ */

  function statusCard() {
    if (!pending.status) return '';
    if (pending.status === 'reading') {
      return '<div class="import-status reading"><span class="spin"></span>' + esc(pending.message) + '</div>';
    }
    if (pending.status === 'error') {
      return '<div class="import-status error"><strong>没能读出课程</strong><p>' + esc(pending.message) + '</p>' +
        '<p class="small">你可以：换个文件重试 · 用下面的「粘贴文字」 · 或去「选课菜单」手动添加。</p></div>';
    }
    var rep = pending.report || {};
    var id = rep.identity || {};
    var html = '<div class="import-status ok"><strong>✅ 读取成功</strong>';
    if (id.name || id.sid) {
      html += '<p>已自动识别：<b>' + esc(id.name || '—') + '</b> · 学号 <b>' + esc(id.sid || '—') + '</b>' +
        '　<span class="small muted">已填入「安全验证」</span></p>';
    }
    html += '<p>共 ' + pending.courses.length + ' 门课程';
    if (rep.structure === 'timetable') html += '（识别为周课表）';
    html += '</p>';
    if (rep.warnings && rep.warnings.length) {
      html += '<p class="small muted">' + esc(rep.warnings.join(' ')) + '</p>';
    }
    html += '</div>';
    return html;
  }

  function courseEditor() {
    if (pending.status !== 'done' || !pending.courses.length) return '';
    var rows = pending.courses.map(function (c, i) {
      return '<div class="imp-row">' +
        '<label class="imp-check"><input type="checkbox" data-imp-pick="' + i + '"' + (c.include ? ' checked' : '') + '></label>' +
        '<div class="imp-name">' + esc(c.name) +
          (c.teacher ? '<span class="imp-sub">' + esc(c.teacher) + (c.weeks ? ' · ' + esc(c.weeks) : '') + '</span>' : '') +
        '</div>' +
        '</div>';
    }).join('');

    return '<div class="card imp-editor">' +
      '<div class="imp-editor-head"><h3>核对课程（' + pending.courses.length + ' 门）</h3>' +
      '<button class="btn btn-ghost small" id="imp-toggle-all">全选 / 全不选</button></div>' +
      '<p class="small muted">取消勾选可以去掉误识别的条目。</p>' +
      '<div class="imp-list">' + rows + '</div>' +
      '</div>';
  }

  function pageHtml() {
    var st = state();
    var count = st.courses.length;
    return (
      '<h1 class="page-title">导入课表</h1>' +
      '<p class="page-sub">从教务系统导出文件，或直接复制粘贴，一键把本学期课程导进来。</p>' +

      '<div class="card imp-primary">' +
      '<h3>📥 选择文件导入</h3>' +
      '<p class="small muted">支持教务系统导出的 <b>PDF / Excel / CSV</b>。' +
      '手机上是：教务系统 → 导出 / 下载 → 回到这里选文件。</p>' +
      '<button class="btn btn-primary btn-block btn-xl" id="imp-pick">📄 选择文件（PDF / Excel）</button>' +
      '<input type="file" id="imp-file" class="hidden-file" ' +
      'accept=".pdf,.xls,.xlsx,.csv,.json,.txt,application/pdf">' +
      '<div class="imp-drop" id="imp-drop">' +
      '<span class="imp-drop-ico">⇪</span>' +
      '<span>电脑上可以把文件直接拖到这里</span>' +
      '</div>' +
      '</div>' +

      '<div class="card">' +
      '<h3>📋 或者：复制粘贴</h3>' +
      '<p class="small muted">在教务系统里选中表格 → 复制 → 回到本页 <b>直接粘贴</b>（在页面任何位置按都行）。</p>' +
      '<textarea class="import-box" id="imp-paste" placeholder="在这里长按粘贴，或者在页面任意位置直接粘贴…"></textarea>' +
      '<div class="btn-row mt">' +
      '<button class="btn btn-primary" id="imp-paste-go">解析这段文字</button>' +
      '<button class="btn btn-ghost" id="imp-paste-clear">清空</button>' +
      '</div>' +
      '</div>' +

      statusCard() +
      courseEditor() +

      (count
        ? '<div class="card tip">当前课表里已经有 <b>' + count + '</b> 门课程，导入时会自动跳过同名的。</div>'
        : '')
    );
  }

  /* 只重绘动态区域，避免打断正在输入的内容 */
  function renderInto() {
    var host = document.getElementById('imp-dynamic');
    if (!host) return;
    host.innerHTML = statusCard() + courseEditor();
    wireDynamic();
  }

  function wireDynamic() {
    var host = document.getElementById('imp-dynamic');
    if (!host) return;

    host.querySelectorAll('[data-imp-pick]').forEach(function (box) {
      box.addEventListener('change', function () {
        var i = parseInt(box.getAttribute('data-imp-pick'), 10);
        if (pending.courses[i]) pending.courses[i].include = box.checked;
        // 只更新底部条，不整体重绘
        updateBar();
      });
    });

    var all = host.querySelector('#imp-toggle-all');
    if (all) {
      all.addEventListener('click', function () {
        var boxes = host.querySelectorAll('[data-imp-pick]');
        var someOff = Array.prototype.some.call(boxes, function (b) { return !b.checked; });
        boxes.forEach(function (b) { b.checked = someOff; });
        pending.courses.forEach(function (c) { c.include = someOff; });
        updateBar();
      });
    }
  }

  function updateBar() {
    var bar = document.getElementById('imp-bar');
    if (!bar) return;
    if (pending.status !== 'done') { bar.style.display = 'none'; return; }
    var picked = pending.courses.filter(function (c) { return c.include; });
    bar.style.display = '';
    bar.querySelector('.imp-bar-info').innerHTML = '已选 <b>' + picked.length + '</b> 门课程';
  }

  function barHtml() {
    return '<div class="action-bar" id="imp-bar" style="display:none">' +
      '<div class="imp-bar-info"></div>' +
      '<button class="btn btn-primary" id="imp-commit">导入并进入选课菜单 →</button>' +
      '</div>';
  }

  /* ============ 对外接口 ============ */

  function render() {
    return pageHtml() + '<div id="imp-dynamic">' + (statusCard() + courseEditor()) + '</div>' + barHtml();
  }

  function mount() {
    // 文件选择
    var pick = document.getElementById('imp-pick');
    var input = document.getElementById('imp-file');
    if (pick && input) {
      pick.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        ingestFiles(input.files);
        input.value = '';         // 允许重复选同一个文件
      });
    }

    // 拖拽（整页都能接）
    var drop = document.getElementById('imp-drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (!e.dataTransfer) return;
        e.preventDefault();
        if (drop) drop.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (drop) drop.classList.remove('over');
      });
    });
    document.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files);
    });

    // 整页接住粘贴
    document.addEventListener('paste', function (e) {
      var t = e.clipboardData && e.clipboardData.getData('text');
      if (!t || !t.trim()) return;
      var box = document.getElementById('imp-paste');
      if (box) box.value = t;
      e.preventDefault();
      ingestText(t, '粘贴');
    });

    // 粘贴区按钮
    var go = document.getElementById('imp-paste-go');
    if (go) go.addEventListener('click', function () {
      var box = document.getElementById('imp-paste');
      ingestText(box ? box.value : '', '粘贴');
    });
    var clr = document.getElementById('imp-paste-clear');
    if (clr) clr.addEventListener('click', function () {
      var box = document.getElementById('imp-paste');
      if (box) box.value = '';
      pending.status = ''; pending.message = ''; pending.courses = [];
      renderInto(); updateBar();
    });

    // 提交
    var commitBtn = document.getElementById('imp-commit');
    if (commitBtn) commitBtn.addEventListener('click', commit);

    wireDynamic();
    updateBar();

    // DOM 已就位：把分享 / 「用过了么打开文件」排队的内容消费掉
    flushQueue();
  }

  /* 供 PWA 分享目标 / File Handling 调用。
     这里【只排队，不立刻解析】——
     因为分享进来时页面往往还没渲染完，直接解析会写进空气里。
     真正的处理放在 mount() 里，那时 DOM 一定就位。 */
  var queued = { text: '', files: null };

  function handleSharedText(text) {
    if (!text) return;
    queued.text = (queued.text ? queued.text + '\n' : '') + text;
    flushQueue();
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    queued.files = files;
    flushQueue();
  }

  function flushQueue() {
    // 页面已挂载（有 #imp-dynamic）才消费队列
    if (!document.getElementById('imp-dynamic')) return;
    if (queued.text) {
      var t = queued.text;
      queued.text = '';
      ingestText(t, '分享');
    }
    if (queued.files) {
      var f = queued.files;
      queued.files = null;
      ingestFiles(f);
    }
  }

  window.GuoLeImportUI = {
    render: render,
    mount: mount,
    handleSharedText: handleSharedText,
    handleFiles: handleFiles,
    _pending: pending,
    _queued: queued
  };
})();
