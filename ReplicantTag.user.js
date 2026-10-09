// ==UserScript==
// @name         ReplicantTag · 用户标记器（昵称/UID · 视频/评论留痕）
// @name:zh-CN   ReplicantTag · 用户标记器（昵称/UID · 视频/评论留痕）
// @namespace    https://github.com/saiyajiang/ReplicantTag
// @version      1.3.0
// @description  给视频或评论对应的用户打标记：自动记录昵称与UID；标记视频时同时记录标题、BV号与视频时间，标记评论时记录评论内容。标记可下拉复用，一个用户可有多个标记；标记直接显示在评论区等级右侧、视频卡片标题下方、播放页UP面板左侧，支持隐身模式一键隐藏全部痕迹，支持导出/导入备份。采用浮层渲染，不向页面插入任何节点。支持B站视频页、用户空间页、视频卡片与评论区，后续将扩展至更多站点。本脚本由 AI 编写。
// @description:en  Tag users behind videos or comments: auto-record nickname & UID; for videos it also keeps the title, BV id and publish date, for comments it keeps the comment text. Tags are reusable from a dropdown and a user can carry several at once. Rendered in a standalone overlay layer (no DOM injected into the page): beside the comment level badge, under video card titles, and at the left edge of the UP panel. Stealth mode hides everything, JSON export/import included. Bilibili only for now. This script is written by AI.
// @author       saiyajiang
// @license      MIT
// @homepageURL  https://github.com/saiyajiang/ReplicantTag
// @supportURL   https://github.com/saiyajiang/ReplicantTag/issues
// @downloadURL  https://raw.githubusercontent.com/saiyajiang/ReplicantTag/main/ReplicantTag.user.js
// @updateURL    https://raw.githubusercontent.com/saiyajiang/ReplicantTag/main/ReplicantTag.user.js
// @match        *://*.bilibili.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @icon         https://raw.githubusercontent.com/saiyajiang/ReplicantTag/main/icon.svg
// @tag          bilibili
// @tag          productivity
// @tag          标记
// ==/UserScript==

/*
 * 本脚本由 AI 编写。
 *
 * 关于「给人打标签」这件事：
 * 给人贴标签本身就是一种不好的行为——它把立体的人压成扁平的符号，容易演变成偏见、
 * 歧视与网暴，也可能因为一次误判就长期影响你对某个人的判断。请谨慎使用，尽量只描述
 * 可观察到的事实与行为，不要对真实的人做价值评判、人身攻击或敏感信息归档。
 *
 * 但另一方面，网络上确实存在大量无法被定义的人：营销号、搬运号、机器人、水军、
 * 反复出现的抬杠账号……它们的行为高度扁平化、模式化，几乎不呈现人格的复杂性，
 * 更像一个个重复的 NPC。面对这类账号，逐个重新辨认的成本极高，有时候不得不对
 * 这些「NPC」做标记管理，才能保护自己的注意力与信息环境。
 *
 * 本脚本仅是一个本地的记录工具，数据保存在你自己的浏览器里，不会上传任何数据。
 * 如何使用它，取决于你。
 *
 * 当前支持站点：哔哩哔哩（bilibili.com）。后续计划扩展至更多站点，架构已按多站点预留。
 *
 * 实现说明（1.1.0）：所有页面内标记均渲染在独立的浮层（overlay）中，脚本绝不向
 * 页面自身的 DOM / Shadow DOM 插入、移动或删除任何节点。B站评论区由前端框架渲染，
 * 向其内部插入外部节点会破坏框架的 DOM 协调，导致整块评论区被卸载。
 */

/* global GM_setValue, GM_getValue, GM_addStyle, GM_registerMenuCommand */

