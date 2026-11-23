'use strict';

// Uses the existing dated JSON and AES-GCM envelopes without changing their format.
let savedEntries = {};
let knownStorage = null;
let savingFailed = false;
let pendingWrites = 0;
let loadFailed = false;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const score = value => Number.isInteger(value) && value >= 0 && value <= 10;
const copyEntries = value => JSON.parse(JSON.stringify(value));
const sameEntry = (left, right) => JSON.stringify(left || {}) === JSON.stringify(right || {});

function readDiaryEntries(value) {
  if (!record(value)) throw Error('Некорректный формат записей');
  const allowedText = ['situation', 'thoughts', 'otherEmotion', 'reaction', 'newView', 'summary', 'therapist'];
  const allowedEmotions = ['Тревога', 'Радость', 'Обида', 'Злость', 'Грусть', 'Спокойствие', 'Разочарование', 'Напряжение', 'Интерес', 'Страх', 'Раздражение'];
  const choices = (items, allowed) => Array.isArray(items) && items.every(item => allowed.includes(item)) && new Set(items).size === items.length;
  for (const [day, entry] of Object.entries(value)) {
    const parsed = new Date(day + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day || !record(entry)) throw Error('Некорректная дата');
    for (const [field, item] of Object.entries(entry)) {
      let valid = false;
      if (allowedText.includes(field)) valid = typeof item === 'string';
      if (['otherOpen', 'moreEmotionsOpen'].includes(field)) valid = typeof item === 'boolean';
      if (field === 'emotions') valid = choices(item, allowedEmotions);
      if (field === 'topics') valid = choices(item, ['Повторяющиеся мысли', 'Реакции в сложных ситуациях', 'Уровень стресса', 'Другое']);
      if (field === 'emotionIntensity') valid = record(item) && Object.entries(item).every(([name, number]) => (allowedEmotions.includes(name) || name === '__other__') && score(number));
      if (['morning', 'day', 'evening'].includes(field)) valid = record(item) && Object.entries(item).every(([name, number]) => name === 'selected' ? Number.isInteger(number) && number >= 0 && number < 8 : ['mood', 'energy', 'stress'].includes(name) && score(number));
      if (field === 'episodes') {
        valid = Array.isArray(item) && item.every(episode => record(episode) && typeof episode.id === 'string' && episode.id.length > 0 && Object.entries(episode).every(([name, content]) => {
          if (['id', 'situation', 'thoughts', 'body', 'reaction', 'outcome'].includes(name)) return typeof content === 'string';
          if (name === 'date') return content === day;
          if (name === 'time') return typeof content === 'string' && (content === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(content));
          if (name === 'emotions') return choices(content, allowedEmotions);
          if (name === 'intensity') return score(content);
          return false;
        })) && new Set(item.map(episode => episode.id)).size === item.length;
      }
      if (!valid) throw Error('Несовместимое поле записи');
    }
  }
  return value;
}

function storageSnapshot() {
  return { plain: localStorage.getItem(storeKey), encrypted: localStorage.getItem(encryptedStoreKey) };
}

function unchangedStorage(snapshot) {
  const current = storageSnapshot();
  return current.plain === snapshot.plain && current.encrypted === snapshot.encrypted;
}

function saveStatus(message) {
  document.getElementById('saveStatus').textContent = message;
}

function rememberStorage() {
  knownStorage = storageSnapshot();
  savedEntries = copyEntries(data);
}

function storageLock(action) {
  if (!navigator.locks) return Promise.reject(Error('Для безопасного сохранения нужен браузер с поддержкой Web Locks. Скопируйте текст и откройте дневник в актуальном браузере.'));
  return navigator.locks.request(storeKey, action);
}

function warnPendingWrite(event) {
  event.preventDefault();
  event.returnValue = true;
}

