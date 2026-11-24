(function () {
  'use strict';

  var counterId = 114624117;
  var consentKey = 'diary-analytics-consent-v1';
  var canonicalUrl = 'https://rinagisha-droid.github.io/dnevnik-sostoyaniy-demo./';
  // Block pageview tracking on authentication links; harmless marketing
  // UTM parameters do not contain tokens and are never sent to Metrica:
  // the counter uses the clean canonicalUrl.
  // Capture this before the account script processes the confirmation token.
  var publicQuery = new URLSearchParams(window.location.search);
  var safeMarketingQuery = Array.from(publicQuery.keys()).every(function (key) {
    return /^(utm_[a-z0-9_]+|yclid|gclid|fbclid)$/i.test(key);
  });
  var sensitiveUrl = Boolean(window.location.hash) || !safeMarketingQuery;
  var choice = null;
  var memoryOnly = false;
  var phase = 'off';
  var generation = 0;
  var script = null;
  var timer = null;
  var ownedDispatcher = null;
  var stopped = false;
  var notice;
  var status;

  try {
    var stored = window.localStorage.getItem(consentKey);
    if (stored === 'allow' || stored === 'deny') choice = stored;
  } catch (_) { /* The diary also works when consent cannot be persisted. */ }

  function message(text) {
    if (status) status.textContent = text + (memoryOnly && choice !== null ? ' Выбор действует только на это открытие: браузер не позволил его сохранить.' : '');
  }

  function save(value) {
    choice = value;
    try {
      window.localStorage.setItem(consentKey, value);
      memoryOnly = false;
    } catch (_) { memoryOnly = true; }
  }

  function removeLoader() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (script) {
      script.onload = null;
      script.onerror = null;
      script.remove();
    }
    script = null;
  }

  function clearDispatcher() {
    if (ownedDispatcher && window.ym === ownedDispatcher) {
      if (ownedDispatcher.a) ownedDispatcher.a.length = 0;
      try { delete window.ym; } catch (_) { window.ym = undefined; }
    }
    ownedDispatcher = null;
  }

  function currentMessage() {
    if (choice === 'deny') return 'Статистика отключена. Уже отправленные сведения не удаляются автоматически.';
    if (sensitiveUrl) return 'На этой странице статистика недоступна из-за параметров ссылки.' + (memoryOnly ? ' При следующем открытии по обычной ссылке разрешение нужно будет дать заново.' : ' Ваш выбор будет применён при следующем открытии дневника по обычной ссылке.');
    if (stopped && choice === 'allow') return memoryOnly ? 'Статистика остаётся отключённой на этой странице. При следующем открытии разрешение нужно будет дать заново.' : 'Разрешение сохранено. Статистика включится при следующем открытии дневника.';
    if (phase === 'active') return 'Статистика посещений включена. Тексты записей и заполнение форм не передаются счётчику.';
    if (phase === 'loading') return 'Подключаем необязательную статистику посещений…';
    if (phase === 'failed') return 'Статистика не подключилась. Это не мешает пользоваться дневником. Можно продолжить без неё.';
    return 'Статистика посещений подключается только с вашего разрешения. Можно пользоваться дневником без неё.';
  }

  function start() {
    if (choice !== 'allow' || sensitiveUrl || stopped || phase === 'active' || phase === 'loading') {
      message(currentMessage());
      return;
    }
    // Another integration must not silently become this diary's dispatcher.
    if (typeof window.ym !== 'undefined') {
      phase = 'failed';
      message(currentMessage());
      return;
    }
    phase = 'loading';
    var attempt = ++generation;
    var dispatcher = function () { (dispatcher.a = dispatcher.a || []).push(arguments); };
    dispatcher.l = Date.now();
    ownedDispatcher = window.ym = dispatcher;
    script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + counterId;

    function failed() {
      if (attempt !== generation || choice !== 'allow') return;
      ++generation;
      removeLoader();
      clearDispatcher();
      phase = 'failed';
      message(currentMessage());
      if (notice) notice.hidden = false;
    }

    script.onload = function () {
      if (attempt !== generation || choice !== 'allow') return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      try {
        window.ym(counterId, 'init', {
          defer: true, disableYtm: true, webvisor: false, clickmap: false, trackLinks: false,
          accurateTrackBounce: false, ecommerce: false, trackHash: false,
          sendTitle: false, childIframe: false, referrer: '', url: canonicalUrl
        });
        window.ym(counterId, 'hit', canonicalUrl, {
          title: 'Дневник состояний и настроений', referer: ''
        });
        phase = 'active';
        message(currentMessage());
      } catch (_) { failed(); }
    };
    script.onerror = failed;
    timer = window.setTimeout(failed, 15000);
    message(currentMessage());
    (document.head || document.documentElement).appendChild(script);
  }

  function allow() {
    save('allow');
    if (notice) notice.hidden = true;
    start();
  }

  function decline() {
    save('deny');
    ++generation;
    // The documented destruct method stops the counter without reloading a
    // page that may contain unsaved diary text. In-flight requests may finish.
    if (phase === 'active') {
      try { window.ym(counterId, 'destruct'); } catch (_) { /* No diary interruption. */ }
    }
    if (phase === 'active' || phase === 'loading') stopped = true;
    removeLoader();
    clearDispatcher();
    phase = 'off';
    message(currentMessage());
    if (notice) notice.hidden = true;
  }

  function setup() {
    notice = document.getElementById('analyticsNotice');
    status = document.getElementById('analyticsStatus');
    var allowButton = document.getElementById('analyticsAllow');
    var declineButton = document.getElementById('analyticsDecline');
    var settings = document.getElementById('analyticsSettings');
    if (allowButton) allowButton.addEventListener('click', allow);
    if (declineButton) declineButton.addEventListener('click', decline);
    if (settings) settings.addEventListener('click', function () {
      message(currentMessage());
      if (notice) notice.hidden = false;
      if (allowButton) allowButton.focus();
    });
    if (notice) notice.hidden = choice !== null;
    message(currentMessage());
    if (choice === 'allow') start();
  }

  window.DiaryAnalytics = Object.freeze({
    getState: function () { return { choice: choice, phase: phase, blockedByUrl: sensitiveUrl }; }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
}());
