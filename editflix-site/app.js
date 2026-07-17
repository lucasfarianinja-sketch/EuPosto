/* EditFlix — clip finder frontend
   V0 fontes: Sakugabooru (público) + AnimeThemes.moe (público) + YouTube (metadata)
   Corte local via ffmpeg.wasm (carregado on-demand no cutter).
*/

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : 'https://editflix-api.lucasfarianinja.workers.dev';

const els = {
  form: document.getElementById('searchForm'),
  q: document.getElementById('q'),
  srcSakuga: document.getElementById('src_sakuga'),
  srcThemes: document.getElementById('src_themes'),
  srcYoutube: document.getElementById('src_youtube'),
  srcTmdb: document.getElementById('src_tmdb'),
  srcReddit: document.getElementById('src_reddit'),
  srcArchive: document.getElementById('src_archive'),
  minRes: document.getElementById('minRes'),
  minFps: document.getElementById('minFps'),
  results: document.getElementById('results'),
  resultsTitle: document.getElementById('resultsTitle'),
  resultsMeta: document.getElementById('resultsMeta'),
  grid: document.getElementById('resultsGrid'),
  empty: document.getElementById('empty'),
  loadMoreWrap: document.getElementById('loadMoreWrap'),
  loadMore: document.getElementById('loadMore'),
  cutter: document.getElementById('cutter'),
  cutterTitle: document.getElementById('cutterTitle'),
  cutterVideo: document.getElementById('cutterVideo'),
  inRange: document.getElementById('inRange'),
  outRange: document.getElementById('outRange'),
  inLabel: document.getElementById('inLabel'),
  outLabel: document.getElementById('outLabel'),
  durLabel: document.getElementById('durLabel'),
  cutterStatus: document.getElementById('cutterStatus'),
  doCut: document.getElementById('doCut'),
  downloadFull: document.getElementById('downloadFull'),
};

let state = {
  currentResults: [],
  page: 1,
  lastQuery: '',
  activeItem: null,
};

/* ---------- Search ---------- */

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = els.q.value.trim();
  if (!q) return;
  state.lastQuery = q;
  state.page = 1;
  state.currentResults = [];
  els.grid.innerHTML = '';
  renderSkeletons(6);
  els.results.hidden = false;
  els.empty.hidden = true;
  els.loadMoreWrap.hidden = true;
  await runSearch(q, 1);
});

els.loadMore.addEventListener('click', async () => {
  state.page++;
  await runSearch(state.lastQuery, state.page, true);
});

