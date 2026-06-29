/**
 * block-chat-tel-links.js
 *
 * 토닥이(todaqi.com) 페이지에서 "/chat" 이 포함된 링크와 "tel:" 전화 링크를
 * 클릭/이동하지 못하도록 강제하는 가드 스크립트.
 *
 * 사용처:
 *  1) TBP5 (TrafficBotPro) > Custom Operate > Insert JS 에 그대로 붙여넣기
 *     -> 봇이 내부 링크를 랜덤 클릭해도 채팅(/chat)·전화(tel:) 링크는 절대 눌리지 않음
 *  2) 사이트에 직접 <script> 로 삽입해도 동일하게 동작
 *
 * 동작 방식:
 *  - 매칭 링크를 클릭 불가(pointer-events:none, tabindex 제거, href 백업 후 제거)로 마킹
 *  - 캡처 단계(capture phase)에서 click/pointer/mouse/touch/keydown(Enter) 가로채 차단
 *  - window.open / location 이동까지 방어
 *  - SPA/지연 로딩 대비 MutationObserver 로 새로 생기는 링크에도 자동 재적용
 */
(function () {
  'use strict';

  // ── 1) 차단할 링크 판별 규칙 ────────────────────────────────────────────
  // 필요하면 패턴을 추가/수정하세요.
  var SELECTOR = [
    'a[href*="/chat"]',          // 경로에 /chat 포함
    'a[href^="tel:"]',           // tel: 전화 링크
    'a[href*="tel:"]',           // 혹시 앞에 다른 스킴이 붙은 경우까지
    '[data-href*="/chat"]',      // data-href 로 라우팅하는 커스텀 링크
    '[onclick*="/chat"]'         // onclick 안에 /chat 이 있는 경우
  ].join(',');

  // href 문자열 자체로도 한 번 더 검사 (상대/절대경로, 대소문자 무관)
  function hrefBlocked(href) {
    if (!href) return false;
    var h = String(href).toLowerCase();
    return h.indexOf('/chat') !== -1 || h.indexOf('tel:') === 0 || h.indexOf('tel:') !== -1;
  }

  var DEBUG = false;
  function log() { if (DEBUG && window.console) console.log.apply(console, ['[block-chat-tel]'].concat([].slice.call(arguments))); }

  // ── 2) 요소(또는 부모 링크)가 차단 대상인지 판별 ──────────────────────────
  function matchedLink(node) {
    if (!node || node.nodeType !== 1) return null;
    var el = (typeof node.closest === 'function') ? node.closest('a,[data-href],[onclick]') : node;
    while (el) {
      if (el.matches && el.matches(SELECTOR)) return el;
      var href = el.getAttribute && (el.getAttribute('href') || el.getAttribute('data-href'));
      if (hrefBlocked(href)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── 3) 매칭 링크를 클릭 불가 상태로 마킹 ──────────────────────────────────
  function harden(el) {
    if (!el || el.__linkBlocked) return;
    el.__linkBlocked = true;
    try {
      // href 를 백업 후 제거 -> 네이티브 네비게이션 자체를 막음
      if (el.hasAttribute && el.hasAttribute('href')) {
        el.setAttribute('data-blocked-href', el.getAttribute('href'));
        el.removeAttribute('href');
      }
      el.removeAttribute && el.removeAttribute('onclick');
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('cursor', 'default', 'important');
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('data-link-blocked', '1');
      el.setAttribute('tabindex', '-1');
    } catch (e) { /* noop */ }
    log('hardened', el);
  }

  function hardenAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list;
    try { list = scope.querySelectorAll(SELECTOR); } catch (e) { list = []; }
    for (var i = 0; i < list.length; i++) harden(list[i]);
    // 셀렉터로 못 잡는 href 도 한 번 더 훑기
    var anchors = scope.querySelectorAll ? scope.querySelectorAll('a[href],[data-href]') : [];
    for (var j = 0; j < anchors.length; j++) {
      var a = anchors[j];
      var href = a.getAttribute('href') || a.getAttribute('data-href');
      if (hrefBlocked(href)) harden(a);
    }
  }

  // ── 4) 캡처 단계 이벤트 차단 ────────────────────────────────────────────
  function blocker(e) {
    var hit = matchedLink(e.target);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      log('blocked', e.type, hit);
      return false;
    }
  }

  var EVENTS = ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'auxclick', 'keydown'];
  EVENTS.forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (type === 'keydown' && !(e.key === 'Enter')) return;
      blocker(e);
    }, true); // capture = true 가 핵심
  });

  // ── 5) 프로그램적 이동(window.open / location)도 방어 ──────────────────────
  try {
    var origOpen = window.open;
    window.open = function (url) {
      if (hrefBlocked(url)) { log('window.open blocked', url); return null; }
      return origOpen.apply(window, arguments);
    };
  } catch (e) { /* 무시 */ }

  // ── 6) 초기 적용 + 동적 로딩 감시 ──────────────────────────────────────
  function init() {
    hardenAll(document);
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches(SELECTOR)) harden(n);
            hardenAll(n);
          }
          // 속성 변경(href 가 나중에 주입되는 경우)도 대응
          if (muts[i].type === 'attributes' && muts[i].target) {
            var t = muts[i].target;
            var href = t.getAttribute && (t.getAttribute('href') || t.getAttribute('data-href'));
            if (hrefBlocked(href)) harden(t);
          }
        }
      });
      mo.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-href']
      });
    } else {
      setInterval(function () { hardenAll(document); }, 1000);
    }
    log('initialized for', SELECTOR);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
