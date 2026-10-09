(async () => {
const fs = require('fs');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync('/data/workspace/ReplicantTag.user.js', 'utf8');

function rect(el, x, y, w, hh) {
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + w, bottom: y + hh, width: w, height: hh, toJSON() { return this; } });
}
function stubGM(window) {
  const mem = {};
  const menus = [];
  window.GM_setValue = (k, v) => { mem[k] = v; };
  window.GM_getValue = (k, d) => (k in mem ? mem[k] : d);
  window.GM_addStyle = (css) => { const s = window.document.createElement('style'); s.textContent = css; window.document.head.appendChild(s); };
  window.GM_registerMenuCommand = (n, fn) => menus.push([n, fn]);
  return { mem, menus };
}

let fails = 0;
function assert(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

/* ==================================================================== */
/*  场景 A：视频页 —— 评论去重 / 正文 / 定位                              */
/* ==================================================================== */
{
  const html = `<!doctype html><html><head><title>测试视频标题 - 哔哩哔哩</title></head><body>
  <div class="video-info"><h1 class="video-title">测试视频标题</h1><span class="pubdate-ip">2024-05-01 10:00</span></div>
  <bili-comment id="c1"></bili-comment>
  <bili-comment id="c2"></bili-comment>
  <bili-video-card id="v1"></bili-video-card>
  <div class="up-panel-container" id="up1">
    <a class="avatar" href="https://space.bilibili.com/999"><img src="x"></a>
    <div class="up-info--container"><a class="up-name" href="https://space.bilibili.com/999">王五</a></div>
  </div>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://www.bilibili.com/video/BV1GJ411x7h7', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom; const doc = window.document;
  const { mem, menus } = stubGM(window);

  // 评论 1：头像链接 + 昵称链接 + 内嵌 style 的正文（B站真实结构：bili-avatar 是独立组件）
  const c1 = doc.getElementById('c1');
  const csr = c1.attachShadow({ mode: 'open' });
  csr.innerHTML = `<div class="comment-wrap">
    <bili-avatar><a class="bili-avatar-face" href="//space.bilibili.com/123456"><img src="x"></a></bili-avatar>
    <div class="user-info">
      <a href="//space.bilibili.com/123456" class="user-name">张三</a>
      <span class="level">Lv5</span>
    </div>
    <bili-rich-text><style>:host{--bili-rich-text-display: block;color: inherit}</style><span>这是一条测试评论内容</span></bili-rich-text>
  </div>`;
  const av1 = csr.querySelector('.bili-avatar-face');
  rect(av1, 100, 300, 48, 48);
  const name1 = csr.querySelector('.user-name');
  rect(name1, 160, 300, 90, 16);
  rect(csr.querySelector('.level'), 255, 300, 30, 16);
  rect(c1, 90, 290, 900, 120);

  // 评论 2：同一用户另一楼层
  const c2 = doc.getElementById('c2');
  const csr2 = c2.attachShadow({ mode: 'open' });
  csr2.innerHTML = `<div class="comment-wrap">
    <bili-avatar><a class="bili-avatar-face" href="//space.bilibili.com/123456"><img src="x"></a></bili-avatar>
    <div class="user-info"><a href="//space.bilibili.com/123456" class="user-name">张三</a><span class="level">Lv5</span></div>
    <bili-rich-text><span>张三的第二条评论</span></bili-rich-text>
  </div>`;
  rect(csr2.querySelector('.bili-avatar-face'), 100, 600, 48, 48);
  rect(csr2.querySelector('.user-name'), 160, 600, 90, 16);
  rect(csr2.querySelector('.level'), 255, 600, 30, 16);
  rect(c2, 90, 590, 900, 120);

  // 视频卡片
  const v1 = doc.getElementById('v1');
  const vsr = v1.attachShadow({ mode: 'open' });
  vsr.innerHTML = `<div class="bili-video-card__info">
    <a class="bili-video-card__info--tit" href="https://www.bilibili.com/video/BV9y7411q7Xx">卡片视频标题</a>
    <div class="bili-video-card__info--owner"><a class="up-name" href="https://space.bilibili.com/654321">李四</a><span class="date">2023-01-02</span></div>
  </div>`;
  rect(vsr.querySelector('.bili-video-card__info--tit'), 200, 900, 300, 40);
  rect(vsr.querySelector('.up-name'), 200, 945, 120, 20);

  // UP 面板
  const upHost = doc.getElementById('up1');
  rect(upHost, 300, 1050, 500, 60);
  rect(upHost.querySelector('.avatar'), 352, 1055, 48, 48);
  rect(upHost.querySelector('.up-name'), 410, 1070, 120, 20);

  window.innerWidth = 1440; window.innerHeight = 900;
  await new Promise((r) => setTimeout(r, 100));
  window.eval(src);
  await new Promise((r) => setTimeout(r, 80));

  const rt = window.__rt;
  const overlay = doc.getElementById('rt-overlay');
  const recs = () => Array.from(rt.targets.values());

  console.log('--- 场景 A：视频页 ---');
  // 修复 2：头像链接 + 昵称链接只出一个 +标
  const cmtRecs = recs().filter((r) => r.scene === 'comment');
  assert(cmtRecs.length === 2, '两条评论共 2 个锚点（头像与昵称已合并），实际 ' + cmtRecs.length);
  assert(cmtRecs.every((r) => r.a.className === 'user-name'), '保留的是昵称链接，头像链接被丢弃');
  assert(cmtRecs.every((r) => r.nick === '张三'), '昵称正确');
  assert(rt.isAvatarLink(av1) === true, '头像链接被识别为 avatar（含 bili-avatar 祖先）');
  assert(rt.isAvatarLink(name1) === false, '昵称链接不被识别为 avatar');

  const upRecs = recs().filter((r) => r.uid === '999');
  assert(upRecs.length === 1, 'UP 区头像+昵称合并为一个锚点，实际 ' + upRecs.length);
  assert(overlay.querySelectorAll('.rt-box').length === rt.targets.size, '浮层框数量与锚点数一致');

  // 修复 3：可见性 —— 默认不半透明
  const css = Array.from(doc.head.querySelectorAll('style')).map((s) => s.textContent).join('');
  assert(/\.rt-box\{[^}]*opacity:1/.test(css), '标记默认完全不透明（此前 .55 看不清）');
  assert(!overlay.classList.contains('rt-dim'), '默认非暗淡模式');

  // 修复 3：位置右移到空白区
  const pCmt = rt.computePos('right', {
    main: { left: 255, top: 300, right: 285, bottom: 316, width: 30, height: 16 },
    container: { left: 90, top: 290, right: 990, bottom: 410, width: 900, height: 120 },
  }, 40, 18, 1440);
  assert(pCmt.left > 800, '评论标记右移到容器右侧空白区: left=' + pCmt.left);
  assert(pCmt.left + 40 <= 990, '未溢出评论容器右边界');
  assert(pCmt.top >= 296 && pCmt.top <= 318, '与等级徽章垂直对齐: top=' + pCmt.top);
  const pNarrow = rt.computePos('right', {
    main: { left: 255, top: 300, right: 285, bottom: 316, width: 30, height: 16 },
    container: { left: 90, top: 290, right: 340, bottom: 410, width: 250, height: 120 },
  }, 40, 18, 1440);
  assert(pNarrow.left === 290, '容器过窄时退回等级右侧: left=' + pNarrow.left);

  // 偏移设置生效
  rt.store().settings.offset = { x: 40, y: 0 };
  const pOff = rt.computePos('right', {
    main: { left: 255, top: 300, right: 285, bottom: 316, width: 30, height: 16 },
    container: { left: 90, top: 290, right: 990, bottom: 410, width: 900, height: 120 },
  }, 40, 18, 1440);
  assert(pOff.left === pCmt.left + 40, '偏移设置生效: ' + pOff.left + ' = ' + pCmt.left + '+40');
  rt.store().settings.offset = { x: 0, y: 0 };

  // 修复 1（回归）：正文不含 CSS
  const cmt1 = cmtRecs.filter((r) => r.a === name1)[0];
  cmt1.box.querySelector('.rt-mini').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const panel = doc.querySelector('.rt-panel');
  const ctxText = panel.querySelector('.rt-ctx').textContent;
  assert(/这是一条测试评论内容/.test(ctxText), '正文抓取到真实评论内容');
  assert(!/--bili-rich-text-display/.test(ctxText), '正文不含 B站 CSS 变量');

  // UP 定位回归
  const pUp = rt.computePos('up', { main: { left: 300, top: 1050, right: 800, bottom: 1110, width: 500, height: 60 }, guard: { left: 352, top: 1055, right: 400, bottom: 1103, width: 48, height: 48 } }, 40, 18, 1440);
  assert(pUp.left === 302 && pUp.maxW === 44, 'UP 标记仍在面板最左内侧: ' + JSON.stringify(pUp));

  // 不污染页面 DOM
  assert(csr.querySelector('.rt-box') === null, '评论 shadow DOM 内无注入节点');
  assert(upHost.querySelector('.rt-box') === null, 'UP 面板内无注入节点');

  // 打标记
  panel.querySelector('.rt-input').value = '广告号';
  Array.from(panel.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const saved = JSON.parse(mem['ReplicantTag_store_v1']);
  assert(saved.users['123456'].nickname === '张三' && saved.users['123456'].tags.includes('广告号'), '标记已保存');
  assert(!/--bili/.test(saved.users['123456'].items[0].content), '留痕内容不含 CSS');
}

/* ==================================================================== */
/*  场景 B：用户空间页                                                     */
/* ==================================================================== */
{
  const html = `<!doctype html><html><head><title>老戴在此的个人空间</title></head><body>
  <div id="app"><div class="space-header">
    <div class="bili-avatar"><img src="x"></div>
    <div class="info"><span id="h-name">老戴在此</span><div class="desc">商务联系</div></div>
  </div>
  <div class="video-list">
    <bili-video-card id="sv1"></bili-video-card>
    <bili-video-card id="sv2"></bili-video-card>
  </div></div>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://space.bilibili.com/29508762/video', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom; const doc = window.document;
  const { mem } = stubGM(window);

  const nick = doc.getElementById('h-name');
  rect(nick, 200, 150, 160, 28);

  // 空间页主人的视频卡片（全部同 UID）
  for (const id of ['sv1', 'sv2']) {
    const el = doc.getElementById(id);
    const sr = el.attachShadow({ mode: 'open' });
    sr.innerHTML = `<div class="bili-video-card__info">
      <a class="bili-video-card__info--tit" href="https://www.bilibili.com/video/BV1xx411c7mD">空间里的视频</a>
      <div class="bili-video-card__info--owner"><a class="up-name" href="https://space.bilibili.com/29508762">老戴在此</a></div>
    </div>`;
    rect(el, 100, 400, 300, 200);
    rect(sr.querySelector('.up-name'), 100, 500, 120, 20);
  }

  window.innerWidth = 1440; window.innerHeight = 900;
  await new Promise((r) => setTimeout(r, 100));
  window.eval(src);
  await new Promise((r) => setTimeout(r, 80));

  const rt = window.__rt;
  const recs = () => Array.from(rt.targets.values());
  console.log('--- 场景 B：用户空间页 ---');
  assert(rt.isSpacePage() === true, '识别为空间页');
  assert(rt.spaceUid() === '29508762', '从 URL 解析出 UID: ' + rt.spaceUid());

  const spaceRecs = recs().filter((r) => r.scene === 'space');
  assert(spaceRecs.length === 1, '空间页生成 1 个主人锚点，实际 ' + spaceRecs.length);
  assert(spaceRecs[0] && spaceRecs[0].uid === '29508762', '锚点 UID 正确');
  assert(spaceRecs[0] && spaceRecs[0].nick === '老戴在此', '锚点昵称为页面主人: ' + (spaceRecs[0] && spaceRecs[0].nick));
  assert(recs().length === 1, '主人的视频卡片不再重复标记（共 ' + recs().length + ' 个锚点）');

  // 空间页可打标记
  spaceRecs[0].box.querySelector('.rt-mini').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const panel = doc.querySelector('.rt-panel');
  const ctxText = panel.querySelector('.rt-ctx').textContent;
  assert(/用户空间/.test(ctxText) && /老戴在此/.test(ctxText), '空间页面板显示「用户空间」上下文: ' + ctxText.replace(/\s+/g, ' ').slice(0, 60));
  panel.querySelector('.rt-input').value = '主机区UP';
  Array.from(panel.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const saved = JSON.parse(mem['ReplicantTag_store_v1']);
  assert(saved.users['29508762'].tags.includes('主机区UP'), '空间页成功打标记');
  assert(saved.users['29508762'].items[0].type === 'space', '留痕类型为 space');

  // 空间页标记定位：昵称右侧
  const pSpace = rt.computePos('right', {
    main: { left: 200, top: 150, right: 360, bottom: 178, width: 160, height: 28 },
    container: { left: 100, top: 100, right: 900, bottom: 300, width: 800, height: 200 },
  }, 40, 18, 1440);
  assert(pSpace.left > 360, '空间标记右移到空白区: left=' + pSpace.left);
  assert(pSpace.top > 150 && pSpace.top < 178, '与昵称垂直对齐: top=' + pSpace.top);
}

/* ==================================================================== */
/*  场景 C：非空间页不应误判                                               */
/* ==================================================================== */
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.bilibili.com/video/BV1GJ411x7h7', pretendToBeVisual: true, runScripts: 'outside-only' });
  stubGM(dom.window);
  await new Promise((r) => setTimeout(r, 60));
  dom.window.eval(src);
  await new Promise((r) => setTimeout(r, 60));
  console.log('--- 场景 C：视频页不误判为空间页 ---');
  assert(dom.window.__rt.isSpacePage() === false, '视频页不被识别为空间页');
}

console.log(fails ? ('\nFAILED: ' + fails) : '\nALL PASS');
process.exit(fails ? 1 : 0);
})();
