/**
 * disable-video-play.js
 *
 * 토닥이(todaqi.com) "관리사 페이지"에서 동영상 재생버튼이 클릭/재생되지 않도록
 * 강제하는 가드 스크립트.
 *
 * 사용처:
 *  1) TBP5 (TrafficBotPro) > Custom Operate > Insert JS 에 그대로 붙여넣기
 *     -> 봇이 랜덤 클릭/내부 동작을 해도 재생버튼은 절대 눌리지 않음 (트래픽/대역폭 절약)
 *  2) 사이트(관리사 페이지)에 직접 <script>로 삽입해도 동일하게 동작
 *
 * 동작 방식:
 *  - 지정 셀렉터에 매칭되는 재생버튼을 클릭 불가(pointer-events:none, tabindex 제거)로 만들고
 *  - 캡처 단계(capture phase)에서 click/pointerdown/mousedown/touchstart/keydown 을 가로채 차단
 *  - <video> 의 네이티브 play() 호출 자체도 무력화(autoplay/프로그램 재생까지 방지)
 *  - SPA/지연 로딩 대비 MutationObserver 로 새로 생기는 버튼에도 자동 재적용
 *
 * !!! 중요 !!!
 *  실제 todaqi.com 관리사 페이지의 재생버튼 셀렉터를 SELECTORS 맨 위에 추가하세요.
 *  (개발자도구에서 버튼 우클릭 > Copy > Copy selector 로 확보)
 *  아래 값들은 흔한 패턴에 대한 폴백입니다.
 */
(function () {
  'use strict';

  // ── 1) 차단할 재생버튼 셀렉터 (여기에 실제 셀렉터를 최상단에 추가) ──────────────
  var SELECTORS = [
    // 예: '.manager-page .video-play-btn',  <- 실제 셀렉터로 교체/추가
    '[data-role="play"]',
    '.video-play-button',
    '.play-button',
    '.btn-play',
    '.vjs-big-play-button',          // video.js
    '.plyr__control--overlaid',      // Plyr
    '.jw-icon-playback',             // JW Player
    'button[aria-label*="재생"]',
    'button[aria-label*="play" i]',
    'button[title*="재생"]',
    'button[title*="play" i]',
    'a[aria-label*="재생"]',
    '[class*="play"][class*="btn"]',
    '[class*="play"][role="button"]'
  ];

  var SELECTOR = SELECTORS.join(',');

  // 차단 시 콘솔 로그를 보고 싶으면 true
  var DEBUG = false;
  function log() { if (DEBUG && window.console) console.log.apply(console, ['[disable-video-play]'].concat([].slice.call(arguments))); }

  // ── 2) 요소가 재생버튼(또는 그 내부)인지 판별 ──────────────────────────────
  function isPlayTarget(node) {
    if (!node || node.nodeType !== 1) return false;
    if (typeof node.closest === 'function') {
      return !!node.closest(SELECTOR);
    }
    // closest 미지원 폴백
    var el = node;
    while (el) {
      if (el.matches && el.matches(SELECTOR)) return true;
      el = el.parentElement;
    }
    return false;
  }

  // ── 3) 매칭 버튼을 클릭 불가 상태로 마킹 ──────────────────────────────────
  function harden(el) {
    if (!el || el.__playDisabled) return;
    el.__playDisabled = true;
    try {
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('cursor', 'default', 'important');
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('data-play-disabled', '1');
      if ('disabled' in el) { try { el.disabled = true; } catch (e) {} }
      // 키보드 포커스로도 못 누르게
      el.setAttribute('tabindex', '-1');
    } catch (e) { /* noop */ }
    log('hardened', el);
  }

  function hardenAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list;
    try { list = scope.querySelectorAll(SELECTOR); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) harden(list[i]);
  }

  // ── 4) 캡처 단계 이벤트 차단 (버블링 전에 가로채 무조건 막음) ─────────────────
  function blocker(e) {
    var t = e.target;
    if (isPlayTarget(t)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      log('blocked', e.type, t);
      return false;
    }
  }

  var EVENTS = ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown'];
  EVENTS.forEach(function (type) {
    document.addEventListener(type, function (e) {
      // keydown 은 Enter/Space 일 때만 차단
      if (type === 'keydown' && !(e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) return;
      blocker(e);
    }, true); // <-- capture = true 가 핵심
  });

  // ── 5) <video> 네이티브 재생 자체 차단 (autoplay/프로그램 재생 방지) ──────────
  try {
    var origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      log('native play() blocked', this);
      // 거부된 Promise 반환 (호출부 에러 방지)
      try { return Promise.reject(new DOMException('play blocked', 'NotAllowedError')); }
      catch (e) { return undefined; }
    };
    // 이미 재생 중인 것도 정지
    document.addEventListener('play', function (e) {
      if (e.target && e.target.pause) { try { e.target.pause(); } catch (x) {} }
    }, true);
  } catch (e) { /* 환경에 따라 무시 */ }

  // ── 6) 초기 적용 + 동적 로딩 대비 감시 ──────────────────────────────────
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
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      // 폴백: 주기적 재적용
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