async function runSearch(q, page = 1, append = false) {
  const category = (document.querySelector('input[name="category"]:checked') || {}).value || 'all';
  const params = new URLSearchParams({
    q,
    page: String(page),
    minRes: els.minRes.value,
    minFps: els.minFps.value,
    category,
  });
  // A categoria filtra automaticamente; checkboxes são refinamento fino
  const wantAnime = category === 'all' || category === 'anime';
  const wantMedia = category === 'all' || category === 'movies' || category === 'series';
  if (els.srcSakuga.checked && wantAnime) params.append('src', 'sakuga');
  if (els.srcThemes.checked && wantAnime) params.append('src', 'themes');
  if (els.srcYoutube.checked) params.append('src', 'youtube');
  if (els.srcTmdb.checked && wantMedia) params.append('src', 'tmdb');
  if (els.srcReddit.checked) params.append('src', 'reddit');
  if (els.srcArchive.checked && wantMedia) params.append('src', 'archive');

  try {
    const res = await fetch(`${API_BASE}/api/search?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data.results || [];
    if (!append) els.grid.innerHTML = '';
    if (append) {
      state.currentResults.push(...items);
    } else {
      state.currentResults = items;
    }
    if (state.currentResults.length === 0) {
      els.results.hidden = true;
      els.empty.hidden = false;
      return;
    }
    renderResults(items, append);
    els.resultsTitle.textContent = `Resultados para "${q}"`;
    els.resultsMeta.textContent = `${state.currentResults.length} clipes encontrados`;
    els.loadMoreWrap.hidden = items.length < 12;
  } catch (err) {
    console.error('[search] error', err);
    els.grid.innerHTML = `<div class="empty-inner" style="grid-column:1/-1"><h3>Erro na pesquisa</h3><p>${escapeHtml(err.message)}</p></div>`;
    els.loadMoreWrap.hidden = true;
  }
}

/* ---------- Render ---------- */

function renderSkeletons(n) {
  els.grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `
      <div class="card-media skel" style="border-radius:0"></div>
      <div class="card-body">
        <div class="skel" style="height:14px;width:80%"></div>
        <div class="skel" style="height:10px;width:50%;margin-top:6px"></div>
      </div>`;
    els.grid.appendChild(c);
  }
}

function renderResults(items, append = false) {
  if (!append) els.grid.innerHTML = '';
  for (const item of items) {
    els.grid.appendChild(makeCard(item));
  }
}

function makeCard(item) {
  const card = document.createElement('div');
  card.className = 'card';

  const media = document.createElement('div');
  media.className = 'card-media';

  if (item.previewVideo) {
    const v = document.createElement('video');
    v.src = item.previewVideo;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.addEventListener('mouseenter', () => v.play().catch(() => {}));
    v.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0; });
    media.appendChild(v);
  } else if (item.previewImage) {
    const img = document.createElement('img');
    img.src = item.previewImage;
    img.loading = 'lazy';
    img.alt = item.title || '';
    media.appendChild(img);
  } else {
    media.style.background = 'linear-gradient(135deg, var(--surface2), var(--surface3))';
  }

  const badges = document.createElement('div');
  badges.className = 'card-badges';
  badges.innerHTML = `
    <span class="badge src">${escapeHtml(item.source)}</span>
    ${item.resolution ? `<span class="badge res">${escapeHtml(item.resolution)}</span>` : ''}
    ${item.fps ? `<span class="badge fps">${item.fps}fps</span>` : ''}
    ${item.duration ? `<span class="badge">${formatDuration(item.duration)}</span>` : ''}
  `;
  media.appendChild(badges);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = `
    <div class="card-title">${escapeHtml(item.title || 'Sem título')}</div>
    <div class="card-sub">
      ${item.animator ? `<span>Animador: ${escapeHtml(item.animator)}</span>` : ''}
      ${item.anime ? `<span>${escapeHtml(item.anime)}</span>` : ''}
    </div>
  `;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (item.canCut) {
    const cutBtn = document.createElement('button');
    cutBtn.className = 'btn primary';
    cutBtn.textContent = 'Cortar';
    cutBtn.addEventListener('click', () => openCutter(item));
    actions.appendChild(cutBtn);

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn';
    dlBtn.textContent = 'Baixar';
    dlBtn.addEventListener('click', () => downloadDirect(item));
    actions.appendChild(dlBtn);
  } else {
    const openBtn = document.createElement('a');
    openBtn.className = 'btn primary';
    openBtn.textContent = 'Abrir';
    openBtn.href = item.externalUrl;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
    actions.appendChild(openBtn);
  }

  body.appendChild(actions);
  card.appendChild(media);
  card.appendChild(body);
  return card;
}

/* ---------- Direct download ---------- */

async function downloadDirect(item) {
  try {
    const res = await fetch(item.fileUrl);
    if (!res.ok) throw new Error('Download falhou');
    const blob = await res.blob();
    saveBlob(blob, buildFilename(item, 'mp4'));
  } catch (err) {
    // fallback: open new tab
    window.open(item.fileUrl, '_blank');
  }
}

/* ---------- Cutter modal ---------- */

let ffmpegInstance = null;
let ffmpegReady = false;

async function openCutter(item) {
  state.activeItem = item;
  els.cutterTitle.textContent = item.title || 'Cortar clipe';
  els.cutterVideo.src = item.fileUrl;
  els.cutterStatus.textContent = '';
  els.cutterStatus.className = 'status';
  els.cutter.hidden = false;

  els.cutterVideo.addEventListener('loadedmetadata', () => {
    const dur = els.cutterVideo.duration || 0;
    els.inRange.min = 0;
    els.inRange.max = String(dur);
    els.outRange.min = 0;
    els.outRange.max = String(dur);
    els.inRange.value = 0;
    els.outRange.value = String(dur);
    updateLabels();
  }, { once: true });
}

function closeCutter() {
  els.cutter.hidden = true;
  els.cutterVideo.pause();
  els.cutterVideo.removeAttribute('src');
  els.cutterVideo.load();
  state.activeItem = null;
}

document.querySelectorAll('#cutter [data-close]').forEach(el => {
  el.addEventListener('click', closeCutter);
});

els.inRange.addEventListener('input', () => {
  const inV = parseFloat(els.inRange.value);
  const outV = parseFloat(els.outRange.value);
  if (inV >= outV) els.inRange.value = String(Math.max(0, outV - 0.1));
  els.cutterVideo.currentTime = parseFloat(els.inRange.value);
  updateLabels();
});
els.outRange.addEventListener('input', () => {
  const inV = parseFloat(els.inRange.value);
  const outV = parseFloat(els.outRange.value);
  if (outV <= inV) els.outRange.value = String(inV + 0.1);
  updateLabels();
});

function updateLabels() {
  const inV = parseFloat(els.inRange.value);
  const outV = parseFloat(els.outRange.value);
  els.inLabel.textContent = `${inV.toFixed(2)}s`;
  els.outLabel.textContent = `${outV.toFixed(2)}s`;
  els.durLabel.textContent = `${(outV - inV).toFixed(2)}s`;
}

els.downloadFull.addEventListener('click', () => {
  if (state.activeItem) downloadDirect(state.activeItem);
});

els.doCut.addEventListener('click', async () => {
  if (!state.activeItem) return;
  const inV = parseFloat(els.inRange.value);
  const outV = parseFloat(els.outRange.value);
  const dur = outV - inV;
  if (dur <= 0.1) {
    setStatus('O corte precisa de pelo menos 0.1s.', 'err');
    return;
  }

  els.doCut.disabled = true;
  els.doCut.textContent = 'A preparar…';

  try {
    if (!ffmpegReady) {
      setStatus('A carregar ffmpeg (uma única vez, ~25MB)…', '');
      await loadFfmpeg();
      ffmpegReady = true;
    }
    setStatus('A descarregar clipe fonte…', '');
    const srcBytes = await fetchBytes(state.activeItem.fileUrl);
    const inExt = guessExt(state.activeItem.fileUrl) || 'mp4';
    const inName = `in.${inExt}`;
    const outName = 'out.mp4';

    await ffmpegInstance.writeFile(inName, srcBytes);

    setStatus('A cortar com ffmpeg…', '');
    // fast trim (copy) — muito rápido, mantém qualidade
    await ffmpegInstance.exec([
      '-ss', String(inV),
      '-i', inName,
      '-t', String(dur),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outName
    ]);

    const data = await ffmpegInstance.readFile(outName);
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    saveBlob(blob, buildFilename(state.activeItem, 'mp4', { in: inV, out: outV }));
    setStatus('Descarregado ✔', 'ok');
  } catch (err) {
    console.error('[cut] error', err);
    setStatus(`Erro: ${err.message || err}`, 'err');
  } finally {
    els.doCut.disabled = false;
    els.doCut.innerHTML = '<span>Cortar e descarregar</span>';
  }
});

function setStatus(msg, cls) {
  els.cutterStatus.textContent = msg;
  els.cutterStatus.className = 'status' + (cls ? ' ' + cls : '');
}

/* ---------- ffmpeg.wasm loader ---------- */

async function loadFfmpeg() {
  // ESM build from unpkg (multi-thread requires COOP/COEP; single-thread works everywhere)
  const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
  const util = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
  ffmpegInstance = new FFmpeg();
  ffmpegInstance.on('log', ({ message }) => {
    if (message && message.trim()) console.log('[ffmpeg]', message);
  });
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpegInstance.load({
    coreURL: await util.toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await util.toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha a buscar fonte (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/* ---------- Utils ---------- */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function buildFilename(item, ext, cut) {
  const base = (item.title || 'clip').replace(/[^a-z0-9]+/gi, '_').slice(0, 60).toLowerCase();
  const src = (item.source || 'src').toLowerCase();
  const range = cut ? `_${cut.in.toFixed(1)}-${cut.out.toFixed(1)}` : '';
  return `editflix_${src}_${base}${range}.${ext}`;
}

function guessExt(url) {
  const m = String(url).match(/\.(mp4|webm|mkv|mov|m4v)(\?|$)/i);
  return m ? m[1].toLowerCase() : null;
}

function formatDuration(s) {
  const n = Math.round(Number(s) || 0);
  if (!n) return '';
  const m = Math.floor(n / 60);
  const r = n % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
