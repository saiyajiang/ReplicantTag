(async () => {
const fs = require('fs');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync('/data/workspace/ReplicantTag.user.js', 'utf8');

const html = `<!doctype html><html><head><title>测试视频标题 - 哔哩哔哩</title></head><body>
<div class="video-info"><h1 class="video-title">测试视频标题</h1><span class="pubdate-ip">2024-05-01 10:00</span></div>
<div id="commentapp"><div id="comment"></div></div>
<bili-comment id="c1"></bili-comment>
<bili-video-card id="v1"></bili-video-card>
<div class="up-panel-container" id="up1">
  <a class="avatar" href="https://space.bilibili.com/999"><img src="x"></a>
  <div class="up-info--container"><a class="up-name" href="https://space.bilibili.com/999">王五</a></div>
</div>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://www.bilibili.com/video/BV1GJ411x7h7', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;

// ---- 评论 Web Component（shadow DOM）----
const c1 = doc.getElementById('c1');
const csr = c1.attachShadow({ mode: 'open' });
csr.innerHTML = `<div class="comment-wrap">
  <div class="user-info">
    <a href="//space.bilibili.com/123456" class="user-name">张三</a>
    <span class="level">Lv5</span>
  </div>
  <div class="reply-content"><span class="content">这是一条测试评论内容</span></div>
</div>`;

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

// ---- 给关键元素注入几何信息（jsdom 默认全 0）----
function rect(el, x, y, w, hh) {
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + w, bottom: y + hh, width: w, height: hh, toJSON() { return this; } });
}
const lvEl = csr.querySelector('.level');
rect(lvEl, 200, 300, 30, 16);
rect(csr.querySelector('.user-name'), 100, 300, 90, 16);
rect(vsr.querySelector('.bili-video-card__info--tit'), 200, 500, 300, 40);
rect(vsr.querySelector('.bili-video-card__info--owner'), 200, 545, 300, 20);
const upHost = doc.getElementById('up1');
rect(upHost, 300, 700, 500, 60);
rect(upHost.querySelector('.avatar'), 352, 705, 48, 48);

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

// ============ 核心修复 1：不在 shadow DOM / 页面节点内插入任何元素 ============
assert(!!doc.getElementById('rt-overlay'), '创建了浮层容器 #rt-overlay');
const overlay = doc.getElementById('rt-overlay');
assert(overlay.parentNode === doc.documentElement, '浮层挂在 documentElement 下，不在页面结构中');
assert(csr.querySelector('.rt-box') === null && csr.querySelector('.rt-slot') === null, '评论 shadow DOM 内无任何注入节点（评论区不会消失）');
assert(vsr.querySelector('.rt-box') === null, '视频卡片 shadow DOM 内无注入节点');
assert(upHost.querySelector('.rt-box') === null, 'UP 面板内部无注入节点（不会撑开空白）');
// 评论组件原有结构完好
assert(csr.querySelector('.level') === lvEl && csr.querySelector('.reply-content') !== null, '评论组件原有 DOM 结构未被破坏');
assert(csr.querySelectorAll('*').length === 6, '评论 shadow DOM 子节点数未变: ' + csr.querySelectorAll('*').length);

// ============ 核心修复 2：UP 标记定位在面板最左内侧（红框位置） ============
const boxes = Array.from(overlay.querySelectorAll('.rt-box'));
assert(boxes.length >= 3, '浮层渲染了标记框，共 ' + boxes.length + ' 个');

const upRec = Array.from(rt.targets.values()).find((r) => r.scene === 'up' && r.uid === '999');
assert(!!upRec, '识别出 UP 场景锚点');
if (upRec) {
  const p = rt.computePos('up', { main: { left: 300, top: 700, right: 800, bottom: 760, width: 500, height: 60 }, guard: { left: 352, top: 705, right: 400, bottom: 753, width: 48, height: 48 } }, 40, 18, 1440);
  assert(p.left === 302, 'UP 标记位于面板最左内侧（红框位置）: left=' + p.left);
  assert(p.top > 700 && p.top < 760, 'UP 标记垂直居中于面板内: top=' + p.top);
  assert(p.maxW === 44, 'UP 标记限宽不遮挡头像: maxW=' + p.maxW);
  assert(p.left + Math.min(40, p.maxW) <= 352, 'UP 标记右边界不越过头像左边界');
}

// 空间不足时退到头像左外侧，不遮挡头像
const pTight = rt.computePos('up', { main: { left: 300, top: 700, right: 800, bottom: 760, width: 500, height: 60 }, guard: { left: 305, top: 705, right: 353, bottom: 753, width: 48, height: 48 } }, 40, 18, 1440);
assert(pTight.left === 302 && pTight.maxW === 28, 'UP 面板左侧极窄时仍固定红框位置并取最小限宽: ' + JSON.stringify(pTight));
const pRoomy = rt.computePos('up', { main: { left: 100, top: 700, right: 900, bottom: 760, width: 800, height: 60 }, guard: { left: 260, top: 705, right: 308, bottom: 753, width: 48, height: 48 } }, 40, 18, 1440);
assert(pRoomy.left === 102 && pRoomy.maxW === 150, 'UP 面板左侧宽敞时限宽放开到 150: ' + JSON.stringify(pRoomy));

// ============ 评论区：定位在等级徽章右侧 ============
const pCmt = rt.computePos('right', { main: { left: 200, top: 300, right: 230, bottom: 316, width: 30, height: 16 } }, 40, 18, 1440);
assert(pCmt.left === 235, '评论标记位于等级徽章右侧: left=' + pCmt.left);
assert(pCmt.top >= 296 && pCmt.top <= 318, '评论标记与等级徽章垂直居中对齐: top=' + pCmt.top);
// 靠近右边界时翻到左侧，不溢出
const pEdge = rt.computePos('right', { main: { left: 1400, top: 300, right: 1430, bottom: 316, width: 30, height: 16 } }, 40, 18, 1440);
assert(pEdge.left + 40 <= 1440, '靠右边界时自动翻到左侧不溢出: left=' + pEdge.left);

// ============ 卡片：标题下方 ============
const pCard = rt.computePos('below', { main: { left: 200, top: 500, right: 500, bottom: 540, width: 300, height: 40 } }, 40, 18, 1440);
assert(pCard.left === 200 && pCard.top === 543, '卡片标记位于标题下方: ' + JSON.stringify(pCard));

// ============ 定位计算不越界 ============
const pClamp = rt.computePos('below', { main: { left: -500, top: 0, right: -100, bottom: 20, width: 400, height: 20 } }, 40, 18, 1440);
assert(pClamp.left >= 4, '异常坐标被钳制在视口内: left=' + pClamp.left);

// ============ 功能回归：打标记 ============
const cmtRec = Array.from(rt.targets.values()).find((r) => r.scene === 'comment');
assert(!!cmtRec, '识别出评论场景锚点');
cmtRec.box.querySelector('.rt-mini').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const panel = doc.querySelector('.rt-panel');
assert(!!panel, '点击浮层按钮打开标记面板');
const ctxText = panel.querySelector('.rt-ctx').textContent;
assert(/评论/.test(ctxText) && /这是一条测试评论内容/.test(ctxText), '面板显示评论内容上下文');
const input = panel.querySelector('.rt-input');
input.value = '广告号';
Array.from(panel.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const saved = JSON.parse(mem['ReplicantTag_store_v1']);
assert(!!saved.users['123456'], '已保存 UID 123456');
assert(saved.users['123456'].nickname === '张三', '记录昵称');
const it0 = saved.users['123456'].items[0];
assert(it0.type === 'comment' && /这是一条测试评论内容/.test(it0.content), '留痕记录评论内容');
assert(it0.bv === 'BV1GJ411x7h7', '留痕记录所在视频 BV');

// 视频卡片留痕
const cardRec = Array.from(rt.targets.values()).find((r) => r.scene === 'card');
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

// 页面上 chip 渲染
const chips = Array.from(overlay.querySelectorAll('.rt-chip')).map((c) => c.textContent);
assert(chips.includes('优质UP') && chips.includes('搬运'), '浮层渲染标记 chip: ' + JSON.stringify(chips));

// ============ 隐身模式 ============
const toggle = menus.find((m) => /隐身/.test(m[0]));
assert(!!toggle, '注册了隐身模式菜单');
toggle[1]();
assert(overlay.style.display === 'none', '隐身模式隐藏整个浮层');
toggle[1]();
assert(overlay.style.display !== 'none', '再次切换恢复显示');

// ============ 清理：锚点移除后浮层框同步移除 ============
const before = overlay.querySelectorAll('.rt-box').length;
c1.remove();
await new Promise((r) => setTimeout(r, 700));
assert(overlay.querySelectorAll('.rt-box').length < before, '锚点移除后浮层框同步清理');

console.log(fails ? ('\nFAILED: ' + fails) : '\nALL PASS');
process.exit(fails ? 1 : 0);
})();
