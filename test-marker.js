(async () => {
const fs = require('fs');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync('/data/workspace/ReplicantTag.user.js', 'utf8');

const html = `<!doctype html><html><head><title>测试视频标题 - 哔哩哔哩</title></head><body>
<div class="video-info"><h1 class="video-title">测试视频标题</h1><span class="pubdate-ip">2024-05-01 10:00</span></div>
<div id="commentapp"><div id="comment"></div></div>
<bili-comment id="c1"></bili-comment>
<bili-video-card id="v1"></bili-video-card>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://www.bilibili.com/video/BV1GJ411x7h7', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

const c1 = window.document.getElementById('c1');
const csr = c1.attachShadow({ mode: 'open' });
csr.innerHTML = `<div class="comment-wrap">
  <div class="user-info">
    <a href="//space.bilibili.com/123456" class="user-name">张三</a>
    <span class="level">Lv5</span>
  </div>
  <div class="reply-content"><span class="content">这是一条测试评论内容</span></div>
</div>`;

const v1 = window.document.getElementById('v1');
const vsr = v1.attachShadow({ mode: 'open' });
vsr.innerHTML = `<div class="bili-video-card__info">
  <a class="bili-video-card__info--tit" href="https://www.bilibili.com/video/BV9y7411q7Xx">卡片视频标题</a>
  <div class="bili-video-card__info--owner">
    <a class="up-name" href="https://space.bilibili.com/654321">李四</a>
    <span class="date">2023-01-02</span>
  </div>
</div>`;

const mem = {};
window.GM_setValue = (k, v) => { mem[k] = v; };
window.GM_getValue = (k, d) => (k in mem ? mem[k] : d);
window.GM_addStyle = (css) => {
  const s = window.document.createElement('style');
  s.textContent = css;
  window.document.head.appendChild(s);
};
const menus = [];
window.GM_registerMenuCommand = (n, fn) => menus.push([n, fn]);

await new Promise((r) => setTimeout(r, 100));
window.eval(src);
await new Promise((r) => setTimeout(r, 60));

function assert(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) process.exitCode = 1;
}

const lv = csr.querySelector('.level');
const slot1 = csr.querySelector('.rt-slot');
assert(!!slot1, '评论场景注入了 slot');
assert(slot1 && lv && lv.nextElementSibling === slot1, 'slot 位于等级元素右侧');

const tit = vsr.querySelector('.bili-video-card__info--tit');
const owner = vsr.querySelector('.bili-video-card__info--owner');
const slot2 = vsr.querySelector('.rt-slot');
assert(!!slot2, '视频卡片场景注入了 slot');
assert(slot2 && tit && tit.nextElementSibling === slot2 && slot2.nextElementSibling === owner, 'slot 位于标题与 UP 行之间');

slot1.querySelector('.rt-btn-mini').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const panel = window.document.querySelector('.rt-panel');
assert(!!panel, '点击后打开标记面板');
const ctxText = panel.querySelector('.rt-ctx').textContent;
assert(/评论/.test(ctxText) && /这是一条测试评论内容/.test(ctxText), '面板显示评论内容上下文');
const input = panel.querySelector('.rt-input');
input.value = '广告号';
Array.from(panel.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const saved = JSON.parse(mem['ReplicantTag_store_v1']);
assert(!!saved.users['123456'], '已保存 UID 123456');
assert(saved.users['123456'].nickname === '张三', '记录昵称');
const it0 = saved.users['123456'].items[0];
assert(it0.type === 'comment', '留痕类型为 comment');
assert(/这是一条测试评论内容/.test(it0.content), '留痕记录评论内容');
assert(it0.bv === 'BV1GJ411x7h7', '留痕记录所在视频 BV');
assert(saved.tagLib.includes('广告号'), '标记进入历史库');

vsr.querySelector('.rt-slot .rt-btn-mini').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const panel2 = window.document.querySelector('.rt-panel');
const ctx2 = panel2.querySelector('.rt-ctx').textContent;
assert(/BV9y7411q7Xx/.test(ctx2) && /卡片视频标题/.test(ctx2) && /2023-01-02/.test(ctx2), '视频上下文识别 BV/标题/时间');
const input2 = panel2.querySelector('.rt-input');
input2.value = '优质UP';
Array.from(panel2.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const saved2 = JSON.parse(mem['ReplicantTag_store_v1']);
const vit = saved2.users['654321'].items[0];
assert(vit.type === 'video' && vit.bv === 'BV9y7411q7Xx' && vit.title === '卡片视频标题' && vit.videoTime === '2023-01-02', '视频留痕记录 BV/标题/时间');

input2.value = '';
input2.dispatchEvent(new window.Event('focus'));
const drop = panel2.querySelector('.rt-drop');
assert(drop && drop.textContent.includes('广告号'), '下拉出现历史标记候选');

input2.value = '搬运, 广告号';
Array.from(panel2.querySelectorAll('.rt-btn')).find((b) => b.textContent === '添加').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const saved3 = JSON.parse(mem['ReplicantTag_store_v1']);
const t3 = saved3.users['654321'].tags;
assert(t3.includes('搬运') && t3.includes('广告号') && t3.length >= 2, '一个用户可有多个标记: ' + JSON.stringify(t3));

const chips = vsr.querySelectorAll('.rt-chip');
assert(chips.length === 3 && chips[0].textContent.includes('优质UP'), '页面显示标记 chip, 实际 ' + chips.length);

const toggle = menus.find((m) => /隐身/.test(m[0]));
assert(!!toggle, '注册了隐身模式菜单');
toggle[1]();
assert(window.document.body.classList.contains('rt-stealth'), '隐身模式添加 body class');
const css = Array.from(window.document.head.querySelectorAll('style')).map((s) => s.textContent).join('');
assert(/\.rt-stealth \.rt-slot/.test(css), '隐身样式已注入');
toggle[1]();
assert(!window.document.body.classList.contains('rt-stealth'), '再次切换关闭隐身');

console.log('done');
process.exit(process.exitCode || 0);
})();
