/* 过了么 · Service Worker
   目标只有两个：
     1) 让 PWA 可安装（分享面板 / 文件打开方式里才会出现「过了么」）；
     2) 把核心外壳缓存下来，弱网时也能打开导入页。
   刻意【不】预缓存 pdf.js / SheetJS / CMap 这些大文件 —— 它们按需加载，
   预缓存会让首次安装多下载 2MB 以上，手机上体验很差。
*/
const VERSION = 'glm-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/store.js',
  './js/parser.js',
  './js/pdftext.js',
  './js/timetable.js',
  './js/importfile.js',
  './js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => { /* 个别文件缺失不影响安装 */ }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 分享目标 / 文件打开：带查询参数的导航请求一律走网络，
  // 否则会把带 ?share= 的 URL 缓存成外壳，造成后续打开串味。
  if (req.mode === 'navigate' && url.search) {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  // 大文件（fflate / xlsx 等）不接管，交给浏览器 HTTP 缓存
  if (/\/lib\//.test(url.pathname)) return;

  /* 策略：网络优先（network-first）。
     为什么不缓存优先（stale-while-revalidate）？
       —— 那会让用户永远落后一个版本：你修好的 bug，他刷新也拿不到，
          要刷两次才生效。这个项目很小，联网时直接取最新最稳，
          只有断网/超时才回退到缓存。 */
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => {
      if (hit) return hit;
      // 导航请求断网时回退到外壳
      if (req.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }))
  );
});
