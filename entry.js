// Open the diary from its beginning rather than restoring an old scroll offset.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const coverDialog = document.getElementById('accountDialog');
const coverForm = coverDialog.querySelector('form');
const coverPassword = coverForm.elements.password;
const signupProfile = document.getElementById('signupProfile');

document.getElementById('openLocalDiary').addEventListener('click', () => openLegacyDiary());

function openLocalDiary() {
  coverDialog.close();
  delete document.body.dataset.cover;
  setMobileDiarySection('diary');
  draw();
  const visibleScreen = ['lock', 'vaultUnlock', 'app']
    .map(id => document.getElementById(id))
    .find(element => !element.classList.contains('hidden'));
  visibleScreen.tabIndex = -1;
  visibleScreen.focus({preventScroll: true});
  window.scrollTo(0, 0);
}

const sectionBreakpoint = matchMedia('(max-width: 790px)');
const diaryLinks = [...document.querySelectorAll('.side-menu a')];
const diaryMain = document.querySelector('#app main');
const diaryAside = document.querySelector('#app .aside');
let diarySection = 'diary';

function setMobileDiarySection(section) {
  diarySection = section;
  const mobile = sectionBreakpoint.matches;
  diaryMain.toggleAttribute('data-mobile-hidden', mobile && section !== 'diary');
  diaryAside.toggleAttribute('data-mobile-hidden', mobile && section === 'diary');
  for (const card of diaryAside.children) {
    card.toggleAttribute('data-mobile-hidden', mobile && card.id !== section && card.dataset.mobileSection !== section);
  }
  if (mobile) {
    for (const link of diaryLinks) {
      const active = link.hash === '#' + section;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
}

function openMobileDiarySection(section) {
  stopDiaryDictation();
  setMobileDiarySection(section);
  if (section === 'dynamics') draw();
  const target = document.getElementById(section);
  target.tabIndex = -1;
  target.focus({preventScroll: true});
  window.scrollTo(0, 0);
}

diaryLinks.forEach(link => link.addEventListener('click', event => {
  if (!sectionBreakpoint.matches) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openMobileDiarySection(link.hash.slice(1));
}));
sectionBreakpoint.addEventListener('change', () => {
  stopDiaryDictation();
  setMobileDiarySection(diarySection);
  if (!document.body.hasAttribute('data-cover')) draw();
});
setMobileDiarySection(diarySection);

function renderDiaryDate(day) {
  stopDiaryDictation();
  const locale = 'ru-RU';
  const dateParts = {day: 'numeric', month: 'long', year: 'numeric'};
  document.querySelector('.desktop-date').textContent =
    day.toLocaleDateString(locale, {weekday: 'long', ...dateParts});
  document.getElementById('mobileWeekday').textContent = day.toLocaleDateString(locale, {weekday: 'long'});
  document.getElementById('mobileCalendarDate').textContent = new Intl.DateTimeFormat(locale, dateParts)
    .formatToParts(day)
    .filter(part => part.type !== 'literal')
    .map(part => part.value)
    .join(' ');
}

const DiarySpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeDictation;

function stopDiaryDictation() {
  if (!activeDictation) return;
  const {recognition, reset} = activeDictation;
  reset();
  recognition.abort();
}

document.querySelectorAll('#app textarea').forEach(field => {
  const inputArea = document.createElement('div');
  inputArea.className = 'dictation-field';
  const indicator = document.createElement('span');
  indicator.className = 'dictation-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  const dots = document.createElement('span');
  dots.className = 'dictation-dots';
  dots.innerHTML = '<i></i><i></i><i></i>';
  const indicatorLabel = document.createElement('span');
  indicator.append(dots, indicatorLabel);
  field.before(inputArea);
  inputArea.append(field, indicator);

  const controls = document.createElement('div');
  controls.className = 'dictation';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '🎙 Диктовать';
  const status = document.createElement('small');
  status.setAttribute('role', 'status');
  if (!DiarySpeechRecognition) {
    button.disabled = true;
    status.textContent = 'Диктовка недоступна в этом браузере. Можно использовать микрофон клавиатуры.';
  }
  controls.append(button, status);
  inputArea.after(controls);

  button.addEventListener('click', () => {
    if (activeDictation?.field === field) {
      button.disabled = true;
      status.textContent = 'Завершаем диктовку…';
      indicatorLabel.textContent = 'Завершаем…';
      activeDictation.recognition.stop();
      return;
    }
    stopDiaryDictation();
    const recognition = new DiarySpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    const reset = () => {
      if (activeDictation?.recognition !== recognition) return;
      activeDictation = undefined;
      button.disabled = false;
      button.textContent = '🎙 Диктовать';
      status.textContent = '';
      inputArea.removeAttribute('data-dictation-active');
    };
    activeDictation = {field, recognition, reset};
    recognition.onaudiostart = () => {
      if (activeDictation?.recognition !== recognition || button.disabled) return;
      indicatorLabel.textContent = 'Слушаю';
      status.textContent = 'Микрофон включён. Речь может обрабатываться сервисом браузера.';
    };
    recognition.onresult = event => {
      if (activeDictation?.recognition !== recognition || !field.getClientRects().length) return;
      const words = Array.from(event.results).slice(event.resultIndex)
        .filter(result => result.isFinal)
        .map(result => result[0].transcript.trim())
        .filter(Boolean);
      if (!words.length) return;
      const separator = field.value && !/\s$/.test(field.value) ? ' ' : '';
      field.value += separator + words.join(' ');
      field.dispatchEvent(new Event('input', {bubbles: true}));
    };
    recognition.onend = reset;
    recognition.onerror = event => {
      if (activeDictation?.recognition !== recognition) return;
      reset();
      status.textContent = event.error === 'not-allowed'
        ? 'Разрешите доступ к микрофону в браузере.'
        : 'Не удалось распознать речь. Можно попробовать снова или ввести текст.';
    };
    try {
      button.textContent = 'Остановить';
      inputArea.setAttribute('data-dictation-active', '');
      indicatorLabel.textContent = 'Подключаем микрофон…';
      status.textContent = 'Подключаем микрофон…';
      recognition.start();
    } catch {
      reset();
      status.textContent = 'Не удалось включить микрофон.';
    }
  });
});

document.getElementById('app').addEventListener('toggle', () => {
  if (activeDictation && !activeDictation.field.getClientRects().length) stopDiaryDictation();
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopDiaryDictation();
});