(function () {
  'use strict';

  /* ====================== 常量 ====================== */

  const STORE_KEY = 'ReplicantTag_store_v1';
  const MAX_ITEMS_PER_USER = 50;   // 每个用户最多保留的留痕条数
  const MAX_TAG_LIB = 500;         // 历史标记（下拉候选）上限
  const MAX_CHIPS = 3;             // 页面上最多直接展示的标记个数，其余折叠为 +N
  const SHADOW_DEPTH = 4;          // 递归下潜 Shadow DOM 的层数（B站新组件是 Web Component）
  const MAX_BOXES = 400;           // 浮层里同时渲染的标记框上限，超出按视口距离淘汰

  const LINK_SEL = 'a[href*="space.bilibili.com/"]';
  const CARD_SEL = ['bili-video-card', '.bili-video-card', '.video-card', '.small-item'];
  const UP_SEL = [
    '.up-panel-container', '.up-info-container', '.up-detail-container', '.up-info--container',
    '.video-owner', '[class*="up-info"]', '.up-box', 'bili-video-owner', 'bili-watch-side-owner',
    '.bili-video-owner', '.member-info', '.upper-row',
  ];
  const COMMENT_SEL = [
    'bili-comment', 'bili-comment-thread-renderer', 'bili-comment-reply-renderer',
    '#comment', '.reply-wrap', '.reply-item', '[class*="comment"]', '[class*="reply"]',
  ];
  const LEVEL_SEL = ['bili-comment-user-level', '.level', '.user-level', '[class*="level"]'];
  const AVATAR_SEL = ['.bili-avatar', '[class*="avatar"]', 'img'];
  const TITLE_SEL = ['h1.video-title', '.video-title', '.tit', '.title'];
  const CARD_TITLE_SEL = ['.bili-video-card__info--tit', '[class*="info--tit"]', '.bili-video-card__info--title', '.title', '.tit'];
  const PUBDATE_SEL = ['[class*="pubdate"]', '[class*="pub-date"]', '.video-data .date', '.bili-video-info__date'];
  // 用户空间页（space.bilibili.com）的昵称元素
  const SPACE_NICK_SEL = ['#h-name', '.nickname', '.h-name', '.name', '[class*="nickname"]', 'h1'];

  /* ====================== 存储 ====================== */

  let store = readStore();
  let storeRev = store.rev || 0;

  function blankStore() {
    return { users: {}, tagLib: [], settings: { stealth: false, enabled: true, dim: false, offset: { x: 0, y: 0 } }, rev: 0 };
  }

  function readStore() {
    let raw = null;
    try { raw = GM_getValue(STORE_KEY, null); } catch (e) { /* 沙箱异常忽略 */ }
    if (raw == null) { try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* 隐身窗口兜底 */ } }
    if (!raw) return blankStore();
    try {
      const o = JSON.parse(raw);
      return {
        users: (o && o.users) || {},
        tagLib: (o && o.tagLib) || [],
        settings: Object.assign({ stealth: false, enabled: true, dim: false, offset: { x: 0, y: 0 } }, (o && o.settings) || {}),
        rev: (o && o.rev) || 0,
      };
    } catch (e) {
      return blankStore();
    }
  }

  // 双写：GM 存储为主，localStorage 为镜像（浏览器无痕/隐身窗口下也能正常工作）
  function saveStore() {
    store.rev = (store.rev || 0) + 1;
    storeRev = store.rev;
    let raw = '';
    try { raw = JSON.stringify(store); } catch (e) { return; }
    try { GM_setValue(STORE_KEY, raw); } catch (e) { /* 忽略 */ }
    try { localStorage.setItem(STORE_KEY, raw); } catch (e) { /* 忽略 */ }
    applyStealth();
    refreshAllBoxes();
  }

  function getUser(uid, nickname) {
    if (!store.users[uid]) {
      store.users[uid] = { uid: uid, nickname: nickname || '', tags: [], items: [], createdAt: Date.now(), updatedAt: Date.now() };
    }
    const u = store.users[uid];
    if (nickname && u.nickname !== nickname) u.nickname = nickname;
    return u;
  }

  function addMark(uid, nickname, ctx, tagRaw) {
    const tags = String(tagRaw || '')
      .split(/[,，;；|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!tags.length) return 0;
    const u = getUser(uid, nickname);
    tags.forEach((t) => {
      if (u.tags.indexOf(t) === -1) u.tags.push(t);
      if (store.tagLib.indexOf(t) === -1) store.tagLib.push(t);
    });
    if (store.tagLib.length > MAX_TAG_LIB) store.tagLib = store.tagLib.slice(-MAX_TAG_LIB);
    u.items.unshift({
      id: 'i' + Date.now() + Math.random().toString(36).slice(2, 6),
      type: ctx.type,                 // 'video' | 'comment' | 'manual'
      tags: tags.slice(),
      bv: ctx.bv || '',
      title: ctx.title || '',
      videoTime: ctx.videoTime || '',
      content: ctx.content || '',
      url: ctx.url || location.href,
      at: Date.now(),
    });
    if (u.items.length > MAX_ITEMS_PER_USER) u.items.length = MAX_ITEMS_PER_USER;
    u.updatedAt = Date.now();
    saveStore();
    return tags.length;
  }

  function removeTag(uid, tag) {
    const u = store.users[uid];
    if (!u) return;
    u.tags = u.tags.filter((t) => t !== tag);
    u.updatedAt = Date.now();
    saveStore();
  }

  function removeItem(uid, id) {
    const u = store.users[uid];
    if (!u) return;
    u.items = u.items.filter((it) => it.id !== id);
    u.updatedAt = Date.now();
    saveStore();
  }

  function removeUser(uid) {
    delete store.users[uid];
    saveStore();
  }

  /* ====================== DOM 小工具 ====================== */

  function h(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.setAttribute('style', v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      }
    }
    (kids || []).forEach((c) => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function matches(el, sels) {
    if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return false;
    for (let i = 0; i < sels.length; i++) {
      try { if (el.matches(sels[i])) return true; } catch (e) { /* 忽略非法选择器 */ }
    }
    return false;
  }

  // 祖先链（自动跨越 Shadow DOM 边界）
  function ancestors(el) {
    const list = [];
    let cur = el;
    let guard = 0;
    while (cur && guard++ < 60) {
      list.push(cur);
      let p = cur.parentElement;
      if (!p) {
        const rn = cur.getRootNode && cur.getRootNode();
        if (rn && rn.host) p = rn.host;
      }
      cur = p;
    }
    return list;
  }

  // 遍历 document 及所有 ShadowRoot（只读，绝不修改）
  function forEachRoot(cb) {
    cb(document);
    let frontier = [document];
    for (let d = 0; d < SHADOW_DEPTH; d++) {
      const next = [];
      for (const root of frontier) {
        let els;
        try { els = root.querySelectorAll('*'); } catch (e) { continue; }
        for (const el of els) {
          if (el.shadowRoot) { cb(el.shadowRoot); next.push(el.shadowRoot); }
        }
      }
      if (!next.length) break;
      frontier = next;
    }
  }

  function deepFindFirst(root, sels) {
    if (!root) return null;
    const queue = [root];
    let guard = 0;
    while (queue.length && guard++ < 40) {
      const r = queue.shift();
      let els;
      try { els = r.querySelectorAll('*'); } catch (e) { continue; }
      for (const el of els) {
        if (matches(el, sels)) return el;
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
    }
    return null;
  }

  // 取文本（包含 Shadow DOM 内的文本）
  // 这些标签里的内容不是正文：B站组件的 shadow DOM 常内嵌 <style>（含 --bili-* 变量），
  // 早期版本会把这些 CSS 当成评论正文抓进来。
  const SKIP_TAGS = { STYLE: 1, SCRIPT: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, HEAD: 1, TITLE: 1, SVG: 1, PATH: 1 };

  // 判断一段文本是否其实是 CSS（B站组件的 shadow DOM 里内联了 :host{--bili-xxx:...}）
  function looksLikeCSS(s) {
    const t = String(s || '');
    if (!t) return false;
    if (/--bili-[a-z0-9-]+\s*:/i.test(t)) return true;
    if (/--[a-z][a-z0-9-]{2,}\s*:/.test(t) && /[;{}]/.test(t)) return true;
    if (/@media|@keyframes|!important/.test(t)) return true;
    // 花括号成对 + 含分号/冒号，基本可判定为样式表
    if (/\{[\s\S]*\}/.test(t) && /[;:]/.test(t)) return true;
    return false;
  }

  // 把 CSS 从文本中剔除；清不干净就返回空串（宁可显示「未识别」也不要显示样式代码）
  function sanitizeContent(s) {
    let t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (!looksLikeCSS(t)) return t;
    t = t.replace(/\/\*[\s\S]*?\*\//g, ' ');
    t = t.replace(/[^{}]*\{[^{}]*\}/g, ' ');              // 整条规则块
    t = t.replace(/--[a-zA-Z0-9-]+\s*:[^;}]*[;}]?/g, ' '); // 残留的自定义属性
    t = t.replace(/@[a-z-]+\b[^;{]*[;{]?/gi, ' ');         // @media 等 at-rule
    t = t.replace(/[a-z-]+\s*:\s*[^;{}]*;?/gi, (m) => (/[\u4e00-\u9fa5]/.test(m) ? m : ' '));
    t = t.replace(/\s+/g, ' ').trim();
    if (looksLikeCSS(t)) return '';
    // CSS 与正文混排时，去掉开头残留的样式碎片
    t = t.replace(/^[\s:;{}.,#()\[\]'"a-z-]+\s*(?=[\u4e00-\u9fa5])/i, '');
    return t.trim();
  }

  function cleanText(s) {
    return sanitizeContent(s);
  }

  // 只读 light DOM 文本（克隆后删掉 style/script，避免把内联样式算进来）
  function lightText(el) {
    if (!el) return '';
    try {
      const clone = el.cloneNode(true);
      const bad = clone.querySelectorAll ? clone.querySelectorAll('style,script,template,noscript') : [];
      for (const n of bad) n.remove();
      return sanitizeContent(clone.textContent || '');
    } catch (e) { return ''; }
  }

  // 只读 shadow DOM 里的文本，跳过 style/script
  function shadowText(el) {
    if (!el || !el.shadowRoot) return '';
    let out = '';
    const walk = (n, lv) => {
      if (lv > 8) return;
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { out += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        if (SKIP_TAGS[c.tagName]) continue;
        if (c.shadowRoot) walk(c.shadowRoot, lv + 1);
        walk(c, lv + 1);
      }
    };
    walk(el.shadowRoot, 0);
    return sanitizeContent(out);
  }

  function textOf(el) {
    if (!el) return '';
    let out = '';
    const walk = (n, lv) => {
      if (lv > 8) return;
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { out += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        if (SKIP_TAGS[c.tagName]) continue;
        if (c.hasAttribute && c.hasAttribute('hidden')) continue;
        if (c.getAttribute && c.getAttribute('aria-hidden') === 'true') continue;
        if (c.shadowRoot) walk(c.shadowRoot, lv + 1);
        walk(c, lv + 1);
      }
    };
    if (el.shadowRoot) walk(el.shadowRoot, 0);
    walk(el, 0);
    return cleanText(out);
  }

  function uidFromHref(href) {
    const s = String(href || '');
    const m = s.match(/space\.bilibili\.com\/(\d+)/);
    return m ? m[1] : '';
  }

  function hrefOf(a) {
    try { return a.getAttribute('href') || a.href || ''; } catch (e) { return ''; }
  }

  function bvFromHost(host) {
    if (!host) return '';
    const a = deepFindFirst(host.shadowRoot || host, ['a[href*="/video/BV"]', 'a[href*="bilibili.com/video"]']);
    if (a) {
      const m = hrefOf(a).match(/(BV[0-9A-Za-z]{10})/);
      if (m) return m[1];
    }
    if (host.getAttribute) {
      const attr = host.getAttribute('bvid') || host.getAttribute('data-bvid') || host.getAttribute('data-bv');
      if (attr) return String(attr);
    }
    return '';
  }

  function currentBV() {
    const m = location.pathname.match(/(BV[0-9A-Za-z]{10})/);
    return m ? m[1] : '';
  }

  function currentTitle() {
    const t = deepFindFirst(document, TITLE_SEL);
    if (t) {
      const s = textOf(t);
      if (s) return s;
    }
    return (document.title || '').replace(/\s*[-_]\s*哔哩哔哩.*$/, '').trim();
  }

  function currentPubDate() {
    const d = deepFindFirst(document, PUBDATE_SEL);
    return d ? textOf(d).slice(0, 60) : '';
  }

  /* ====================== 场景识别 ====================== */

  function classify(a) {
    const chain = ancestors(a);
    const findInChain = (sels) => {
      for (const el of chain) if (matches(el, sels)) return el;
      return null;
    };
    const card = findInChain(CARD_SEL);
    if (card) return { scene: 'card', host: card };
    const cmt = findInChain(COMMENT_SEL);
    // 评论优先于 UP：评论区里也会出现 UP 标识
    if (cmt && !findInChain(UP_SEL)) return { scene: 'comment', host: cmt };
    const up = findInChain(UP_SEL);
    if (up) return { scene: 'up', host: up };
    if (cmt) return { scene: 'comment', host: cmt };
    return null;
  }

  function findLevel(a) {
    const chain = ancestors(a);
    for (let i = 0; i < Math.min(chain.length, 8); i++) {
      const el = chain[i];
      if (matches(el, LEVEL_SEL)) return el;
      const found = deepFindFirst(el, LEVEL_SEL);
      if (found && found !== a) return found;
    }
    return null;
  }

  function findAvatar(host, a) {
    const root = host && (host.shadowRoot || host);
    if (root) {
      const av = deepFindFirst(root, AVATAR_SEL);
      if (av) return av;
    }
    return a;
  }

  // 有效可视矩形：B站常把同一个用户的头像链接与昵称链接并存，需要据此去重
  function rectOf(el) {
    if (!el) return null;
    try {
      const r = el.getBoundingClientRect();
      if (!r) return null;
      if (!r.width && !r.height) return null;
      return r;
    } catch (e) { return null; }
  }

  // 头像链接没有昵称文字，不能作为锚点。除了自身 class，还要看近几层祖先：
  // B站把 <a><img></a> 包在 .bili-avatar / .avatar / .face 容器里。
  function isAvatarLink(a) {
    if (!a) return false;
    const cls = String(a.className || '');
    if (/avatar|face|bili-avatar|user-face/i.test(cls)) return true;
    try { if (a.querySelector('img, svg, picture')) return true; } catch (e) { /* 忽略 */ }
    const chain = ancestors(a);
    for (let i = 0; i < Math.min(chain.length, 4); i++) {
      const el = chain[i];
      if (!el || el === a) continue;
      const c = String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '');
      const tag = String(el.tagName || '');
      if (/avatar|face|bili-avatar|user-face/i.test(c) || /avatar|face/i.test(tag)) return true;
    }
    return false;
  }

  function rectNear(a, b) {
    if (!a || !b) return false;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    // 直接重叠，或同一行内紧挨着（头像与昵称之间常有十几到上百像素间距）
    if (ox > -140 && oy > -60) return true;
    const cx1 = (a.left + a.right) / 2, cy1 = (a.top + a.bottom) / 2;
    const cx2 = (b.left + b.right) / 2, cy2 = (b.top + b.bottom) / 2;
    return Math.abs(cx1 - cx2) < 240 && Math.abs(cy1 - cy2) < 60;
  }

  // 同一位置多个候选时选最优锚点：有昵称 > 非头像链接 > 有矩形
  function anchorScore(c) {
    let s = 0;
    if (c.nick) s += 8;
    if (!c.isAvatar) s += 4;
    if (c.rect) s += 2;
    if (c.rect) s += Math.min(c.rect.width, 400) / 2000;
    return s;
  }

  // 同一 uid 下做空间聚类，一处只保留一个锚点
  function dedupeAnchors(cands) {
    const groups = [];
    for (const c of cands) {
      let g = null;
      for (const gg of groups) {
        if (c.host && gg.host === c.host) { g = gg; break; }
        if (rectNear(gg.rect, c.rect)) { g = gg; break; }
      }
      if (!g) { g = { host: c.host, rect: c.rect, items: [] }; groups.push(g); }
      g.items.push(c);
    }
    const out = [];
    for (const g of groups) {
      // 只要簇里存在非头像候选，就整体丢弃头像候选（头像链接没有昵称，点了也没用）
      const named = g.items.filter((it) => !it.isAvatar);
      const pool = named.length ? named : g.items;
      let best = null;
      for (const it of pool) {
        if (!best || anchorScore(it) > anchorScore(best)) best = it;
      }
      out.push(best);
    }
    return out;
  }

  function findCardTitle(host) {
    const root = host && (host.shadowRoot || host);
    if (!root) return null;
    return deepFindFirst(root, CARD_TITLE_SEL);
  }

  /* ---------------- 用户空间页（space.bilibili.com） ---------------- */

  function isSpacePage() {
    if (/^space\.bilibili\.com$/i.test(location.hostname)) return true;
    if (/space\.bilibili\.com/i.test(location.hostname) && /space\.bilibili\.com\/\d+/i.test(location.href)) return true;
    return false;
  }

  function spaceUid() {
    const m = location.href.match(/space\.bilibili\.com\/(\d+)/);
    if (m) return m[1];
    const m2 = location.pathname.match(/^\/(\d{3,})/);
    return m2 ? m2[1] : '';
  }

  // 空间页顶部「本人」区域里的链接（如头像/昵称自链），不应被同 UID 规则跳过
  function isSpaceOwnerEl(el) {
    const owner = findSpaceOwnerCached();
    if (!owner || !owner.el) return false;
    return el === owner.el || owner.el.contains(el) || el.contains(owner.el);
  }

  let ownerCache = { key: '', val: null };
  function findSpaceOwnerCached() {
    const key = location.href;
    if (ownerCache.key === key && ownerCache.val) return ownerCache.val;
    const v = findSpaceOwner();
    ownerCache = { key: key, val: v };
    return v;
  }

  // 空间页顶部昵称（页面主人本人）。取最靠上的、确实有文字的那个。
  function findSpaceOwner() {
    const found = [];
    forEachRoot((root) => {
      let els;
      try { els = root.querySelectorAll(SPACE_NICK_SEL.join(',')); } catch (e) { return; }
      for (const el of els) {
        const t = textOf(el);
        if (!t || t.length > 40) continue;
        const r = rectOf(el);
        if (!r) continue;
        if (r.top < 0 || r.top > Math.max(600, window.innerHeight * 0.8)) continue;
        found.push({ el: el, nick: t, rect: r });
      }
    });
    if (!found.length) return null;
    found.sort((a, b) => a.rect.top - b.rect.top || b.rect.width - a.rect.width);
    return found[0];
  }

  // 评论正文提取。B站 bili-rich-text 的结构不固定：
  // 有时正文在 light DOM（<span>），有时整个渲染在 shadow DOM 里且混着 <style>。
  // 这里按「light → shadow(跳过样式) → 整节点」顺序尝试，每一步都做 CSS 清洗，
  // 拿到疑似 CSS 的结果就继续退到下一级，宁可显示「未识别」也不显示样式代码。
  const COMMENT_BODY_SEL = ['bili-rich-text', '.reply-content', '.root-reply', '.comment-content', '[class*="reply-content"]', '.reply-content-container', '.content'];

  function commentContent(host) {
    const root = host && (host.shadowRoot || host);
    const body = deepFindFirst(root, COMMENT_BODY_SEL);
    const tries = [];
    if (body) {
      tries.push(lightText(body));
      tries.push(shadowText(body));
      tries.push(sanitizeContent(textOf(body)));
    }
    tries.push(sanitizeContent(textOf(host)));
    for (const t of tries) {
      if (t && !looksLikeCSS(t)) return t.slice(0, 500);
    }
    return '';
  }

  function buildCtx(rec) {
    const host = rec.host;
    if (rec.scene === 'space') {
      return {
        type: 'space',
        content: '',
        bv: '',
        title: rec.nick || currentTitle(),
        videoTime: '',
        url: location.href,
      };
    }
    if (rec.scene === 'comment') {
      return {
        type: 'comment',
        content: commentContent(host),
        bv: currentBV(),
        title: currentTitle(),
        videoTime: currentPubDate(),
        url: location.href,
      };
    }
    return {
      type: 'video',
      bv: bvFromHost(host) || currentBV(),
      title: textOf(findCardTitle(host)) || currentTitle(),
      videoTime: textOf(deepFindFirst(host && (host.shadowRoot || host), ['[class*="date"]', '[class*="time"]'])) || currentPubDate(),
      content: '',
      url: location.href,
    };
  }

  /* ====================== 浮层渲染（不向页面插入任何节点） ====================== */

  let overlay = null;
  const targets = new Map(); // anchor -> rec

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = h('div', { class: 'rt-overlay', id: 'rt-overlay' });
    // 挂到 documentElement：避免 body 上的 transform/filter 影响 fixed 定位
    (document.documentElement || document.body).appendChild(overlay);
    return overlay;
  }

  function makeBox(rec) {
    const box = h('span', { class: 'rt-box', 'data-scene': rec.scene });
    box.__rtRec = rec;
    box.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openPanel(rec);
    });
    return box;
  }

  function renderBox(rec) {
    const box = rec.box;
    if (!box) return;
    const u = store.users[rec.uid];
    const tags = (u && u.tags) || [];
    while (box.firstChild) box.removeChild(box.firstChild);
    if (tags.length) {
      tags.slice(0, MAX_CHIPS).forEach((t) => {
        box.appendChild(h('span', { class: 'rt-chip', title: t }, [t.length > 12 ? t.slice(0, 12) + '…' : t]));
      });
      if (tags.length > MAX_CHIPS) {
        box.appendChild(h('span', { class: 'rt-chip rt-chip--more', title: tags.join('、') }, ['+' + (tags.length - MAX_CHIPS)]));
      }
      box.appendChild(h('span', { class: 'rt-mini', title: '编辑该用户的标记' }, ['✎']));
    } else {
      box.appendChild(h('span', { class: 'rt-mini rt-mini--add', title: '给该用户添加标记（UID ' + rec.uid + '）' }, ['＋标']));
    }
  }

  function refreshAllBoxes() {
    targets.forEach((rec) => {
      if (rec.rev !== storeRev) { renderBox(rec); rec.rev = storeRev; }
    });
  }

  // 定位参考元素
  function refRects(rec) {
    const a = rec.a;
    let aRect = null;
    try { aRect = a.getBoundingClientRect(); } catch (e) { /* 忽略 */ }
    if (!aRect) return null;

    if (rec.scene === 'comment') {
      const lv = rec.level || findLevel(a);
      rec.level = lv;
      let r = null;
      if (lv) { try { r = lv.getBoundingClientRect(); } catch (e) { /* 忽略 */ } }
      if (!r || (!r.width && !r.height)) r = aRect;
      // 容器：整条评论，用来把标记放到右侧空白区
      let cont = null;
      try { cont = rec.host && rec.host.getBoundingClientRect(); } catch (e) { /* 忽略 */ }
      return { main: r, container: (cont && cont.width ? cont : null), mode: 'right' };
    }

    if (rec.scene === 'space') {
      // 用户空间页：放在昵称右侧的空白区
      let cont = null;
      try { cont = rec.host && rec.host.getBoundingClientRect(); } catch (e) { /* 忽略 */ }
      return { main: aRect, container: (cont && cont.width ? cont : null), mode: 'right' };
    }

    if (rec.scene === 'up') {
      const host = rec.host;
      let hostRect = null;
      try { hostRect = host && host.getBoundingClientRect(); } catch (e) { /* 忽略 */ }
      const av = rec.avatar || findAvatar(host, a);
      rec.avatar = av;
      let avRect = null;
      try { avRect = av && av.getBoundingClientRect(); } catch (e) { /* 忽略 */ }
      // text：UP 昵称 / 简介所在的文字块，标记必须避开它
      let textRect = null;
      try {
        const infoEl = deepFindFirst(host && (host.shadowRoot || host), ['.up-info--container', '.up-detail-container', '[class*="up-info"]', '.up-detail', '.info']);
        if (infoEl) textRect = infoEl.getBoundingClientRect();
      } catch (e) { /* 忽略 */ }
      if (!textRect || (!textRect.width && !textRect.height)) textRect = aRect;
      return {
        main: hostRect && (hostRect.width || hostRect.height) ? hostRect : aRect,
        guard: avRect && (avRect.width || avRect.height) ? avRect : aRect,
        text: textRect,
        mode: 'up',
      };
    }

    // card：标题下方
    const t = rec.title || findCardTitle(rec.host);
    rec.title = t;
    if (t) {
      let r = null;
      try { r = t.getBoundingClientRect(); } catch (e) { /* 忽略 */ }
      if (r && (r.width || r.height)) return { main: r, mode: 'below' };
    }
    return { main: aRect, mode: 'below' };
  }

  // 纯函数：给定矩形与尺寸，算出浮标左上角坐标
  function computePos(mode, rects, bw, bh, vw) {
    const main = rects.main;
    const guard = rects.guard || main;
    const off = offsetSetting();
    let left, top, maxW = 0;
    if (mode === 'up') {
      top = main.top + (main.height - bh) / 2;
      const text = rects.text || guard;
      // 候选 A：UP 面板最左内侧的空白处（红框位置）—— 只有放得下完整内容才用，
      // 否则会截断；放不下就换候选，绝不压缩成"半个标记"。
      const availLeft = guard.left - main.left - 8;
      if (availLeft >= bw + 4) {
        left = main.left + 2;
      } else {
        // 候选 B：头像与文字块右侧的空白区
        const cand = Math.max(guard.right, text.right) + 8;
        const limit = Math.min(main.right, vw) - 6;
        if (cand + bw <= limit) {
          left = cand;
        } else {
          // 候选 C：UP 面板下方（不遮挡头像、昵称与简介）
          left = main.left;
          top = main.bottom + 4;
        }
      }
    } else if (mode === 'right') {
      top = main.top + (main.height - bh) / 2;
      const cont = rects.container;
      // 优先右移到整条评论 / 信息区右侧的空白位置，避免压在昵称、等级上
      if (cont && cont.width >= bw + 220) {
        const rightEdge = cont.right - bw - 12;
        left = Math.min(rightEdge, main.right + 520);
        if (left < main.right + 24) left = main.right + 5; // 容器太窄时退回原位
      } else {
        left = main.right + 5;
      }
      if (left + bw > vw - 6) {
        const back = main.left - bw - 5;
        left = back >= 6 ? back : Math.max(6, vw - bw - 6);
      }
    } else { // below
      left = main.left;
      top = main.bottom + 3;
      if (left + bw > vw - 6) left = Math.max(6, vw - bw - 6);
    }
    left = Math.max(4, Math.min(left, Math.max(4, vw - bw - 4)));
    top = Math.max(4, top);
    return {
      left: Math.round(left + off.x),
      top: Math.round(top + off.y),
      maxW: maxW ? Math.round(maxW) : 0,
    };
  }

  function offsetSetting() {
    const s = (store.settings && store.settings.offset) || {};
    return { x: Number(s.x) || 0, y: Number(s.y) || 0 };
  }

  function layout() {
    if (!overlay || !overlay.isConnected) ensureOverlay();
    if (!overlay) return;
    const paused = !store.settings.enabled || store.settings.stealth;
    if (paused) { overlay.style.display = 'none'; return; }
    overlay.style.display = '';

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const shown = [];

    targets.forEach((rec) => {
      let box = rec.box;
      if (!box) {
        box = makeBox(rec);
        rec.box = box;
        rec.rev = -1;
        overlay.appendChild(box);
      }
      if (rec.rev !== storeRev) { renderBox(rec); rec.rev = storeRev; }

      if (!rec.a.isConnected) { box.style.display = 'none'; return; }
      const rects = refRects(rec);
      if (!rects) { box.style.display = 'none'; return; }
      const m = rects.main;
      if (m.bottom < -120 || m.top > vh + 120 || (!m.width && !m.height)) { box.style.display = 'none'; return; }

      box.style.display = '';
      const bw = box.offsetWidth || 40;
      const bh = box.offsetHeight || 18;
      const pos = computePos(rects.mode, rects, bw, bh, vw);
      if (pos.maxW) box.style.maxWidth = pos.maxW + 'px';
      else box.style.maxWidth = '';
      box.style.transform = 'translate(' + pos.left + 'px,' + pos.top + 'px)';
      shown.push({ rec, top: pos.top });
    });

    // 数量保护：超出上限时隐藏视口外的
    if (shown.length > MAX_BOXES) {
      shown.sort((x, y) => x.top - y.top);
      for (let i = 0; i < shown.length - MAX_BOXES; i++) shown[i].rec.box.style.display = 'none';
    }
  }

  /* ====================== 扫描 ====================== */

  let scanTimer = null;
  let layoutPending = false;

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 500);
  }

  function requestLayout() {
    if (layoutPending) return;
    layoutPending = true;
    const run = () => { layoutPending = false; layout(); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function scan() {
    if (!document.body) return;
    if (!store.settings.enabled) { if (overlay) overlay.style.display = 'none'; return; }

    // 清理已失效的锚点
    targets.forEach((rec, a) => {
      if (!a.isConnected) {
        if (rec.box && rec.box.parentNode) rec.box.parentNode.removeChild(rec.box);
        targets.delete(a);
      }
    });

    // 1) 收集候选
    const spacePage = isSpacePage();
    const ownerUid = spacePage ? spaceUid() : '';
    const cands = [];
    forEachRoot((root) => {
      let as;
      try { as = root.querySelectorAll(LINK_SEL); } catch (e) { return; }
      for (const a of as) {
        const uid = uidFromHref(hrefOf(a));
        if (!uid) continue;
        // 空间页里，主人的视频卡片、动态全都同 UID，只在昵称处标一次，避免满屏重复
        if (ownerUid && uid === ownerUid && !isSpaceOwnerEl(a)) continue;
        const c = classify(a);
        if (!c) continue;
        const rect = rectOf(a);
        // 完全不可见（无尺寸）的链接跳过：多为隐藏的重复节点
        if (!rect) continue;
        const nick = (textOf(a) || a.getAttribute('title') || '').replace(/^@/, '').trim().slice(0, 60);
        cands.push({ a: a, uid: uid, nick: nick, scene: c.scene, host: c.host, rect: rect, isAvatar: isAvatarLink(a) });
      }
    });

    // 1b) 空间页：给页面主人补一个锚点（昵称本身通常不是链接）
    if (ownerUid) {
      const owner = findSpaceOwner();
      if (owner && !cands.some((c) => c.uid === ownerUid && c.a === owner.el)) {
        cands.push({
          a: owner.el, uid: ownerUid, nick: owner.nick, scene: 'space',
          host: owner.el.parentElement || owner.el, rect: owner.rect, isAvatar: false,
        });
      }
    }

    // 2) 昵称回填：头像链接没有文字，用同 UID 的昵称链接补齐
    const nickMap = new Map();
    for (const c of cands) {
      if (!c.nick) continue;
      const cur = nickMap.get(c.uid);
      if (!cur || c.nick.length > cur.length) nickMap.set(c.uid, c.nick);
    }
    for (const c of cands) if (!c.nick && nickMap.has(c.uid)) c.nick = nickMap.get(c.uid);

    // 3) 同一 UID 按空间去重：一处只留一个锚点
    const byUid = new Map();
    for (const c of cands) {
      if (!byUid.has(c.uid)) byUid.set(c.uid, []);
      byUid.get(c.uid).push(c);
    }
    const kept = [];
    byUid.forEach((list) => { kept.push.apply(kept, dedupeAnchors(list)); });

    // 4) 写入 targets
    const seen = new Set();
    for (const c of kept) {
      seen.add(c.a);
      const old = targets.get(c.a);
      if (old) {
        // 已存在：只更新可能变化的信息，保留 box
        old.uid = c.uid; old.nick = c.nick; old.scene = c.scene; old.host = c.host;
        continue;
      }
      targets.set(c.a, { a: c.a, uid: c.uid, nick: c.nick, scene: c.scene, host: c.host, box: null, rev: -1 });
    }

    const missing = [];
    targets.forEach((rec, a) => { if (!seen.has(a)) missing.push(a); });
    missing.forEach((a) => {
      const rec = targets.get(a);
      if (rec && rec.box && rec.box.parentNode) rec.box.parentNode.removeChild(rec.box);
      targets.delete(a);
    });

    layout();
  }

  /* ====================== 标记面板 ====================== */

  let panel = null;
  let lastPanelPos = null;
  let lastMgrPos = null;

  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
  }

  function openPanel(rec) {
    closePanel();
    const uid = rec.uid;
    const nick = rec.nick || (store.users[uid] && store.users[uid].nickname) || '';
    const ctx = buildCtx(rec);
    const u = store.users[uid];

    const tagBox = h('div', { class: 'rt-tags' });
    const itemBox = h('div', { class: 'rt-items' });
    const drop = h('div', { class: 'rt-drop' });
    const input = h('input', {
      class: 'rt-input',
      type: 'text',
      placeholder: '输入标记，多个用逗号分隔，可下拉复用',
      autocomplete: 'off',
    });

    const refreshTags = () => {
      const cur = store.users[uid];
      while (tagBox.firstChild) tagBox.removeChild(tagBox.firstChild);
      if (!cur || !cur.tags.length) {
        tagBox.appendChild(h('div', { class: 'rt-empty', text: '暂无标记' }));
      } else {
        cur.tags.forEach((t) => {
          tagBox.appendChild(h('span', { class: 'rt-tag' }, [
            h('span', { class: 'rt-tag-t', text: t }),
            h('span', {
              class: 'rt-tag-x',
              title: '删除该标记',
              onclick: () => { removeTag(uid, t); refreshTags(); renderItems(); },
            }, ['×']),
          ]));
        });
      }
    };

    const renderItems = () => {
      const cur = store.users[uid];
      while (itemBox.firstChild) itemBox.removeChild(itemBox.firstChild);
      if (!cur || !cur.items.length) {
        itemBox.appendChild(h('div', { class: 'rt-empty', text: '暂无留痕记录' }));
        return;
      }
      cur.items.slice(0, 20).forEach((it) => {
        const isVideo = it.type === 'video';
        const lines = [];
        if (isVideo) {
          lines.push(h('div', { class: 'rt-item-line rt-item-line--t' }, [
            h('span', { class: 'rt-badge rt-badge--video', text: '视频' }),
            h('span', { text: (it.title || '(无标题)').slice(0, 60) }),
          ]));
          const meta = [];
          if (it.bv) meta.push(h('a', { class: 'rt-link', href: 'https://www.bilibili.com/video/' + it.bv, target: '_blank', rel: 'noreferrer', text: it.bv }));
          if (it.videoTime) meta.push(h('span', { text: it.videoTime }));
          meta.push(h('span', { class: 'rt-dim', text: fmtTime(it.at) }));
          lines.push(h('div', { class: 'rt-item-line rt-item-meta' }, interleave(meta)));
        } else {
          lines.push(h('div', { class: 'rt-item-line rt-item-line--t' }, [
            h('span', { class: 'rt-badge rt-badge--cmt', text: it.type === 'comment' ? '评论' : it.type === 'space' ? '空间' : '手动' }),
            h('span', { text: (sanitizeContent(it.content) || '(无内容)').slice(0, 90) }),
          ]));
          lines.push(h('div', { class: 'rt-item-meta' }, [
            it.bv ? h('a', { class: 'rt-link', href: 'https://www.bilibili.com/video/' + it.bv, target: '_blank', rel: 'noreferrer', text: it.bv }) : null,
            h('span', { class: 'rt-dim', text: fmtTime(it.at) }),
          ]));
        }
        const tags = (it.tags || []).map((t) => h('span', { class: 'rt-mini-tag', text: t }));
        itemBox.appendChild(h('div', { class: 'rt-item' }, [
          h('div', { class: 'rt-item-main' }, lines.concat([tags.length ? h('div', { class: 'rt-item-tags' }, tags) : null])),
          h('span', {
            class: 'rt-item-x',
            title: '删除这条留痕',
            onclick: () => { removeItem(uid, it.id); renderItems(); refreshTags(); },
          }, ['×']),
        ]));
      });
    };

    const ctxBox = h('div', { class: 'rt-ctx' });
    if (ctx.type === 'space') {
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '类型：' }), h('span', { text: '用户空间' })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '昵称：' }), h('span', { class: 'rt-v', text: (ctx.title || '(未识别)').slice(0, 60) })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '页面：' }), h('a', { class: 'rt-link', href: location.href, target: '_blank', rel: 'noreferrer', text: 'space.bilibili.com/' + uid })]));
    } else if (ctx.type === 'comment') {
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '类型：' }), h('span', { text: '评论' })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row rt-ctx-cmt' }, [h('span', { class: 'rt-k', text: '内容：' }), h('span', { class: 'rt-v', text: (ctx.content || '(未识别)').slice(0, 160) })]));
      if (ctx.bv) ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '所在视频：' }), h('a', { class: 'rt-link', href: 'https://www.bilibili.com/video/' + ctx.bv, target: '_blank', rel: 'noreferrer', text: ctx.bv })]));
    } else {
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '类型：' }), h('span', { text: rec.scene === 'up' ? '视频（UP主）' : '视频' })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '标题：' }), h('span', { class: 'rt-v', text: (ctx.title || '(未识别)').slice(0, 80) })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: 'BV号：' }), ctx.bv ? h('a', { class: 'rt-link', href: 'https://www.bilibili.com/video/' + ctx.bv, target: '_blank', rel: 'noreferrer', text: ctx.bv }) : h('span', { class: 'rt-dim', text: '(未识别)' })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '时间：' }), h('span', { text: ctx.videoTime || fmtTime(Date.now()) })]));
    }

    const doAdd = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      const n = addMark(uid, nick, ctx, v);
      if (n > 0) {
        input.value = '';
        refreshTags();
        renderItems();
        hideDrop();
        toast('已添加 ' + n + ' 个标记');
      }
    };

    input.addEventListener('focus', renderDrop);
    input.addEventListener('input', renderDrop);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
      if (e.key === 'Escape') closePanel();
    });
    input.addEventListener('blur', () => setTimeout(hideDrop, 200));

    function hideDrop() { drop.style.display = 'none'; }

    function renderDrop() {
      const kw = input.value.trim().toLowerCase();
      const list = store.tagLib.filter((t) => !kw || t.toLowerCase().indexOf(kw) >= 0).slice(-30).reverse();
      while (drop.firstChild) drop.removeChild(drop.firstChild);
      if (!list.length) { hideDrop(); return; }
      list.forEach((t) => {
        drop.appendChild(h('div', {
          class: 'rt-drop-item',
          onmousedown: (ev) => {
            ev.preventDefault();
            const cur = input.value.trim();
            const parts = cur ? cur.split(/[,，;；|]+/).map((s) => s.trim()).filter(Boolean) : [];
            if (parts.indexOf(t) === -1) parts.push(t);
            input.value = parts.join('，');
            renderDrop();
          },
        }, [t]));
      });
      drop.style.display = 'block';
    }

    const panelHd = h('div', { class: 'rt-panel-hd' }, [
      h('span', { class: 'rt-panel-title', text: '标记用户' }),
      h('span', { class: 'rt-dim rt-panel-tip', text: '拖动此处移动' }),
      h('span', { class: 'rt-x', title: '关闭', onclick: closePanel, text: '×' }),
    ]);

    panel = h('div', { class: 'rt-panel' }, [
      panelHd,
      h('div', { class: 'rt-panel-bd' }, [
        h('div', { class: 'rt-user' }, [
          h('div', { class: 'rt-nick', text: nick || '(未知昵称)' }),
          h('div', { class: 'rt-uid' }, [
            h('span', { text: 'UID ' + uid }),
            h('a', { class: 'rt-link', href: 'https://space.bilibili.com/' + uid, target: '_blank', rel: 'noreferrer', text: '空间' }),
            u ? h('span', { class: 'rt-dim', text: '· 已记录 ' + (u.items || []).length + ' 条' }) : null,
          ]),
        ]),
        ctxBox,
        h('div', { class: 'rt-sec-title', text: '该用户的标记' }),
        tagBox,
        h('div', { class: 'rt-input-row' }, [
          h('div', { class: 'rt-input-wrap' }, [input, drop]),
          h('button', { class: 'rt-btn rt-btn--primary', onclick: doAdd, text: '添加' }),
        ]),
        h('div', { class: 'rt-sec-title', text: '留痕记录' }),
        itemBox,
        h('div', { class: 'rt-actions' }, [
          h('button', {
            class: 'rt-btn',
            text: '复制信息',
            onclick: () => {
              const cur = store.users[uid] || { tags: [], items: [] };
              const txt = ['昵称：' + (cur.nickname || nick), 'UID：' + uid, '标记：' + (cur.tags || []).join('、')]
                .concat((cur.items || []).slice(0, 5).map((it) => (it.type === 'video' ? '[视频] ' : it.type === 'comment' ? '[评论] ' : '[空间] ') + ((it.tags || []).join('、')) + ' | ' + (it.title || sanitizeContent(it.content) || '') + (it.bv ? ' | ' + it.bv : '')))
                .join('\n');
              copyText(txt);
            },
          }),
          h('button', { class: 'rt-btn rt-btn--danger', text: '删除该用户', onclick: () => { removeUser(uid); closePanel(); toast('已删除该用户'); } }),
        ]),
      ]),
    ]);

    document.documentElement.appendChild(panel);
    placePanel(panel, rec);
    makeDraggable(panel, panelHd);
    refreshTags();
    renderItems();
    setTimeout(() => { try { input.focus(); } catch (e) { /* 忽略 */ } }, 30);
  }

  // 面板拖拽：按住标题栏拖动，松手结束；始终限制在视口内
  function makeDraggable(el, handle) {
    if (!el || !handle) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;

    const onDown = (ev) => {
      if (ev.target && ev.target.classList && ev.target.classList.contains('rt-x')) return;
      if (ev.button != null && ev.button !== 0) return;
      const r = el.getBoundingClientRect();
      dragging = true; moved = false;
      sx = ev.clientX; sy = ev.clientY;
      ox = ev.clientX - r.left; oy = ev.clientY - r.top;
      el.classList.add('rt-dragging');
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onMove = (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      setPanelPos(el, ev.clientX - ox, ev.clientY - oy);
      ev.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('rt-dragging');
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      if (moved) {
        const r = el.getBoundingClientRect();
        const pos = { left: Math.round(r.left), top: Math.round(r.top) };
        el.__rtDragged = pos;
        if (el.classList.contains('rt-panel--mgr')) lastMgrPos = pos;
        else lastPanelPos = pos;
      }
    };
    // 结束后的一次点击不应触发面板里的按钮
    handle.addEventListener('click', (ev) => { if (moved) { ev.stopPropagation(); moved = false; } }, true);

    handle.addEventListener('mousedown', onDown);
    el.__rtDrag = true;
  }

  function setPanelPos(el, left, top) {
    const w = el.offsetWidth || 360;
    const h = el.offsetHeight || 400;
    const maxL = Math.max(4, window.innerWidth - w - 4);
    const maxT = Math.max(4, window.innerHeight - Math.min(h, window.innerHeight) - 4);
    el.style.left = Math.max(4, Math.min(left, maxL)) + 'px';
    el.style.top = Math.max(4, Math.min(top, maxT)) + 'px';
  }

  function placePanel(p, rec) {
    p.style.visibility = 'hidden';
    const w = p.offsetWidth || 360;
    const hh = p.offsetHeight || 400;
    // 本次会话里拖过面板就沿用上次的位置，避免重新打开又跳回原处
    const last = p.__rtDragged || (p.classList.contains('rt-panel--mgr') ? lastMgrPos : lastPanelPos);
    if (last) {
      setPanelPos(p, last.left, last.top);
      p.style.visibility = '';
      return;
    }
    let left = 12, top = 12;
    try {
      const r = rec.a.getBoundingClientRect();
      left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 12));
      top = r.bottom + 6;
      if (top + hh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - hh - 12);
    } catch (e) { /* 忽略 */ }
    setPanelPos(p, left, top);
    p.style.visibility = '';
  }

  function interleave(arr) {
    const out = [];
    arr.filter(Boolean).forEach((x, i) => { if (i) out.push(h('span', { class: 'rt-sep', text: '·' })); out.push(x); });
    return out;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function copyText(txt) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); toast('已复制'); return; }
    } catch (e) { /* 忽略 */ }
    try {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:-9999px' });
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('已复制');
    } catch (e) { toast('复制失败'); }
  }

  /* ====================== 管理面板 ====================== */

  let mgr = null;

  function openManager() {
    if (mgr) { mgr.remove(); mgr = null; }
    const listBox = h('div', { class: 'rt-mgr-list' });
    const search = h('input', { class: 'rt-input', type: 'text', placeholder: '搜索昵称 / UID / 标记' });

    const renderList = () => {
      const kw = search.value.trim().toLowerCase();
      const arr = Object.keys(store.users).map((k) => store.users[k]);
      arr.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
      const filtered = arr.filter((u) => {
        if (!kw) return true;
        return (u.nickname || '').toLowerCase().indexOf(kw) >= 0 ||
          String(u.uid).indexOf(kw) >= 0 ||
          (u.tags || []).join('、').toLowerCase().indexOf(kw) >= 0;
      });
      while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
      listBox.appendChild(h('div', { class: 'rt-dim', text: '共 ' + arr.length + ' 位用户 / 命中 ' + filtered.length + ' 位' }));
      filtered.slice(0, 200).forEach((u) => {
        const delUser = h('span', { class: 'rt-mgr-x', title: '删除该用户', text: '删除' });
        delUser.addEventListener('click', () => { removeUser(u.uid); renderList(); });
        const head = h('div', { class: 'rt-mgr-hd' }, [
          h('a', { class: 'rt-link rt-nick', href: 'https://space.bilibili.com/' + u.uid, target: '_blank', rel: 'noreferrer', text: u.nickname || '(未知)' }),
          h('span', { class: 'rt-dim', text: 'UID ' + u.uid }),
          h('span', { class: 'rt-dim', text: '留痕 ' + (u.items || []).length + ' 条' }),
          delUser,
        ]);

        const tagNodes = (u.tags || []).map((t) => {
          const x = h('span', { class: 'rt-tag-x', title: '删除标记', text: '×' });
          x.addEventListener('click', () => { removeTag(u.uid, t); renderList(); });
          return h('span', { class: 'rt-tag' }, [h('span', { class: 'rt-tag-t', text: t }), x]);
        });

        const addTag = h('span', { class: 'rt-mini-tag rt-mini-tag--add', title: '添加标记', text: '＋' });
        addTag.addEventListener('click', () => {
          const v = window.prompt('为该用户添加标记（多个用逗号分隔）', '');
          if (v && v.trim()) {
            addMark(u.uid, u.nickname, { type: 'manual', bv: '', title: '', videoTime: '', content: '', url: location.href }, v.trim());
            renderList();
          }
        });
        tagNodes.push(addTag);

        listBox.appendChild(h('div', { class: 'rt-mgr-item' }, [
          head,
          h('div', { class: 'rt-mgr-tags' }, tagNodes),
        ]));
      });
    };

    const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => { importJSON(String(fr.result), renderList); };
      fr.readAsText(f);
      fileInput.value = '';
    });

    const mgrHd = h('div', { class: 'rt-panel-hd' }, [
      h('span', { class: 'rt-panel-title', text: '标记管理' }),
      h('span', { class: 'rt-dim rt-panel-tip', text: '拖动此处移动' }),
      h('span', { class: 'rt-x', title: '关闭', onclick: () => { mgr.remove(); mgr = null; }, text: '×' }),
    ]);

    mgr = h('div', { class: 'rt-panel rt-panel--mgr' }, [
      mgrHd,
      h('div', { class: 'rt-panel-bd' }, [
        h('div', { class: 'rt-input-row' }, [search]),
        h('div', { class: 'rt-actions' }, [
          h('button', { class: 'rt-btn', text: '导出 JSON', onclick: exportJSON }),
          h('button', { class: 'rt-btn', text: '导入 JSON', onclick: () => fileInput.click() }),
          h('button', { class: 'rt-btn', id: 'rt-btn-stealth', text: store.settings.stealth ? '隐身模式：开' : '隐身模式：关', onclick: (ev) => { toggleStealth(); ev.target.textContent = store.settings.stealth ? '隐身模式：开' : '隐身模式：关'; } }),
          h('button', { class: 'rt-btn', id: 'rt-btn-enable', text: store.settings.enabled ? '页面渲染：开' : '页面渲染：关', onclick: (ev) => { toggleEnabled(); ev.target.textContent = store.settings.enabled ? '页面渲染：开' : '页面渲染：关'; } }),
          h('button', { class: 'rt-btn', id: 'rt-btn-dim', text: store.settings.dim ? '标记显示：半透明' : '标记显示：常显', onclick: (ev) => { toggleDim(); ev.target.textContent = store.settings.dim ? '标记显示：半透明' : '标记显示：常显'; } }),
          h('button', { class: 'rt-btn', text: '位置微调', onclick: askOffset }),
          h('button', { class: 'rt-btn', text: '重置偏移', onclick: resetOffset }),
          h('button', { class: 'rt-btn', text: '清理样式残留', onclick: purgeCSS }),
          h('button', {
            class: 'rt-btn rt-btn--danger',
            text: '清空全部',
            onclick: () => {
              if (window.confirm('确定清空全部标记数据？建议先导出备份。')) {
                store = blankStore();
                saveStore();
                renderList();
                toast('已清空');
              }
            },
          }),
        ]),
        h('div', { class: 'rt-dim', text: '隐身模式：隐藏页面上全部标记（照常记录）。页面渲染：完全停止浮层，用于排查页面异常。' }),
        listBox,
        fileInput,
      ]),
    ]);

    search.addEventListener('input', renderList);
    document.documentElement.appendChild(mgr);
    const w = 520, hh = Math.min(600, window.innerHeight - 80);
    mgr.style.left = Math.max(8, (window.innerWidth - w) / 2) + 'px';
    mgr.style.top = Math.max(8, (window.innerHeight - hh) / 2) + 'px';
    mgr.style.maxHeight = hh + 'px';
    makeDraggable(mgr, mgrHd);
    renderList();
  }

  function importJSON(text, done) {
    try {
      const o = JSON.parse(text);
      const incoming = (o && o.users) || o;
      let n = 0;
      Object.keys(incoming).forEach((uid) => {
        const src = incoming[uid];
        if (!src || !uid) return;
        const dst = store.users[uid] || { uid: uid, nickname: src.nickname || '', tags: [], items: [], createdAt: Date.now() };
        dst.nickname = src.nickname || dst.nickname;
        dst.tags = unionArr(dst.tags || [], src.tags || []);
        dst.items = (src.items || []).concat(dst.items || []).slice(0, MAX_ITEMS_PER_USER);
        dst.updatedAt = Date.now();
        store.users[uid] = dst;
        n++;
      });
      store.tagLib = unionArr(store.tagLib || [], (o && o.tagLib) || []);
      saveStore();
      if (done) done();
      toast('已导入 ' + n + ' 位用户');
    } catch (e) {
      toast('导入失败：文件不是合法 JSON');
    }
  }

  // 清理历史留痕里的 CSS 垃圾（旧版本曾把 B站组件的样式表当成评论正文存下来）
  function purgeCSS() {
    let n = 0;
    Object.keys(store.users).forEach((uid) => {
      const u = store.users[uid];
      if (!u || !u.items) return;
      u.items.forEach((it) => {
        if (!it.content) return;
        const cleaned = sanitizeContent(it.content);
        if (cleaned !== it.content) { it.content = cleaned; n++; }
      });
    });
    if (!n) { toast('没有需要清理的记录'); return; }
    saveStore();
    toast('已清理 ' + n + ' 条历史记录中的样式代码');
  }

  function unionArr(a, b) {
    const out = a.slice();
    b.forEach((x) => { if (x && out.indexOf(x) === -1) out.push(x); });
    return out;
  }

  function exportJSON() {
    try {
      const raw = JSON.stringify(store, null, 2);
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: 'replicant-tag-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('已导出 JSON');
    } catch (e) { toast('导出失败'); }
  }

  /* ====================== 隐身 / 暂停 ====================== */

  function applyStealth() {
    if (overlay) {
      overlay.style.display = (!store.settings.enabled || store.settings.stealth) ? 'none' : '';
      overlay.classList.toggle('rt-dim', !!store.settings.dim);
    }
  }

  function toggleDim() {
    store.settings.dim = !store.settings.dim;
    saveStore();
    applyStealth();
    toast(store.settings.dim ? '标记改为半透明（悬停清晰）' : '标记改为常显');
  }

  // 位置微调：整体偏移，用于适配特殊布局
  function askOffset() {
    const off = offsetSetting();
    const cur = off.x + ',' + off.y;
    const v = window.prompt('设置标记整体偏移（格式：水平,垂直，单位 px，可为负数）\n例如 40,0 表示整体右移 40px', cur);
    if (v == null) return;
    const m = String(v).match(/(-?\d+)\s*[,，]\s*(-?\d+)/);
    if (!m) { toast('格式不正确，示例：40,0'); return; }
    store.settings.offset = { x: Math.max(-400, Math.min(400, +m[1])), y: Math.max(-400, Math.min(400, +m[2])) };
    saveStore();
    requestLayout();
    toast('偏移已设为 ' + store.settings.offset.x + ',' + store.settings.offset.y);
  }

  function resetOffset() {
    store.settings.offset = { x: 0, y: 0 };
    saveStore();
    requestLayout();
    toast('偏移已重置');
  }

  function toggleStealth() {
    store.settings.stealth = !store.settings.stealth;
    saveStore();
    applyStealth();
    toast(store.settings.stealth ? '隐身模式：已开启（页面不再显示标记）' : '隐身模式：已关闭');
  }

  function toggleEnabled() {
    store.settings.enabled = !store.settings.enabled;
    saveStore();
    applyStealth();
    if (store.settings.enabled) scan();
    toast(store.settings.enabled ? '页面渲染：已开启' : '页面渲染：已关闭（数据仍可管理）');
  }

  /* ====================== 样式 ====================== */

  function injectStyle() {
    const css = [
      '#rt-overlay{position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483000;pointer-events:none}',
      '.rt-box{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:4px;pointer-events:auto;opacity:1;transition:opacity .15s;white-space:nowrap;overflow:hidden;font-family:inherit!important;line-height:1.2}',
      '.rt-box:hover{opacity:1;filter:brightness(1.08)}',
      '#rt-overlay.rt-dim .rt-box{opacity:.55}',
      '#rt-overlay.rt-dim .rt-box:hover{opacity:1}',
      '.rt-chip{display:inline-flex;align-items:center;min-width:0;max-width:120px;height:18px;padding:0 7px;border-radius:9px;background:#fb7299;color:#fff!important;font-size:12px;font-weight:500;line-height:18px;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none;box-sizing:border-box;box-shadow:0 1px 5px rgba(0,0,0,.45)}',
      '.rt-chip:hover{filter:brightness(1.1)}',
      '.rt-chip--more{background:#8a8a8a}',
      '.rt-mini{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;background:#fb7299;color:#fff!important;font-size:12px;font-weight:500;line-height:18px;cursor:pointer;user-select:none;box-shadow:0 1px 5px rgba(0,0,0,.45)}',
      '.rt-mini--add{background:#fff;color:#fb7299!important;border:1px solid #fb7299;box-shadow:0 1px 5px rgba(0,0,0,.45)}',
      '.rt-panel{position:fixed;z-index:2147483100;width:360px;max-height:72vh;overflow:auto;background:#fff;color:#222;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.28);font-size:13px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.5}',
      '.rt-panel--mgr{width:520px}',
      '.rt-panel-hd{position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fb7299;color:#fff;font-weight:600;border-radius:10px 10px 0 0;cursor:move;user-select:none;-webkit-user-select:none}',
      '.rt-panel-title{flex:none}',
      '.rt-panel-tip{flex:1;color:#ffe3ec!important;font-size:11px;font-weight:400;opacity:.9}',
      '.rt-panel.rt-dragging{box-shadow:0 14px 40px rgba(0,0,0,.4)}',
      '.rt-x{cursor:pointer;font-size:18px;line-height:1;padding:0 4px}',
      '.rt-panel-bd{padding:10px 12px 14px}',
      '.rt-user{margin-bottom:8px}',
      '.rt-nick{font-weight:600;font-size:14px;word-break:break-all}',
      '.rt-uid{display:flex;gap:8px;align-items:center;color:#666;font-size:12px;margin-top:2px}',
      '.rt-ctx{background:#f7f8fa;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px}',
      '.rt-ctx-row{display:flex;gap:4px;align-items:flex-start;margin:2px 0;word-break:break-all}',
      '.rt-ctx-cmt{max-height:64px;overflow:auto}',
      '.rt-k{color:#888;flex:none}',
      '.rt-v{color:#333}',
      '.rt-sec-title{font-weight:600;margin:10px 0 6px;font-size:13px;color:#333}',
      '.rt-tags,.rt-mgr-tags{display:flex;flex-wrap:wrap;gap:6px}',
      '.rt-tag{display:inline-flex;align-items:center;gap:4px;max-width:100%;background:#ffefd5;color:#a05a00;border-radius:10px;padding:2px 6px;font-size:12px}',
      '.rt-tag-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}',
      '.rt-tag-x{cursor:pointer;color:#c00;font-weight:700;padding:0 2px}',
      '.rt-empty{color:#aaa;font-size:12px}',
      '.rt-input-row{display:flex;gap:6px;margin:6px 0 10px}',
      '.rt-input-wrap{position:relative;flex:1}',
      '.rt-input{width:100%;box-sizing:border-box;height:30px;padding:0 8px;border:1px solid #dcdfe6;border-radius:6px;font-size:13px;outline:none;color:#222;background:#fff}',
      '.rt-input:focus{border-color:#fb7299}',
      '.rt-drop{display:none;position:absolute;left:0;right:0;top:32px;max-height:180px;overflow:auto;background:#fff;border:1px solid #dcdfe6;border-radius:6px;z-index:5;box-shadow:0 4px 14px rgba(0,0,0,.12)}',
      '.rt-drop-item{padding:5px 8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.rt-drop-item:hover{background:#fff0f5}',
      '.rt-items{max-height:220px;overflow:auto;border-top:1px dashed #eee;padding-top:6px}',
      '.rt-item{display:flex;gap:6px;padding:6px 0;border-bottom:1px dashed #f0f0f0}',
      '.rt-item-main{flex:1;min-width:0}',
      '.rt-item-line{word-break:break-all}',
      '.rt-item-line--t{margin-bottom:2px}',
      '.rt-item-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;color:#888;font-size:11px}',
      '.rt-item-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}',
      '.rt-mini-tag{background:#eef3ff;color:#3a6ff2;border-radius:8px;padding:0 6px;font-size:11px}',
      '.rt-mini-tag--add{cursor:pointer;background:#f0f0f0;color:#666}',
      '.rt-item-x{cursor:pointer;color:#bbb;font-size:14px;flex:none;padding:0 2px}',
      '.rt-item-x:hover{color:#c00}',
      '.rt-badge{display:inline-block;padding:0 5px;border-radius:4px;font-size:11px;margin-right:5px;color:#fff}',
      '.rt-badge--video{background:#00a1d6}',
      '.rt-badge--cmt{background:#fb7299}',
      '.rt-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
      '.rt-btn{height:28px;padding:0 10px;border:1px solid #dcdfe6;background:#fff;color:#333;border-radius:6px;font-size:12px;cursor:pointer}',
      '.rt-btn:hover{border-color:#fb7299;color:#fb7299}',
      '.rt-btn--primary{background:#fb7299;border-color:#fb7299;color:#fff;flex:none}',
      '.rt-btn--primary:hover{color:#fff;filter:brightness(1.05)}',
      '.rt-btn--danger{color:#c00;border-color:#f3c9c9}',
      '.rt-link{color:#00a1d6!important;text-decoration:none}',
      '.rt-link:hover{text-decoration:underline}',
      '.rt-dim{color:#999;font-size:11px}',
      '.rt-sep{color:#ccc;margin:0 2px}',
      '.rt-mgr-list{margin-top:10px}',
      '.rt-mgr-item{border:1px solid #f0f0f0;border-radius:8px;padding:8px 10px;margin-bottom:8px}',
      '.rt-mgr-hd{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.rt-mgr-x{margin-left:auto;color:#c00;cursor:pointer;font-size:12px}',
      '.rt-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%) translateY(20px);background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:18px;font-size:13px;z-index:2147483200;opacity:0;transition:.2s;pointer-events:none}',
      '.rt-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',
    ].join('\n');
    try { GM_addStyle(css); } catch (e) {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    }
  }

  function toast(msg) {
    let t = document.getElementById('rt-toast');
    if (!t) {
      t = h('div', { id: 'rt-toast', class: 'rt-toast' });
      (document.documentElement || document.body).appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t.__t);
    t.__t = setTimeout(() => t.classList.remove('show'), 2000);
  }

  /* ====================== 启动 ====================== */

  function init() {
    injectStyle();
    ensureOverlay();
    applyStealth();
    scan();

    // 页面结构变化 -> 防抖重扫（只读取，不写入页面 DOM）
    try {
      new MutationObserver(() => scheduleScan()).observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* 忽略 */ }

    // 位置跟随滚动 / 缩放
    window.addEventListener('scroll', requestLayout, true);
    window.addEventListener('resize', requestLayout);
    document.addEventListener('scroll', requestLayout, true);

    // 定时兜底：应对纯 CSS 布局变化与懒加载
    setInterval(() => { scan(); }, 3000);

    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); toggleStealth(); }
      if (e.key === 'Escape') closePanel();
    });
    document.addEventListener('click', (e) => {
      if (panel && !panel.contains(e.target) && !(overlay && overlay.contains(e.target))) closePanel();
    }, true);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开标记管理面板', openManager);
      GM_registerMenuCommand('切换隐身模式（Alt+Shift+M）', toggleStealth);
      GM_registerMenuCommand('开启/关闭页面渲染（排查用）', toggleEnabled);
      GM_registerMenuCommand('标记显示：常显 / 半透明', toggleDim);
      GM_registerMenuCommand('清理历史留痕中的样式代码', purgeCSS);
      GM_registerMenuCommand('位置微调（整体偏移）', askOffset);
      GM_registerMenuCommand('重置位置偏移', resetOffset);
      GM_registerMenuCommand('立即重新定位标记', () => { scan(); toast('已重新定位'); });
      GM_registerMenuCommand('导出标记数据（JSON）', exportJSON);
      GM_registerMenuCommand('导入标记数据（JSON）', () => {
        const inp = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
        inp.addEventListener('change', () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => importJSON(String(fr.result));
          fr.readAsText(f);
        });
        document.documentElement.appendChild(inp);
        inp.click();
        setTimeout(() => inp.remove(), 3000);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 供测试使用
  window.__rt = {
    computePos: computePos,
    targets: targets,
    store: () => store,
    isAvatarLink: isAvatarLink,
    dedupeAnchors: dedupeAnchors,
    isSpacePage: isSpacePage,
    spaceUid: spaceUid,
    sanitizeContent: sanitizeContent,
    looksLikeCSS: looksLikeCSS,
    commentContent: commentContent,
    purgeCSS: purgeCSS,
  };
})();
