// ==UserScript==
// @name         ReplicantTag · 用户标记器（昵称/UID · 视频/评论留痕）
// @name:zh-CN   ReplicantTag · 用户标记器（昵称/UID · 视频/评论留痕）
// @namespace    https://github.com/saiyajiang/ReplicantTag
// @version      1.0.0
// @description  给视频或评论对应的用户打标记：自动记录昵称与UID；标记视频时同时记录标题、BV号与视频时间，标记评论时记录评论内容。标记可下拉复用，一个用户可有多个标记；标记直接显示在评论区等级右侧、视频卡片头像与标题之间，支持隐身模式一键隐藏全部痕迹，支持导出/导入备份。目前支持B站，后续将扩展至更多站点。本脚本由 AI 编写。
// @author       saiyajiang
// @match        *://*.bilibili.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @license      MIT
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

  const LINK_SEL = 'a[href*="space.bilibili.com/"]';
  const CARD_SEL = ['bili-video-card', '.bili-video-card', '.video-card', '.small-item', '.cover'];
  const UP_SEL = ['.up-panel-container', '.up-info-container', '.up-detail-container', '.up-info--container', '.video-owner', '[class*="up-info"]', '.up-box', '.bili-video-owner'];
  const COMMENT_SEL = ['bili-comment', 'bili-comment-thread-renderer', 'bili-comment-reply-renderer', '#comment', '.comment', '.reply-wrap', '.reply-item', '[class*="comment"]', '[class*="reply"]'];
  const LEVEL_SEL = ['bili-comment-user-level', '.level', '.user-level', '[class*="level"]'];
  const TITLE_SEL = ['h1.video-title', '.video-title', '.tit', '.title'];
  const PUBDATE_SEL = ['[class*="pubdate"]', '[class*="pub-date"]', '.video-data .date', '.bili-video-info__date'];

  /* ====================== 存储 ====================== */

  const DEFAULT_STORE = { users: {}, tagLib: [], settings: { stealth: false }, rev: 0 };
  let store = readStore();
  let storeRev = store.rev || 0;

  function blankStore() {
    return { users: {}, tagLib: [], settings: { stealth: false }, rev: 0 };
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
        settings: Object.assign({ stealth: false }, (o && o.settings) || {}),
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
    refreshAllSlots();
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
      type: ctx.type,                 // 'video' | 'comment'
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

  // 收集所有需要搜索的根：document + 各层 ShadowRoot
  function collectRoots() {
    const roots = [document];
    let frontier = [document];
    for (let d = 0; d < SHADOW_DEPTH; d++) {
      const next = [];
      for (const root of frontier) {
        let els;
        try { els = root.querySelectorAll('*'); } catch (e) { continue; }
        for (const el of els) {
          if (el.shadowRoot) { roots.push(el.shadowRoot); next.push(el.shadowRoot); }
        }
      }
      if (!next.length) break;
      frontier = next;
    }
    return roots;
  }

  function deepFindFirst(root, sels) {
    if (!root) return null;
    const queue = [root];
    let depth = 0;
    while (queue.length && depth < SHADOW_DEPTH * 20) {
      const r = queue.shift();
      let els;
      try { els = r.querySelectorAll('*'); } catch (e) { continue; }
      for (const el of els) {
        if (matches(el, sels)) return el;
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
      depth++;
    }
    return null;
  }

  // 取文本（包含 Shadow DOM 内的文本）
  function textOf(el) {
    if (!el) return '';
    let out = '';
    const walk = (n, lv) => {
      if (lv > 6) return;
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.shadowRoot) walk(c.shadowRoot, lv + 1);
          walk(c, lv + 1);
        }
      }
    };
    if (el.shadowRoot) walk(el.shadowRoot, 0);
    walk(el, 0);
    return out.replace(/\s+/g, ' ').trim();
  }

  function uidFromHref(href) {
    const s = String(href || '');
    const m = s.match(/space\.bilibili\.com\/(\d+)/);
    return m ? m[1] : '';
  }

  function bvFromHost(host) {
    if (!host) return '';
    const a = deepFindFirst(host.shadowRoot || host, ['a[href*="/video/BV"]', 'a[href*="bilibili.com/video"]']);
    if (a) {
      const m = String(a.getAttribute('href') || a.href || '').match(/(BV[0-9A-Za-z]{10})/);
      if (m) return m[1];
    }
    if (host.getAttribute) {
      const attr = host.getAttribute('bvid') || host.getAttribute('data-bvid') || host.getAttribute('data-bv');
      if (attr) return attr;
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
    const up = findInChain(UP_SEL);
    if (up) return { scene: 'up', host: up };
    const cmt = findInChain(COMMENT_SEL);
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

  function buildCtx(a) {
    const host = a.__rtHost;
    const scene = a.__rtScene;
    if (scene === 'comment') {
      const body = deepFindFirst(host && (host.shadowRoot || host), ['bili-rich-text', '.reply-content', '.root-reply', '.comment-content', '[class*="reply-content"]', '[class*="content"]']);
      return {
        type: 'comment',
        content: (body ? textOf(body) : textOf(host)).slice(0, 500),
        bv: currentBV(),
        title: currentTitle(),
        videoTime: currentPubDate(),
        url: location.href,
      };
    }
    return {
      type: 'video',
      bv: bvFromHost(host) || currentBV(),
      title: textOf(deepFindFirst(host && (host.shadowRoot || host), ['.bili-video-card__info--tit', '[class*="info--tit"]', '.title', '.tit'])) || currentTitle(),
      videoTime: textOf(deepFindFirst(host && (host.shadowRoot || host), ['[class*="date"]', '[class*="time"]'])) || currentPubDate(),
      content: '',
      url: location.href,
    };
  }

  /* ====================== 页面内标记展示 ====================== */

  const slotRecords = []; // { a, slot, rev }

  function ensureSlot(a) {
    if (a.__rtSlot && a.__rtSlot.isConnected) return a.__rtSlot;
    const c = classify(a);
    if (!c) return null;
    const uid = uidFromHref(a.getAttribute('href') || a.href || '');
    if (!uid) return null;
    const nick = (textOf(a) || a.getAttribute('title') || '').slice(0, 60);

    a.__rtUid = uid;
    a.__rtNick = nick;
    a.__rtScene = c.scene;
    a.__rtHost = c.host;

    const slot = h('span', { class: 'rt-slot', 'data-uid': uid });
    if (!insertSlot(a, slot, c)) return null;
    a.__rtSlot = slot;
    slotRecords.push({ a: a, slot: slot, rev: -1 });
    renderSlot(a);
    return slot;
  }

  function insertSlot(a, slot, c) {
    try {
      if (c.scene === 'comment') {
        const lv = findLevel(a);
        if (lv && lv.parentNode) { lv.parentNode.insertBefore(slot, lv.nextSibling); return true; }
        if (a.parentNode) { a.parentNode.insertBefore(slot, a.nextSibling); return true; }
        return false;
      }
      if (c.scene === 'up') {
        // 播放页：插在 UP 面板上方（即视频标题与 UP 头像之间）
        const upHost = c.host;
        if (upHost && upHost.parentNode && upHost.parentNode.nodeType === 1) {
          upHost.parentNode.insertBefore(slot, upHost);
          return true;
        }
        if (a.parentNode) { a.parentNode.insertBefore(slot, a.nextSibling); return true; }
        return false;
      }
      // card：视频卡片，插在标题与 UP 行（头像+昵称）之间
      const root = (c.host && (c.host.shadowRoot || c.host)) || document;
      const title = deepFindFirst(root, ['.bili-video-card__info--tit', '[class*="info--tit"]', '.bili-video-card__info--title', '.title']);
      const owner = deepFindFirst(root, ['.bili-video-card__info--owner', '[class*="info--owner"]', '[class*="info--author"]', '.up-name']) || a;
      if (title && owner && title !== owner && title.parentNode === owner.parentNode) {
        const pos = title.compareDocumentPosition(owner);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) title.parentNode.insertBefore(slot, title.nextSibling);
        else owner.parentNode.insertBefore(slot, owner.nextSibling);
        return true;
      }
      if (owner && owner.parentNode) { owner.parentNode.insertBefore(slot, owner.nextSibling); return true; }
      if (a.parentNode) { a.parentNode.insertBefore(slot, a.nextSibling); return true; }
      return false;
    } catch (e) {
      return false;
    }
  }

  function chip(text, onClick, title) {
    return h('span', {
      class: 'rt-chip',
      title: title || text,
      onclick: onClick,
    }, [text.length > 12 ? text.slice(0, 12) + '…' : text]);
  }

  function renderSlot(a) {
    const slot = a.__rtSlot;
    if (!slot) return;
    const uid = a.__rtUid;
    const u = store.users[uid];
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    if (u && u.tags && u.tags.length) {
      u.tags.slice(0, MAX_CHIPS).forEach((t) => {
        slot.appendChild(chip(t, (ev) => { ev.preventDefault(); ev.stopPropagation(); openPanel(a); }));
      });
      if (u.tags.length > MAX_CHIPS) {
        slot.appendChild(chip('+' + (u.tags.length - MAX_CHIPS), (ev) => {
          ev.preventDefault(); ev.stopPropagation(); openPanel(a);
        }, u.tags.join('、')));
      }
    }
    if (!u || !u.tags || !u.tags.length) {
      slot.appendChild(h('span', {
        class: 'rt-btn-mini',
        title: '给该用户添加标记',
        onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); openPanel(a); },
      }, ['＋标']));
    } else {
      slot.appendChild(h('span', {
        class: 'rt-btn-mini rt-btn-mini--ghost',
        title: '编辑该用户的标记',
        onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); openPanel(a); },
      }, ['✎']));
    }
  }

  function refreshAllSlots() {
    for (const rec of slotRecords) {
      if (!rec.slot.isConnected) continue;
      if (rec.rev !== storeRev) { renderSlot(rec.a); rec.rev = storeRev; }
    }
  }

  /* ====================== 标记面板 ====================== */

  let panel = null;
  let panelAnchor = null;

  function closePanel() {
    if (panel) { panel.remove(); panel = null; panelAnchor = null; }
  }

  function openPanel(a) {
    closePanel();
    panelAnchor = a;
    const uid = a.__rtUid;
    const nick = a.__rtNick || (store.users[uid] && store.users[uid].nickname) || '';
    const ctx = buildCtx(a);
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
            h('span', { class: 'rt-badge rt-badge--cmt', text: '评论' }),
            h('span', { text: (it.content || '(无内容)').slice(0, 90) }),
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
    if (ctx.type === 'video') {
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '类型：' }), h('span', { text: '视频' })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '标题：' }), h('span', { class: 'rt-v', text: (ctx.title || '(未识别)').slice(0, 80) })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: 'BV号：' }), ctx.bv ? h('a', { class: 'rt-link', href: 'https://www.bilibili.com/video/' + ctx.bv, target: '_blank', rel: 'noreferrer', text: ctx.bv }) : h('span', { class: 'rt-dim', text: '(未识别)' })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '时间：' }), h('span', { text: ctx.videoTime || fmtTime(Date.now()) })]));
    } else {
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '类型：' }), h('span', { text: '评论' })]));
      ctxBox.appendChild(h('div', { class: 'rt-ctx-row rt-ctx-cmt' }, [h('span', { class: 'rt-k', text: '内容：' }), h('span', { class: 'rt-v', text: (ctx.content || '(未识别)').slice(0, 160) })]));
      if (ctx.bv) ctxBox.appendChild(h('div', { class: 'rt-ctx-row' }, [h('span', { class: 'rt-k', text: '所在视频：' }), h('a', { class: 'rt-link', href: 'https://www.bilibili.com/video/' + ctx.bv, target: '_blank', rel: 'noreferrer', text: ctx.bv })]));
    }

    const doAdd = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      const n = addMark(uid, nick, ctx, v);
      if (n > 0) {
        input.value = '';
        refreshTags();
        renderItems();
        renderSlot(a);
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

    const body = h('div', { class: 'rt-panel-bd' }, [
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
              .concat((cur.items || []).slice(0, 5).map((it) => (it.type === 'video' ? '[视频] ' : '[评论] ') + ((it.tags || []).join('、')) + ' | ' + (it.title || it.content || '') + (it.bv ? ' | ' + it.bv : '')))
              .join('\n');
            copyText(txt);
          },
        }),
        h('button', { class: 'rt-btn rt-btn--danger', text: '删除该用户', onclick: () => { removeUser(uid); closePanel(); toast('已删除该用户'); } }),
      ]),
    ]);

    panel = h('div', { class: 'rt-panel' }, [
      h('div', { class: 'rt-panel-hd' }, [
        h('span', { text: '标记用户' }),
        h('span', { class: 'rt-x', title: '关闭', onclick: closePanel, text: '×' }),
      ]),
      body,
    ]);

    document.body.appendChild(panel);
    placePanel(panel, a);
    refreshTags();
    renderItems();
    setTimeout(() => { try { input.focus(); } catch (e) { /* 忽略 */ } }, 30);
  }

  function placePanel(p, anchor) {
    p.style.visibility = 'hidden';
    const w = p.offsetWidth || 360;
    const hh = p.offsetHeight || 400;
    let left = 12, top = 12;
    try {
      const r = anchor.getBoundingClientRect();
      left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 12));
      top = r.bottom + 6;
      if (top + hh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - hh - 12);
    } catch (e) { /* 忽略 */ }
    p.style.left = left + 'px';
    p.style.top = top + 'px';
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
        listBox.appendChild(h('div', { class: 'rt-mgr-item' }, [
          h('div', { class: 'rt-mgr-hd' }, [
            h('a', { class: 'rt-link rt-nick', href: 'https://space.bilibili.com/' + u.uid, target: '_blank', rel: 'noreferrer', text: u.nickname || '(未知)' }),
            h('span', { class: 'rt-dim', text: 'UID ' + u.uid }),
            h('span', { class: 'rt-dim', text: '留痕 ' + (u.items || []).length + ' 条' }),
            h('span', { class: 'rt-mgr-x', title: '删除该用户', onclick: () => { removeUser(u.uid); renderList(); }, text: '删除' }),
          ]),
          h('div', { class: 'rt-mgr-tags' }, (u.tags || []).map((t) => h('span', { class: 'rt-tag' }, [
            h('span', { class: 'rt-tag-t', text: t }),
            h('span', { class: 'rt-tag-x', title: '删除标记', onclick: () => { removeTag(u.uid, t); renderList(); }, text: '×' }),
          ])).concat([h('span', {
            class: 'rt-mini-tag rt-mini-tag--add',
            title: '添加标记',
            text: '＋',
            onclick: () => {
              const v = window.prompt('为该用户添加标记（多个用逗号分隔）', '');
              if (v && v.trim()) {
                addMark(u.uid, u.nickname, { type: 'manual', bv: '', title: '', videoTime: '', content: '', url: location.href }, v.trim());
                renderList();
              }
            },
          })])),
        ]));
      });
    };

    const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const o = JSON.parse(String(fr.result));
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
          renderList();
          toast('已导入 ' + n + ' 位用户');
        } catch (e) { toast('导入失败：文件不是合法 JSON'); }
      };
      fr.readAsText(f);
      fileInput.value = '';
    });

    mgr = h('div', { class: 'rt-panel rt-panel--mgr' }, [
      h('div', { class: 'rt-panel-hd' }, [
        h('span', { text: '标记管理' }),
        h('span', { class: 'rt-x', title: '关闭', onclick: () => { mgr.remove(); mgr = null; }, text: '×' }),
      ]),
      h('div', { class: 'rt-panel-bd' }, [
        h('div', { class: 'rt-input-row' }, [search]),
        h('div', { class: 'rt-actions' }, [
          h('button', { class: 'rt-btn', text: '导出 JSON', onclick: exportJSON }),
          h('button', { class: 'rt-btn', text: '导入 JSON', onclick: () => fileInput.click() }),
          h('button', {
            class: 'rt-btn',
            text: store.settings.stealth ? '隐身模式：开' : '隐身模式：关',
            onclick: (ev) => { toggleStealth(); ev.target.textContent = store.settings.stealth ? '隐身模式：开' : '隐身模式：关'; },
          }),
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
        listBox,
        fileInput,
      ]),
    ]);

    search.addEventListener('input', renderList);
    document.body.appendChild(mgr);
    const w = 520, hh = Math.min(600, window.innerHeight - 80);
    mgr.style.left = Math.max(8, (window.innerWidth - w) / 2) + 'px';
    mgr.style.top = Math.max(8, (window.innerHeight - hh) / 2) + 'px';
    mgr.style.maxHeight = hh + 'px';
    renderList();
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
      const a = h('a', { href: url, download: 'bili-user-marker-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('已导出 JSON');
    } catch (e) { toast('导出失败'); }
  }

  /* ====================== 隐身模式 ====================== */

  function applyStealth() {
    try { document.body.classList.toggle('rt-stealth', !!store.settings.stealth); } catch (e) { /* 忽略 */ }
  }

  function toggleStealth() {
    store.settings.stealth = !store.settings.stealth;
    saveStore();
    applyStealth();
    toast(store.settings.stealth ? '隐身模式：已开启（页面不再显示标记与入口）' : '隐身模式：已关闭');
  }

  /* ====================== 扫描循环 ====================== */

  let scheduled = false;
  function scheduleScan(immediate) {
    if (immediate) { doScan(); return; }
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; doScan(); }, 400);
  }

  function doScan() {
    if (!document.body) return;
    // 清理失效记录
    for (let i = slotRecords.length - 1; i >= 0; i--) {
      if (!slotRecords[i].slot.isConnected) slotRecords.splice(i, 1);
    }
    let links;
    try {
      const roots = collectRoots();
      links = [];
      for (const r of roots) {
        try { r.querySelectorAll(LINK_SEL).forEach((a) => links.push(a)); } catch (e) { /* 忽略 */ }
      }
    } catch (e) { return; }

    for (const a of links) {
      if (a.closest && a.closest('.rt-slot, .rt-panel')) continue;
      try { ensureSlot(a); } catch (e) { /* 单条失败不影响整体 */ }
    }
    // 数据变更后刷新展示
    for (const rec of slotRecords) {
      if (rec.rev !== storeRev) { renderSlot(rec.a); rec.rev = storeRev; }
    }
  }

  /* ====================== 样式 ====================== */

  function injectStyle() {
    const css = [
      '.rt-slot{display:inline-flex;align-items:center;gap:4px;vertical-align:middle;margin:0 4px;max-width:100%;flex-wrap:wrap;font-family:inherit!important}',
      '.rt-chip{display:inline-flex;align-items:center;max-width:120px;height:18px;padding:0 7px;border-radius:9px;background:#fb7299;color:#fff!important;font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none;box-sizing:border-box}',
      '.rt-chip:hover{filter:brightness(1.08)}',
      '.rt-btn-mini{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;background:rgba(251,114,153,.12);color:#fb7299!important;font-size:12px;line-height:18px;cursor:pointer;user-select:none;opacity:.75}',
      '.rt-btn-mini:hover{opacity:1}',
      '.rt-btn-mini--ghost{background:transparent;color:#999!important;padding:0 3px}',
      '.rt-panel{position:fixed;z-index:2147483000;width:360px;max-height:72vh;overflow:auto;background:#fff;color:#222;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.28);font-size:13px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.5}',
      '.rt-panel--mgr{width:520px}',
      '.rt-panel-hd{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#fb7299;color:#fff;font-weight:600;border-radius:10px 10px 0 0}',
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
      '.rt-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%) translateY(20px);background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:18px;font-size:13px;z-index:2147483100;opacity:0;transition:.2s;pointer-events:none}',
      '.rt-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',
      '.rt-stealth .rt-slot,.rt-stealth .rt-chip,.rt-stealth .rt-btn-mini{display:none!important}',
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
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t.__t);
    t.__t = setTimeout(() => t.classList.remove('show'), 2000);
  }

  /* ====================== 启动 ====================== */

  function init() {
    injectStyle();
    applyStealth();
    doScan();
    setInterval(doScan, 2000);
    try {
      new MutationObserver(() => scheduleScan()).observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* 忽略 */ }
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); toggleStealth(); }
      if (e.key === 'Escape') closePanel();
    });
    document.addEventListener('click', (e) => {
      if (panel && !panel.contains(e.target) && !(panelAnchor && panelAnchor.contains(e.target))) closePanel();
    }, true);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开标记管理面板', openManager);
      GM_registerMenuCommand('切换隐身模式（Alt+Shift+M）', toggleStealth);
      GM_registerMenuCommand('导出标记数据（JSON）', exportJSON);
      GM_registerMenuCommand('导入标记数据（JSON）', () => {
        const inp = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
        inp.addEventListener('change', () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            try {
              const o = JSON.parse(String(fr.result));
              const incoming = (o && o.users) || o;
              Object.keys(incoming).forEach((uid) => {
                const src = incoming[uid];
                if (!src || !uid) return;
                const dst = store.users[uid] || { uid: uid, nickname: src.nickname || '', tags: [], items: [], createdAt: Date.now() };
                dst.nickname = src.nickname || dst.nickname;
                dst.tags = unionArr(dst.tags || [], src.tags || []);
                dst.items = (src.items || []).concat(dst.items || []).slice(0, MAX_ITEMS_PER_USER);
                store.users[uid] = dst;
              });
              store.tagLib = unionArr(store.tagLib || [], (o && o.tagLib) || []);
              saveStore();
              toast('已导入');
            } catch (err) { toast('导入失败'); }
          };
          fr.readAsText(f);
        });
        document.body.appendChild(inp);
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
})();
