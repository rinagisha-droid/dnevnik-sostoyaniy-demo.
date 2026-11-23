'use strict';

// Self-contained OOXML export. Records never leave the browser.
(() => {
  const encoder = new TextEncoder();
  const parts = [['morning', 'Утро'], ['day', 'День'], ['evening', 'Вечер']];
  const metrics = [['mood', 'Настроение'], ['energy', 'Энергия'], ['stress', 'Стресс']];
  const moods = ['Спокойно', 'Уверенно', 'Ровно', 'Тревожно', 'Грустно', 'Устало', 'Раздражённо', 'Радостно'];
  const dailyFields = [['situation', 'Ситуация за день'], ['thoughts', 'Мысли'], ['reaction', 'Реакция'], ['newView', 'Альтернативный взгляд'], ['summary', 'Итоги дня'], ['therapist', 'Для работы с психологом']];
  const episodeFields = [['situation', 'Ситуация'], ['thoughts', 'Мысли'], ['body', 'Ощущения в теле'], ['reaction', 'Реакция'], ['outcome', 'Результат']];
  const hasText = text => typeof text === 'string' && text.trim().length > 0;
  const score = number => Number.isInteger(number) && number >= 0 && number <= 10;
  const formatNumber = number => Number(number.toFixed(2)).toLocaleString('ru-RU');
  const keyDate = day => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  function parseDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw Error('Выберите дату недели.');
    const [year, month, day] = value.split('-').map(Number);
    const result = new Date(year, month - 1, day, 12);
    if (keyDate(result) !== value) throw Error('Некорректная дата недели.');
    return result;
  }
  const dateLabel = key => parseDay(key).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  function meaningful(entry) {
    return parts.some(([key]) => entry[key] && (Number.isInteger(entry[key].selected) || metrics.some(([metric]) => score(entry[key][metric]))))
      || dailyFields.some(([key]) => hasText(entry[key])) || hasText(entry.otherEmotion)
      || (entry.emotions || []).length > 0 || Object.keys(entry.emotionIntensity || {}).length > 0
      || (entry.topics || []).length > 0 || (entry.episodes || []).length > 0;
  }
  function buildReport(entries, selectedDay) {
    // Validate using the same schema as backup restoration without mutating data.
    if (typeof readDiaryEntries === 'function') readDiaryEntries(entries);
    const start = parseDay(selectedDay);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      const key = keyDate(day);
      const entry = JSON.parse(JSON.stringify(entries[key] || {}));
      return { key, label: dateLabel(key), entry, filled: meaningful(entry) };
    });
    const averages = metrics.map(([key, label]) => {
      let observations = 0;
      const daily = days.map(({ entry }) => {
        const values = parts.map(([part]) => entry[part]?.[key]).filter(score);
        observations += values.length;
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      }).filter(value => value !== null);
      return { key, label, days: daily.length, observations, value: daily.length ? daily.reduce((sum, value) => sum + value, 0) / daily.length : null };
    });
    const frequencies = new Map(), states = new Map();
    for (const { entry } of days) {
      const dayStates = new Set(parts.map(([key]) => moods[entry[key]?.selected]).filter(Boolean));
      for (const state of dayStates) states.set(state, (states.get(state) || 0) + 1);
      const emotions = new Set(entry.emotions || []);
      if (hasText(entry.otherEmotion)) emotions.add(entry.otherEmotion.trim());
      for (const episode of entry.episodes || []) for (const name of episode.emotions || []) emotions.add(name);
      for (const emotion of emotions) frequencies.set(emotion, (frequencies.get(emotion) || 0) + 1);
    }
    return {
      start: days[0].key, end: days[6].key, days, averages,
      filledDays: days.filter(day => day.filled).length,
      episodeCount: days.reduce((sum, day) => sum + (day.entry.episodes || []).length, 0),
      emotions: [...frequencies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')),
      states: [...states].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    };
  }

  // XML 1.0 forbids control characters even when escaped. Retain all readable text.
  const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  function run(text, bold = false) {
    return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}${String(text).split(/\r\n|\r|\n/).map((line, index) => (index ? '<w:br/>' : '') + `<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')}</w:r>`;
  }
  function paragraph(text, style = 'Normal', extra = '') {
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${run(text)}</w:p>`;
  }
  const field = (label, value) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run(label + ': ', true)}${run(hasText(value) ? value : 'Не заполнено')}</w:p>`;
  function documentXml(report) {
    const content = [];
    content.push(paragraph('Дневник состояний и настроений', 'Title'));
    const periodDate = key => parseDay(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    content.push(paragraph(`Период с ${periodDate(report.start)} по ${periodDate(report.end)}`, 'Subtitle'));
    content.push(paragraph('Заполненные записи за выбранную неделю и итог для самостоятельного просмотра или обсуждения с психологом. Пропуски обозначены явно. Сведения описывают записи и не являются диагнозом.', 'Note'));
    const summaryStart = content.length;
    content.push(paragraph('Недельный итог', 'Heading1'));
    content.push(paragraph(`Дней с записями: ${report.filledDays} из 7. Ситуаций за неделю: ${report.episodeCount}.`));
    content.push(paragraph('Оценки состояния', 'Heading2'));
    for (const metric of report.averages) content.push(paragraph(metric.value === null
      ? `${metric.label}: нет заполненных оценок.`
      : `${metric.label}: ${formatNumber(metric.value)} из 10. Дней с оценками: ${metric.days}; отдельных оценок: ${metric.observations}.`));
    content.push(paragraph('Сначала рассчитано среднее заполненных оценок каждого дня, затем среднее этих дневных значений за неделю. Пропуски не участвуют в расчёте; заполненный ноль участвует.', 'Note'));
    content.push(paragraph('Отмеченные эмоции', 'Heading2'));
    content.push(paragraph(report.emotions.length ? report.emotions.map(([name, count]) => `${name} — ${count} дн.`).join('; ') : 'Эмоции в дневных карточках и ситуациях не отмечены.'));
    content.push(paragraph('Подсчитаны эмоции из дневной карточки эмоций и ситуаций, каждая не чаще одного раза за день. Выбор общего состояния утром, днём и вечером в эту частоту не входит. Частота отражает отметки, а не причину состояния.', 'Note'));
    content.push(paragraph('Состояния утром днём и вечером', 'Heading2'));
    content.push(paragraph(report.states.length ? report.states.map(([name, count]) => `${name} — ${count} дн.`).join('; ') : 'Состояния частей дня не выбраны.'));
    content.push(paragraph('Каждое выбранное состояние учтено не чаще одного раза за день, независимо от количества отметок утром, днём и вечером.', 'Note'));
    const weeklySummary = content.splice(summaryStart);
    content.push(paragraph('Записи по дням', 'Heading1'));
    for (const day of report.days) {
      const entry = day.entry;
      content.push(paragraph(day.label, 'DateHeading'));
      if (!day.filled) {
        content.push(paragraph('Записей за этот день нет.', 'Note'));
        continue;
      }
      for (const [key, label] of parts) {
        const item = entry[key] || {};
        content.push(paragraph(label, 'Heading2'));
        content.push(field('Состояние', moods[item.selected] || 'Не заполнено'));
        for (const [metric, metricLabel] of metrics) content.push(field(metricLabel, score(item[metric]) ? `${item[metric]} из 10` : 'Не заполнено'));
      }
      content.push(paragraph('Ситуации за день', 'Heading2'));
      if (!(entry.episodes || []).length) content.push(paragraph('Ситуации не добавлены.', 'Note'));
      for (const [index, episode] of (entry.episodes || []).entries()) {
        content.push(paragraph(`Ситуация ${index + 1}${episode.time ? ' в ' + episode.time : ''}`, 'Heading3'));
        content.push(field('Дата', day.label));
        content.push(field('Время', episode.time));
        for (const [key, label] of episodeFields) content.push(field(label, episode[key]));
        content.push(field('Эмоции', (episode.emotions || []).join(', ')));
        content.push(field('Интенсивность', score(episode.intensity) ? `${episode.intensity} из 10` : 'Не заполнено'));
      }
      content.push(paragraph('Дневные карточки', 'Heading2'));
      for (const [key, label] of dailyFields) content.push(field(label, entry[key]));
      content.push(field('Эмоции за день', (entry.emotions || []).join(', ')));
      content.push(field('Другая эмоция', entry.otherEmotion));
      const intensities = Object.entries(entry.emotionIntensity || {}).map(([name, number]) => `${name === '__other__' ? (hasText(entry.otherEmotion) ? entry.otherEmotion : 'Другая эмоция') : name}: ${number} из 10`);
      content.push(field('Интенсивность эмоций', intensities.join('; ')));
      content.push(field('Темы для обсуждения', (entry.topics || []).join(', ')));
    }
    content.push(...weeklySummary);
    content.push(paragraph('Документ содержит личные записи. Он не защищён паролем. Передавайте его только тому специалисту, с которым решили обсудить записи. Для восстановления дневника используйте отдельную резервную копию JSON.', 'Note'));
    const section = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1440" w:left="1134" w:header="567" w:footer="567"/></w:sectPr>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${content.join('')}${section}</w:body></w:document>`;
  }
  function stylesXml() {
    const pStyle = (id, name, properties, runProperties = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${id === 'Normal' ? '' : '<w:basedOn w:val="Normal"/>'}<w:pPr>${properties}</w:pPr><w:rPr>${runProperties}</w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>${pStyle('Normal', 'Normal', '')}${pStyle('Title', 'Title', '<w:spacing w:before="0" w:after="180"/><w:keepNext/>', '<w:b/><w:color w:val="000000"/><w:sz w:val="38"/>')}${pStyle('Subtitle', 'Subtitle', '<w:spacing w:after="200"/><w:keepNext/>', '<w:sz w:val="23"/><w:color w:val="53677B"/>')}${pStyle('Heading1', 'heading 1', '<w:spacing w:before="280" w:after="160"/><w:keepNext/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="30"/><w:color w:val="325B7A"/>')}${pStyle('Heading2', 'heading 2', '<w:spacing w:before="200" w:after="100"/><w:keepNext/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="25"/><w:color w:val="325B7A"/>')}${pStyle('Heading3', 'heading 3', '<w:spacing w:before="160" w:after="90"/><w:keepNext/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="22"/>')}${pStyle('DateHeading', 'Дата записи', '<w:jc w:val="center"/><w:spacing w:before="320" w:after="180"/><w:keepNext/>', '<w:b/><w:sz w:val="28"/><w:color w:val="325B7A"/>')}${pStyle('Note', 'Примечание', '<w:spacing w:after="140"/>', '<w:sz w:val="20"/><w:color w:val="53677B"/>')}</w:styles>`;
  }
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
      crc ^= byte;
      for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const chunks = [], central = [];
    let offset = 0, centralSize = 0;
    const record = (length, write) => { const bytes = new Uint8Array(length); write(new DataView(bytes.buffer)); return bytes; };
    for (const [name, text] of Object.entries(files)) {
      const filename = encoder.encode(name), bytes = encoder.encode(text), crc = crc32(bytes);
      const header = record(30, view => {
        view.setUint32(0, 0x04034B50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
        view.setUint16(12, 33, true); view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true);
        view.setUint32(22, bytes.length, true); view.setUint16(26, filename.length, true);
      });
      const directory = record(46, view => {
        view.setUint32(0, 0x02014B50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, 0x0800, true);
        view.setUint16(14, 33, true); view.setUint32(16, crc, true); view.setUint32(20, bytes.length, true);
        view.setUint32(24, bytes.length, true); view.setUint16(28, filename.length, true); view.setUint32(42, offset, true);
      });
      chunks.push(header, filename, bytes); central.push(directory, filename);
      centralSize += directory.length + filename.length;
      offset += header.length + filename.length + bytes.length;
    }
    const end = record(22, view => {
      view.setUint32(0, 0x06054B50, true); view.setUint16(8, Object.keys(files).length, true); view.setUint16(10, Object.keys(files).length, true);
      view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    });
    const output = new Uint8Array(offset + centralSize + end.length);
    let cursor = 0;
    for (const chunk of [...chunks, ...central, end]) { output.set(chunk, cursor); cursor += chunk.length; }
    return output;
  }
  function buildDocx(report) {
    const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
    return zip({
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      'word/document.xml': documentXml(report),
      'word/styles.xml': stylesXml(),
      'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${relationshipNamespace}"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
      'word/footer1.xml': '<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="53677B"/></w:rPr><w:t xml:space="preserve">Страница </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>'
    });
  }
  let exporting = false;
  async function exportDiaryWord() {
    if (exporting) return;
    const button = document.getElementById('wordExportButton');
    const status = document.getElementById('wordExportStatus');
    const message = text => { if (status) status.textContent = text; };
    const input = document.getElementById('wordReportDate');
    const selectedDay = input ? input.value : keyDate(typeof date !== 'undefined' && date instanceof Date ? date : new Date());
    exporting = true;
    if (button) button.disabled = true;
    message('Готовим документ…');
    try {
      parseDay(selectedDay);
      const owner = accountOwner, scope = storeKey;
      if (owner === undefined || document.body.hasAttribute('data-cover')) throw Error('Сначала войдите в нужный дневник.');
      await saveQueue;
      if (accountOwner !== owner || storeKey !== scope) throw Error('Аккаунт изменился. Повторите скачивание в нужном дневнике.');
      if (isVaultPresent && !encryptionKey) {
        document.getElementById('wordReportDialog')?.close();
        document.getElementById('vaultUnlock').classList.remove('hidden');
        document.getElementById('vaultMessage').textContent = 'Введите пароль или восстановите доступ по резервному коду, затем скачайте документ Word.';
        message('Сначала откройте защищённые записи паролем.');
        return;
      }
      if (loadFailed) throw Error('Сохранённые записи не удалось прочитать. Исходное хранилище сохранено.');
      if (savingFailed) throw Error('Есть несохранённые изменения. Сначала скачайте резервную копию JSON текущего черновика и сохраните текст. Документ Word пока не создан.');
      const read = async () => {
        if (accountOwner !== owner || storeKey !== scope) throw Error('Аккаунт изменился. Повторите скачивание.');
        return entriesFromStorage(storageSnapshot());
      };
      const entries = navigator.locks ? await storageLock(read) : await read();
      if (accountOwner !== owner || storeKey !== scope) throw Error('Аккаунт изменился. Повторите скачивание.');
      const report = buildReport(entries, selectedDay);
      const bytes = buildDocx(report);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `dnevnik-week-${report.start}-${report.end}.docx`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      message('Файл подготовлен. Проверьте загрузки браузера.');
    } catch (error) {
      message('Не удалось скачать документ. ' + error.message);
    } finally {
      exporting = false;
      if (button) button.disabled = false;
    }
  }
  window.DiaryWordExport = Object.freeze({ buildReport, buildDocx, documentXml, keyDate });
  window.exportDiaryWord = exportDiaryWord;
  document.getElementById('wordExportButton')?.addEventListener('click', exportDiaryWord);
})();
