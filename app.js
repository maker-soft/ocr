const els = {
  status: document.getElementById('appStatus'),
  video: document.getElementById('video'),
  canvas: document.getElementById('snapshot'),
  startCamera: document.getElementById('startCamera'),
  capture: document.getElementById('capture'),
  stopCamera: document.getElementById('stopCamera'),
  fileInput: document.getElementById('fileInput'),
  recognizedValue: document.getElementById('recognizedValue'),
  rawText: document.getElementById('rawText'),
  saveReading: document.getElementById('saveReading'),
  historyList: document.getElementById('historyList'),
  exportCsv: document.getElementById('exportCsv'),
  clearHistory: document.getElementById('clearHistory'),
  meterType: document.getElementById('meterType'),
  objectName: document.getElementById('objectName'),
};

let stream = null;
const HISTORY_KEY = 'meter-ocr-history-v1';

function setStatus(text) {
  els.status.textContent = text;
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Камера недоступна в этом браузере. Используйте загрузку фото.');
    }
    setStatus('Запрос камеры...');
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    els.video.srcObject = stream;
    await els.video.play();
    setStatus('Камера включена');
  } catch (err) {
    console.error(err);
    setStatus('Ошибка камеры');
    alert(err.message || 'Не удалось включить камеру');
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  els.video.srcObject = null;
  setStatus('Камера остановлена');
}

function drawVideoToCanvas() {
  const video = els.video;
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('Видео ещё не готово. Включите камеру и попробуйте ещё раз.');
  }
  const canvas = els.canvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropCenterBand(sourceCanvas) {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const cropX = Math.round(srcW * 0.08);
  const cropY = Math.round(srcH * 0.34);
  const cropW = Math.round(srcW * 0.84);
  const cropH = Math.round(srcH * 0.30);

  const target = document.createElement('canvas');
  const scale = 2;
  target.width = cropW * scale;
  target.height = cropH * scale;
  const ctx = target.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, target.width, target.height);
  preprocessCanvas(target);
  return target;
}

function preprocessCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let gray = 0.299 * r + 0.587 * g + 0.114 * b;
    gray = gray > 145 ? 255 : 0;
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const canvas = els.canvas;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function extractBestReading(text) {
  const normalized = text
    .replace(/[OoОо]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[SБ]/g, '5')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ');

  const matches = normalized.match(/\d{2,}(?:[ .]?\d{1,4})*(?:\.\d+)?/g) || [];
  const candidates = matches
    .map(v => v.replace(/\s+/g, '').replace(/(?<=\d) (?=\d)/g, '').trim())
    .map(v => v.replace(/(\d)\.(?=\d{3}(\D|$))/g, '$1'))
    .filter(v => /\d/.test(v))
    .map(v => ({ value: v, score: v.replace(/\D/g, '').length + (v.includes('.') ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.value || '';
}

async function recognizeFromCanvas(sourceCanvas) {
  if (!window.Tesseract) {
    alert('OCR-библиотека не загрузилась. Проверьте интернет при первом запуске.');
    return;
  }
  setStatus('Подготовка фото...');
  const cropped = cropCenterBand(sourceCanvas);

  setStatus('Распознавание...');
  els.rawText.textContent = 'Идёт распознавание...';
  try {
    const result = await Tesseract.recognize(cropped, 'eng', {
      logger: m => {
        if (m.status && typeof m.progress === 'number') {
          setStatus(`${m.status} ${Math.round(m.progress * 100)}%`);
        }
      },
      tessedit_char_whitelist: '0123456789., ',
    });
    const text = result.data.text || '';
    els.rawText.textContent = text.trim() || 'Текст не найден';
    const best = extractBestReading(text);
    els.recognizedValue.value = best;
    setStatus(best ? 'Найдено' : 'Не найдено');
    if (!best) {
      alert('Не удалось уверенно найти число. Попробуйте сделать фото ближе, без бликов, чтобы цифры были в рамке.');
    }
  } catch (err) {
    console.error(err);
    setStatus('Ошибка OCR');
    els.rawText.textContent = 'Ошибка распознавания: ' + (err.message || err);
  }
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function setHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  renderHistory();
}

function renderHistory() {
  const items = getHistory();
  if (!items.length) {
    els.historyList.className = 'history-list empty';
    els.historyList.textContent = 'История пока пустая';
    return;
  }
  els.historyList.className = 'history-list';
  els.historyList.innerHTML = items.map(item => `
    <article class="history-item">
      <div>
        <div class="history-value">${escapeHtml(item.value)}</div>
        <div class="history-meta">${escapeHtml(item.meterType)} · ${escapeHtml(item.objectName || 'без объекта')}</div>
      </div>
      <div class="history-meta">${new Date(item.createdAt).toLocaleString('ru-RU')}</div>
    </article>
  `).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[c]));
}

function saveReading() {
  const value = els.recognizedValue.value.trim().replace(',', '.');
  if (!value) {
    alert('Введите или распознайте показание.');
    return;
  }
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    value,
    meterType: els.meterType.value,
    objectName: els.objectName.value.trim(),
    createdAt: new Date().toISOString(),
  };
  const history = getHistory();
  history.unshift(item);
  setHistory(history.slice(0, 100));
  setStatus('Сохранено');
}

function exportCsv() {
  const items = getHistory();
  if (!items.length) {
    alert('История пустая.');
    return;
  }
  const header = ['date', 'meter_type', 'object', 'value'];
  const rows = items.map(i => [i.createdAt, i.meterType, i.objectName, i.value]);
  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meter-readings-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.startCamera.addEventListener('click', startCamera);
els.stopCamera.addEventListener('click', stopCamera);
els.capture.addEventListener('click', async () => {
  try {
    const canvas = drawVideoToCanvas();
    await recognizeFromCanvas(canvas);
  } catch (err) {
    alert(err.message || err);
  }
});
els.fileInput.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const canvas = await loadImageFile(file);
  await recognizeFromCanvas(canvas);
});
els.saveReading.addEventListener('click', saveReading);
els.exportCsv.addEventListener('click', exportCsv);
els.clearHistory.addEventListener('click', () => {
  if (confirm('Очистить историю показаний?')) setHistory([]);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.warn));
}

renderHistory();
