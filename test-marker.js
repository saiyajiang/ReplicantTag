(async () => {
const fs = require('fs');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync('/data/workspace/ReplicantTag.user.js', 'utf8');

const html = `<!doctype html><html><head><title>测试视频标题 - 哔哩哔哩</title></head><body>
<div class="video-info"><h1 class="video-title">测试视频标题</h1><span class="pubdate-ip">2024-05-01 10:00</span></div>
<div id="commentapp"><div id="comment"></div></div>
<bili-comment id="c1"></bili-comment>
<bili-comment id="c2"></bili-comment>
<bili-video-card id="v1"></bili-video-card>
<div class="up-panel-container" id="up1">
  <a class="avatar" href="https://space.bilibili.com/999"><img src="x"></a>
  <div class="up-info--container"><a class="up-name" href="https://space.bilibili.com/999">王五</a></div>
</div>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://www.bilibili.com/video/BV1GJ411x7h7', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;

function rect(el, x, y, w, hh) {
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + w, bottom: y + hh, width: w, height: hh, toJSON() { return this; } });
}

// ---- 评论组件 1：头像链接 + 昵称链接 + 内嵌 style 的正文 ----
const c1 = doc.getElementById('c1');
const csr = c1.attachShadow({ mode: 'open' });
csr.innerHTML = `<div class="comment-wrap">
  <a class="bili-avatar" href="//space.bilibili.com/123456"><img src="x"></a>
  <div class="user-info">
    <a href="//space.bilibili.com/123456" class="user-name">张三</a>
    <span class="level">Lv5</span>
  </div>
  <bili-rich-text><style>:host{--bili-rich-text-display: block;color: inherit}</style><span>这是一条测试评论内容</span></bili-rich-text>
</div>`;
rect(csr.querySelector('.bili-avatar'), 100, 300, 48, 48);
rect(csr.querySelector('.user-name'), 160, 300, 90, 16);
const lvEl = csr.querySelector('.level');
rect(lvEl, 255, 300, 30, 16);

// ---- 评论组件 2：同一用户在另一楼层（应保持独立锚点）----
const c2 = doc.getElementById('c2');
const csr2 = c2.attachShadow({ mode: 'open' });
csr2.innerHTML = `<div class="comment-wrap">
  <a class="bili-avatar" href="//space.bilibili.com/123456"><img src="x"></a>
  <div class="user-info">
    <a href="//space.bilibili.com/123456" class="user-name">张三</a>
    <span class="level">Lv5</span>
  </div>
  <bili-rich-text><span>张三的第二条评论</span></bili-rich-text>
</div>`;
rect(csr2.querySelector('.bili-avatar'), 100, 600, 48, 48);
rect(csr2.querySelector('.user-name'), 160, 600, 90, 16);
rect(csr2.querySelector('.level'), 255, 600, 30, 16);

// ---- 视频卡片 ----
const v1 = doc.getElementById('v1');
const vsr = v1.attachShadow({ mode: 'open' });
vsr.innerHTML = `<div class="bili-video-card__info">
  <a class="bili-video-card__info--tit" href="https://www.bilibili.com/video/BV9y7411q7Xx">卡片视频标题</a>
  <div class="bili-video-card__info--owner">
    <a class="up-name" href="https://space.bilibili.com/654321">李四</a>
    <span class="date">2023-01-02</span>
  </div>
</div>`;
rect(vsr.querySelector('.bili-video-card__info--tit'), 200, 500, 300, 40);
rect(vsr.querySelector('.up-name'), 200, 545, 120, 20);

// ---- UP 面板：头像链接 + 昵称链接（应合并为一个）----
const upHost = doc.getElementById('up1');
rect(upHost, 300, 700, 500, 60);
rect(upHost.querySelector('.avatar'), 352, 705, 48, 48);
rect(upHost.querySelector('.up-name'), 410, 720, 120, 20);

window.innerWidth = 1440; window.innerHeight = 900;

const mem = {};
window.GM_setValue = (k, v) => { mem[k] = v; };
window.GM_getValue = (k, d) => (k in mem ? mem[k] : d);
window.GM_addStyle = (css) => { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); };
const menus = [];
window.GM_registerMenuCommand = (n, fn) => menus.push([n, fn]);

await new Promise((r) => setTimeout(r, 100));
window.eval(src);
await new Promise((r) => setTimeout(r, 80));

let fails = 0;
function assert(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }
const rt = window.__rt;
const overlay = doc.getElementById('rt-overlay');
const recs = () => Array.from(rt.targets.values());

// ================= 回归：浮层方案不污染页面 DOM =================
assert(!!overlay && overlay.parentNode === doc.documentElement, '浮层挂在 documentElement 下');
assert(csr.querySelector('.rt-box') === null, '评论 shadow DOM 内无注入节点（评论区不会消失）');
assert(upHost.querySelector('.rt-box') === null, 'UP 面板内部无注入节点');

// ================= 修复 1：同一处只出现一个 +标 =================
const upRecs = recs().filter((r) => r.uid === '999');
assert(upRecs.length === 1, 'UP 区头像+昵称合并为一个锚点，实际 ' + upRecs.length);
assert(upRecs[0] && upRecs[0].nick === '王五', '保留的锚点是昵称链接（有昵称）: ' + (upRecs[0] && upRecs[0].nick));

const cmtRecs = recs().filter((r) => r.scene === 'comment');
assert(cmtRecs.length === 2, '两条评论共 2 个锚点（头像与昵称已各合并），实际 ' + cmtRecs.length);
assert(cmtRecs.every((r) => r.nick === '张三'), '头像链接的昵称由同 UID 昵称链接回填');
assert(cmtRecs.every((r) => r.a.className === 'user-name'), '保留的是昵称链接而非头像链接');
const boxCount = overlay.querySelectorAll('.rt-box').length;
const targetCount = rt.targets.size;
assert(boxCount === targetCount, '浮层框数量与锚点数一致（无重复渲染）: ' + boxCount + '/' + targetCount);

// ================= 修复 2：评论正文不再抓到 CSS =================
const nickA = csr.querySelector('.user-name');
const cmt1 = cmtRecs.filter((r) => r.a === nickA)[0];
assert(!!cmt1, '找到第一条评论的锚点');
cmt1.box.querySelector('.rt-mini').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const panel = doc.querySelector('.rt-panel');
assert(!!panel, '点击浮层按钮打开标记面板');
const ctxText = panel.querySelector('.rt-ctx').textContent;
assert(/这是一条测试评论内容/.test(ctxText), '正文抓取到真实评论内容');
assert(!/--bili-rich-text-display/.test(ctxText), '正文不再包含 B站 CSS 变量');
assert(!/host\s*\{/.test(ctxText), '正文不再包含 CSS 规则');
assert(!/display:\s*block/.test(ctxText), '正文不再包含 CSS 声明');

// ================= 定位回归 =================
const pUp = rt.computePos('up', { main: { left: 300, top: 700, right: 800, bottom: 760, width: 500, height: 60 }, guard: { left: 352, top: 705, right: 400, bottom: 753, width: 48, height: 48 } }, 40, 18, 1440);
assert(pUp.left === 302 && pUp.maxW === 44, 'UP 标记定位在面板最左内侧并限宽: ' + JSON.stringify(pUp));
const pCmt = rt.computePos('right', { main: { left: 255, top: 300, right: 285, bottom: 316, width: 30, height: 16 } }, 40, 18, 1440);
assert(pCmt.left === 290, '评论标记位于等级徽章右侧: left=' + pCmt.left);

// ================= 功能回归：打标记与留痕 =================
const input = panel.querySelector('.rt-input');
input.value = '广告号';
Array.from(panel.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const saved = JSON.parse(mem['ReplicantTag_store_v1']);
assert(!!saved.users['123456'] && saved.users['123456'].nickname === '张三', '保存 UID 与昵称');
const it0 = saved.users['123456'].items[0];
assert(it0.type === 'comment' && /这是一条测试评论内容/.test(it0.content), '留痕记录评论内容');
assert(!/--bili/.test(it0.content), '留痕内容不含 CSS');
assert(it0.bv === 'BV1GJ411x7h7', '留痕记录所在视频 BV');

// 视频卡片
const cardRec = recs().find((r) => r.scene === 'card');
assert(!!cardRec, '识别出卡片场景锚点');
cardRec.box.querySelector('.rt-mini').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const p2 = doc.querySelector('.rt-panel');
const ctx2 = p2.querySelector('.rt-ctx').textContent;
assert(/BV9y7411q7Xx/.test(ctx2) && /卡片视频标题/.test(ctx2) && /2023-01-02/.test(ctx2), '视频上下文识别 BV/标题/时间');
const i2 = p2.querySelector('.rt-input');
i2.value = '优质UP, 搬运';
Array.from(p2.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const s2 = JSON.parse(mem['ReplicantTag_store_v1']);
assert(s2.users['654321'].tags.length === 2, '一个用户可有多个标记: ' + JSON.stringify(s2.users['654321'].tags));
const vit = s2.users['654321'].items[0];
assert(vit.type === 'video' && vit.bv === 'BV9y7411q7Xx' && vit.title === '卡片视频标题' && vit.videoTime === '2023-01-02', '视频留痕记录 BV/标题/时间');

// 下拉复用
i2.value = ''; i2.dispatchEvent(new window.Event('focus'));
assert(p2.querySelector('.rt-drop').textContent.includes('广告号'), '下拉出现历史标记候选');

// chip 渲染
const chips = Array.from(overlay.querySelectorAll('.rt-chip')).map((c) => c.textContent);
assert(chips.includes('优质UP') && chips.includes('搬运'), '浮层渲染标记 chip: ' + JSON.stringify(chips));

// ================= 隐身模式 =================
const toggle = menus.find((m) => /隐身/.test(m[0]));
toggle[1]();
assert(overlay.style.display === 'none', '隐身模式隐藏整个浮层');
toggle[1]();
assert(overlay.style.display !== 'none', '再次切换恢复显示');

// ================= 清理 =================
const before = overlay.querySelectorAll('.rt-box').length;
c1.remove(); c2.remove();
await new Promise((r) => setTimeout(r, 700));
assert(overlay.querySelectorAll('.rt-box').length < before, '锚点移除后浮层框同步清理');

console.log(fails ? ('\nFAILED: ' + fails) : '\nALL PASS');
process.exit(fails ? 1 : 0);
})();