async function entriesFromStorage(snapshot) {
  if (snapshot.encrypted !== null) {
    if (!encryptionKey) throw Error('Сначала откройте дневник паролем.');
    const envelope = JSON.parse(snapshot.encrypted);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(envelope.iv) }, encryptionKey, base64ToBytes(envelope.ciphertext));
    return readDiaryEntries(JSON.parse(textDecoder.decode(plain)));
  }
  if (isVaultPresent) throw Error('Защита изменена в другой вкладке. Обновите страницу.');
  return readDiaryEntries(JSON.parse(snapshot.plain || '{}'));
}

async function writeEntries(entries, snapshot) {
  readDiaryEntries(entries);
  let result = JSON.stringify(entries);
  if (snapshot.encrypted !== null) {
    const envelope = await encryptDiary(result, encryptionKey, vaultSalt);
    const previous = JSON.parse(snapshot.encrypted);
    if (previous.recovery) envelope.recovery = previous.recovery;
    result = JSON.stringify(envelope);
  }
  if (!unchangedStorage(snapshot)) throw Error('Записи изменились в другой вкладке. Обновите страницу перед новой попыткой.');
  localStorage.setItem(snapshot.encrypted !== null ? encryptedStoreKey : storeKey, result);
  knownStorage = storageSnapshot();
}

function persist() {
  if (savingFailed) return Promise.resolve(false);
  const before = savedEntries;
  const after = copyEntries(data);
  const changed = Object.keys(after).filter(day => !sameEntry(before[day], after[day]));
  if (!changed.length) return saveQueue.then(() => !savingFailed);
  savedEntries = copyEntries(after);
  pendingWrites++;
  window.addEventListener('beforeunload', warnPendingWrite);
  saveStatus('Сохраняем…');
  saveQueue = saveQueue.then(() => storageLock(async () => {
    if (savingFailed) return false;
    const snapshot = storageSnapshot();
    if (!!snapshot.encrypted !== isVaultPresent) throw Error('Защита изменена в другой вкладке.');
    const entries = await entriesFromStorage(snapshot);
    for (const day of changed) {
      if (!sameEntry(entries[day], before[day])) throw Error('Этот день изменён в другой вкладке. Скопируйте несохранённый текст и обновите страницу.');
      entries[day] = after[day];
    }
    await writeEntries(entries, snapshot);
    for (const [day, entry] of Object.entries(entries)) {
      if (sameEntry(data[day], after[day])) data[day] = copyEntries(entry);
      if (sameEntry(savedEntries[day], after[day])) savedEntries[day] = copyEntries(entry);
    }
    if (pendingWrites === 1) saveStatus('Сохранено в этом браузере.');
    draw();
    renderExtras();
    return true;
  })).catch(error => {
    savingFailed = true;
    saveStatus('Не сохранено. Скопируйте текст или скачайте копию текущего черновика перед обновлением.');
    alert('Не удалось сохранить. ' + error.message);
    return false;
  }).finally(() => {
    pendingWrites--;
    if (!pendingWrites) window.removeEventListener('beforeunload', warnPendingWrite);
  });
  return saveQueue;
}

function readDiaryBackup(text) {
  const backup = JSON.parse(text);
  if (!record(backup) || !Object.hasOwn(backup, 'entries')) throw Error('В файле нет записей');
  if (backup.version !== undefined && backup.version !== 1) throw Error('Версия копии не поддерживается');
  if (backup.product !== undefined && !['Дневник состояний', 'Дневник состояний и настроений'].includes(backup.product)) throw Error('Копия другого продукта');
  return readDiaryEntries(backup.entries);
}

