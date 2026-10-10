/* 过了么 · 状态与计价 */
(function () {
  'use strict';

  const LS_KEY = 'guoleme_state_v1';

  const CONFIG = {
    APP_NAME: '过了么',
    BASE_PRICE_PER_CREDIT: 99,     // 每学分基础收费 99 元
    MEMBER_FEE: 49,                // 会员费 49 元/学期
    MEMBER_DISCOUNT: 0.05,         // 会员 95 折
    BUY3_SEND1: true,              // 买三送一（每满 4 学分免 1 学分）
    SCORE_BAO: [
      { target: 80, feePerCredit: 39, label: '≥ 80 分' },
      { target: 85, feePerCredit: 69, label: '≥ 85 分' },
      { target: 90, feePerCredit: 109, label: '≥ 90 分' },
      { target: 95, feePerCredit: 169, label: '≥ 95 分' }
    ],
    SCHOOL: {
      id: 'mju',
      name: '闽江学院',
      alias: ['闽江学院', '闽江大学', '闽江', '闽', '江'],
      portalUrl: 'https://i.mju.edu.cn/',
      portalName: '闽江学院统一身份认证平台',
      jwUrl: 'http://jwgl.mju.edu.cn/jwglxt/xtgl/login_slogin.html',
      jwOuterUrl: 'http://183.250.189.53/jwglxt/xtgl/login_slogin.html',
      jwName: '闽江学院教务管理系统（强智 V9.0）',
      // 直达“选课信息”：信息查询 → 查询个人信息 → 选课信息
      xkxxUrl: 'http://jwgl.mju.edu.cn/jwglxt/xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801&layout=default#content_xsxxgl_xsxkxx',
      kbUrl: 'http://jwgl.mju.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default#',
      officialUrl: 'https://www.mju.edu.cn/'
    }
  };

  function defaultState() {
    return {
      school: null,                  // {id,name}
      identity: { name: '', sid: '' },
      courses: [],                   // [{id,name,credit,category,source}]
      membership: { active: false },
      cart: { courseIds: [], wantsMember: false, scorebao: false, scoreTarget: 90 },
      orderSeq: 0
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      return Object.assign(defaultState(), s, {
        identity: Object.assign({ name: '', sid: '' }, s.identity || {}),
        membership: Object.assign({ active: false }, s.membership || {}),
        cart: Object.assign(defaultState().cart, s.cart || {})
      });
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  function resetAll() {
    state = defaultState();
    save();
  }

  function demoCourses() {
    return [
      { id: 'demo-1', name: '高等数学A（上）', credit: 5, category: '公共基础', source: '演示课表' },
      { id: 'demo-2', name: '大学物理B', credit: 3.5, category: '公共基础', source: '演示课表' },
      { id: 'demo-3', name: '大学英语（三）', credit: 3, category: '公共基础', source: '演示课表' },
      { id: 'demo-4', name: '马克思主义基本原理', credit: 3, category: '思政类', source: '演示课表' },
      { id: 'demo-5', name: 'C语言程序设计', credit: 2.5, category: '专业基础', source: '演示课表' },
      { id: 'demo-6', name: '概率论与数理统计', credit: 3, category: '公共基础', source: '演示课表' },
      { id: 'demo-7', name: '体育（三）', credit: 1, category: '公共基础', source: '演示课表' }
    ];
  }

  function newCourseId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* 难度/加价：关键词匹配 + 确定性兜底 */
  const HARD_WORDS = ['数学', '高数', '概率', '统计', '线代', '代数', '物理', '力学', '化学', '信号'];
  const MED_WORDS = ['英语', '思政', '马克思', '毛概', '近代史', '马原', '毛邓', '法律', '会计', '经济'];
  function courseDifficulty(course) {
    const name = course.name || '';
    if (HARD_WORDS.some((w) => name.includes(w))) {
      return { level: 2, rate: 0.2, tag: '硬核难课', reason: '题目难度大 / 监考严格，酌情加价 20%' };
    }
    if (MED_WORDS.some((w) => name.includes(w))) {
      return { level: 1, rate: 0.1, tag: '背诵量大', reason: '背诵量大 / 老师给分严格，酌情加价 10%' };
    }
    return { level: 0, rate: 0, tag: '常规课程', reason: '按基础价计费' };
  }

  function coursePricing(course) {
    const diff = courseDifficulty(course);
    const unit = CONFIG.BASE_PRICE_PER_CREDIT * (1 + diff.rate);
    const subtotal = unit * course.credit;
    return {
      base: CONFIG.BASE_PRICE_PER_CREDIT,
      diff: diff,
      unit: Math.round(unit * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100
    };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function money(n) {
    return '¥' + (round2(n)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function scoreBaoOptions() {
    return CONFIG.SCORE_BAO;
  }

  function getScoreBaoFee(state) {
    const opt = CONFIG.SCORE_BAO.find((o) => o.target === state.cart.scoreTarget) || CONFIG.SCORE_BAO[0];
    const credits = totalCredits(state);
    return round2(opt.feePerCredit * credits);
  }

  function totalCredits(state) {
    return round2(state.cart.courseIds.reduce((sum, id) => {
      const c = state.courses.find((x) => x.id === id);
      return c ? sum + c.credit : sum;
    }, 0));
  }

  /* 结算计算：返回明细 */
  function calcOrder(state) {
    const selected = state.cart.courseIds
      .map((id) => state.courses.find((c) => c.id === id))
      .filter(Boolean);
    const credits = round2(selected.reduce((s, c) => s + c.credit, 0));
    const rawTotal = round2(selected.reduce((s, c) => s + coursePricing(c).subtotal, 0));
    let memberDiscount = 0;
    let buy3Value = 0;
    let freeCredits = 0;
    const isMember = state.membership.active === true || state.cart.wantsMember === true;
    if (isMember) {
      memberDiscount = round2(rawTotal * CONFIG.MEMBER_DISCOUNT);
      if (CONFIG.BUY3_SEND1 && credits > 0) {
        freeCredits = Math.floor(credits / 4);
        buy3Value = round2(rawTotal * freeCredits / credits);
      }
    }
    const memberFeeNeeded = state.cart.wantsMember && !state.membership.active ? CONFIG.MEMBER_FEE : 0;
    const scorebaoFee = state.cart.scorebao ? getScoreBaoFee(state) : 0;
    const total = round2(Math.max(0, rawTotal - memberDiscount - buy3Value) + memberFeeNeeded + scorebaoFee);
    return {
      courses: selected,
      credits: credits,
      rawTotal: rawTotal,
      isMember: isMember,
      memberDiscount: memberDiscount,
      freeCredits: freeCredits,
      buy3Value: buy3Value,
      memberFeeNeeded: memberFeeNeeded,
      wantsMember: state.cart.wantsMember,
      scorebao: state.cart.scorebao,
      scoreTarget: state.cart.scoreTarget,
      scorebaoFee: scorebaoFee,
      total: total
    };
  }

  function cartCount() {
    return state.cart.courseIds.length;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.GuoLe = {
    CONFIG: CONFIG,
    state: state,
    save: save,
    resetAll: resetAll,
    defaultState: defaultState,
    demoCourses: demoCourses,
    newCourseId: newCourseId,
    coursePricing: coursePricing,
    calcOrder: calcOrder,
    totalCredits: totalCredits,
    scoreBaoOptions: scoreBaoOptions,
    cartCount: cartCount,
    round2: round2,
    money: money,
    esc: esc
  };
})();