async function exportData() {
  await saveQueue;
  if (isVaultPresent && !encryptionKey) {
    document.getElementById('vaultUnlock').classList.remove('hidden');
    document.getElementById('vaultMessage').textContent = 'Введите пароль или восстановите доступ по резервному коду, затем нажмите «Скачать свои записи».';
    return;
  }
  try {
    if (loadFailed) throw Error('Сохранённые данные повреждены или имеют неподдерживаемый формат. Исходное хранилище сохранено, обратитесь за помощью перед очисткой браузера.');
    let entries = copyEntries(data);
    if (savingFailed) {
      if (!confirm('Сохранение не завершилось. Скачать текущий черновик из этой вкладки? Он может отличаться от записей в хранилище.')) return;
    } else {
      entries = navigator.locks
        ? await storageLock(() => entriesFromStorage(storageSnapshot()))
        : await entriesFromStorage(storageSnapshot());
    }
    const blob = new Blob([JSON.stringify({ product: 'Дневник состояний и настроений', version: 1, exported: new Date().toISOString(), entries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dnevnik-sostoyaniy-backup.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (error) {
    alert('Не удалось скачать копию. ' + error.message);
  }
}

async function restoreDiary(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const app = document.getElementById('app');
  app.inert = true;
  try {
    const entries = readDiaryBackup(await file.text());
    await saveQueue;
    if (savingFailed && !loadFailed) throw Error('Сначала сохраните копию несохранённого черновика и обновите страницу.');
    await storageLock(async () => {
      const snapshot = storageSnapshot();
      if (!unchangedStorage(knownStorage)) throw Error('Записи изменились в другой вкладке. Обновите страницу.');
      if (!confirm('Восстановление полностью заменит ВСЕ записи в этом браузере содержимым файла. Новые записи и изменения, которых нет в файле, будут потеряны. Сначала скачайте текущую копию. Продолжить замену?')) return;
      await writeEntries(entries, snapshot);
      data = entries;
      savingFailed = false;
      loadFailed = false;
      rememberStorage();
      render();
      saveStatus('Копия восстановлена и сохранена в этом браузере.');
      alert('Копия восстановлена');
    });
  } catch (error) {
    alert('Восстановление отменено, записи не заменены. ' + error.message);
  } finally {
    input.value = '';
    app.inert = false;
  }
}

function protectStorageActions() {
  for (const id of ['privacyEnable', 'privacyLock', 'privacyDelete', 'vaultReset', 'vaultUnlockButton', 'vaultRecoverySubmit', 'recoveryMakeCode']) {
    const button = document.getElementById(id);
    const action = button.onclick;
    button.onclick = async event => {
      const app = document.getElementById('app');
      app.inert = true;
      button.disabled = true;
      try {
        await saveQueue;
        if (savingFailed) {
          alert('Есть несохранённые правки. Скачайте копию черновика перед обновлением страницы.');
          return;
        }
        const run = async () => {
          if (!unchangedStorage(knownStorage)) throw Error('Записи или пароль изменены в другой вкладке. Обновите страницу.');
          await action(event);
          rememberStorage();
        };
        if (!navigator.locks && ['vaultUnlockButton', 'privacyLock'].includes(id)) await run();
        else await storageLock(run);
      } catch (error) {
        alert('Действие не завершено. ' + error.message);
      } finally {
        button.disabled = false;
        app.inert = false;
      }
    };
  }
}

function dailyScores(entry) {
  return Object.fromEntries(['mood', 'energy', 'stress'].map(metric => {
    const values = ['morning', 'day', 'evening'].map(time => entry?.[time]?.[metric]).filter(Number.isInteger);
    return [metric, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
  }));
}

function dailyEmotions(entry) {
  return [...new Set([...(entry.emotions || []), ...(entry.episodes || []).flatMap(episode => episode.emotions || [])])];
}

function hasDayContent(entry) {
  return Object.entries(entry).some(([field, value]) => {
    if (['otherOpen', 'moreEmotionsOpen'].includes(field)) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return record(value) && Object.keys(value).length > 0;
  });
}

function renderEmotionSummary() {
  const counts = {};
  const entries = Object.values(data);
  for (const entry of entries) {
    for (const emotion of dailyEmotions(entry)) counts[emotion] = (counts[emotion] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((left, right) => right[1] - left[1]);
  document.getElementById('emotionFrequency').innerHTML = sorted.length ? sorted.map(([emotion, count]) =>
    `<div class="freq"><span class="emotion-name"><img class="emotion-picture" src="${emotionPictures[emotion]}" alt="">${emotion}</span><b>${count} дн.</b></div>`
  ).join('') : '<p class="note">Пока нет отмеченных эмоций за день или в ситуациях.</p>';
  const insights = [];
  if (sorted.length) {
    const leaders = sorted.filter(([, count]) => count === sorted[0][1]).map(([emotion]) => '«' + emotion.toLowerCase() + '»').join(', ');
    insights.push('Чаще всего отмечены ' + leaders + '. Количество дней для каждой — ' + sorted[0][1] + '.');
  }
  const complete = entries.filter(entry => ['morning', 'day', 'evening'].some(time => Number.isInteger(entry[time]?.mood))).length;
  if (complete) insights.push('Дней с числовой оценкой настроения — ' + complete + '.');
  document.getElementById('insights').innerHTML = (insights.length ? insights : ['Когда появятся записи, здесь будут наблюдения по отмеченным эмоциям и заполненным оценкам.']).map(text => '<li>' + text + '</li>').join('');
}

const diaryChart = document.getElementById('chart');
new ResizeObserver(() => drawDiaryChart()).observe(diaryChart);

function drawDiaryChart() {
  const canvas = diaryChart;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const start = new Date(date);
  start.setDate(start.getDate() - period + 1);
  const rows = Array.from({ length: period }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return { day: dayKey(day), values: dailyScores(data[dayKey(day)]), index };
  });
  const right = width - 8;
  const bottom = height - 25;
  const xAt = index => 24 + index * (right - 24) / Math.max(1, period - 1);
  const yAt = value => bottom - value * (bottom - 12) / 10;
  context.font = '11px system-ui';
  for (let value = 0; value <= 10; value += 2) {
    const y = yAt(value);
    context.strokeStyle = '#e0e9f3';
    context.beginPath();
    context.moveTo(24, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillStyle = '#61768e';
    context.fillText(String(value), 4, y + 3);
  }
  for (const [metric, color, dash, thickness] of [
    ['energy', '#7952b3', [7, 3], 2],
    ['stress', '#16766f', [2, 3], 2],
    ['mood', '#216bb0', [], 3]
  ]) {
    let previous = null;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = thickness;
    context.lineCap = 'round';
    context.setLineDash(dash);
    context.beginPath();
    for (const row of rows) {
      const value = row.values[metric];
      if (value === null) { previous = null; continue; }
      const x = xAt(row.index);
      const y = yAt(value);
      if (previous) {
        // Keep the curve between the two recorded scores.
        const middle = (previous.x + x) / 2;
        context.bezierCurveTo(middle, previous.y, middle, y, x, y);
      } else {
        context.moveTo(x, y);
      }
      previous = { x, y };
    }
    context.stroke();
    for (const row of rows) {
      if (row.values[metric] === null) continue;
      context.beginPath();
      context.arc(xAt(row.index), yAt(row.values[metric]), metric === 'mood' ? 2.8 : 2, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.fillStyle = '#56718b';
  context.fillText(rows[0].day.slice(5).split('-').reverse().join('.'), 24, height - 6);
  context.textAlign = 'right';
  context.fillText(rows[rows.length - 1].day.slice(5).split('-').reverse().join('.'), right, height - 6);
  const filled = rows.filter(row => Object.values(row.values).some(value => value !== null));
  document.getElementById('chartEmpty').hidden = filled.length > 0;
  for (const button of document.querySelectorAll('#dynamics [data-period]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.period) === period));
  }
  const format = value => value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  document.getElementById('chartValues').innerHTML = filled.length ? '<table><caption>Средние оценки за день, от 0 до 10</caption><thead><tr><th>Дата</th><th>Настр.</th><th>Энергия</th><th>Стресс</th></tr></thead><tbody>' +
    filled.map(row => '<tr><th>' + row.day.split('-').reverse().join('.') + '</th>' + ['mood', 'energy', 'stress'].map(metric => '<td>' + format(row.values[metric]) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>' : '<p class="note">В выбранном периоде нет числовых оценок.</p>';
}
