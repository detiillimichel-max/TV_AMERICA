/* Hub — TV, rádio, notícias e clima
   Tudo com fontes públicas e gratuitas, sem chave de API:
   - TV:       iptv-org (playlists M3U por país)
   - Rádio:    Radio Browser
   - Notícias: RSS de portais, convertido por rss2json
   - Clima:    Open-Meteo
*/
'use strict';

/* ================= Configuração ================= */

const CONFIG = {
  tvCountries: [
    { key: 'br', label: 'Brasil' },
    { key: 'pt', label: 'Portugal' },
    { key: 'us', label: 'EUA' },
    { key: 'ar', label: 'Argentina' },
    { key: 'mx', label: 'México' },
    { key: 'co', label: 'Colômbia' },
    { key: 'cl', label: 'Chile' },
    { key: 'uy', label: 'Uruguai' }
  ],
  tvUrl: code => `https://iptv-org.github.io/iptv/countries/${code}.m3u`,

  radioTags: [
    { key: '', label: 'Populares' },
    { key: 'news', label: 'Notícias' },
    { key: 'sertanejo', label: 'Sertanejo' },
    { key: 'pop', label: 'Pop' },
    { key: 'gospel', label: 'Gospel' },
    { key: 'mpb', label: 'MPB' },
    { key: 'rock', label: 'Rock' }
  ],
  radioHosts: [
    'https://de1.api.radio-browser.info',
    'https://at1.api.radio-browser.info',
    'https://nl1.api.radio-browser.info',
    'https://de2.api.radio-browser.info'
  ],

  rss2json: 'https://api.rss2json.com/v1/api.json?rss_url=',
  news: [
    { name: 'G1', url: 'https://g1.globo.com/rss/g1/' },
    { name: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
    { name: 'BBC Brasil', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml' },
    { name: 'Folha', url: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml' }
  ],

  cities: [
    { name: 'São Paulo', lat: -23.55, lon: -46.63 },
    { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17 },
    { name: 'Brasília', lat: -15.79, lon: -47.88 },
    { name: 'Belo Horizonte', lat: -19.92, lon: -43.94 },
    { name: 'Salvador', lat: -12.97, lon: -38.50 },
    { name: 'Recife', lat: -8.05, lon: -34.88 },
    { name: 'Fortaleza', lat: -3.73, lon: -38.52 },
    { name: 'Manaus', lat: -3.12, lon: -60.02 },
    { name: 'Curitiba', lat: -25.43, lon: -49.27 },
    { name: 'Porto Alegre', lat: -30.03, lon: -51.23 }
  ]
};

const HOUR = 3600e3;
const MIN = 60e3;

/* ================= Utilitários ================= */

const $ = (sel, root = document) => root.querySelector(sel);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const initials = name => String(name || '?')
  .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const isHttps = u => typeof u === 'string' && u.startsWith('https://');

const cache = {
  get(key, maxAge) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      return Date.now() - t < maxAge ? v : null;
    } catch { return null; }
  },
  set(key, v) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* sem espaço */ }
  }
};

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
const fetchJSON = async (url, ms) => (await fetchWithTimeout(url, ms)).json();
const fetchText = async (url, ms) => (await fetchWithTimeout(url, ms)).text();

function skeleton(box, n, cls) {
  box.innerHTML = Array.from({ length: n }, () => `<div class="card ${cls} skeleton"></div>`).join('');
}

function showError(box, what, msg) {
  box.innerHTML = `<div class="empty">${esc(msg)}<button data-retry="${what}">Tentar de novo</button></div>`;
}

function renderChips(box, list, activeKey, onPick) {
  box.innerHTML = list.map(c =>
    `<button class="chip${c.key === activeKey ? ' is-active' : ''}" data-key="${esc(c.key)}">${esc(c.label)}</button>`
  ).join('');
  box.onclick = e => {
    const b = e.target.closest('.chip');
    if (!b || b.classList.contains('is-active')) return;
    box.querySelectorAll('.chip').forEach(x => x.classList.toggle('is-active', x === b));
    onPick(b.dataset.key);
  };
}

function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / MIN);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/* Imagens quebradas: logo vira iniciais, foto de notícia some */
document.addEventListener('error', e => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (t.dataset.ini !== undefined) {
    const b = document.createElement('b');
    b.textContent = t.dataset.ini;
    t.replaceWith(b);
  } else if (t.hasAttribute('data-hide')) {
    t.remove();
  }
}, true);

/* ================= Reprodução (HLS + áudio) ================= */

const hlsInst = { video: null, audio: null };

function stopHls(kind) {
  if (hlsInst[kind]) { hlsInst[kind].destroy(); hlsInst[kind] = null; }
}

function resetMedia(media, kind) {
  stopHls(kind);
  media.pause();
  media.removeAttribute('src');
  media.load();
}

/* Toca um stream .m3u8 (HLS): nativo no Safari, hls.js nos demais */
function playHls(media, kind, url, onFail) {
  stopHls(kind);
  media.removeAttribute('src');

  if (media.canPlayType('application/vnd.apple.mpegurl')) {
    media.src = url;
  } else if (window.Hls && window.Hls.isSupported()) {
    const h = new window.Hls({ enableWorker: true });
    hlsInst[kind] = h;
    h.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) onFail(); });
    h.loadSource(url);
    h.attachMedia(media);
  } else {
    onFail();
    return;
  }
  const p = media.play();
  if (p && p.catch) p.catch(() => { /* o navegador pode exigir um toque */ });
}

/* ================= TV ================= */

const tv = { code: 'br', items: [], open: false };
const sheet = $('#sheet');
const video = $('#video');

/* Lê a playlist M3U. Descarta streams sem https ou que exigem cabeçalhos
   especiais (o navegador não consegue enviá-los) e nomes repetidos. */
function parseM3U(text) {
  const out = [];
  const seen = new Set();
  let cur = null;

  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;

    if (l.startsWith('#EXTINF')) {
      const attr = k => (l.match(new RegExp(k + '="([^"]*)"')) || [])[1] || '';
      const stripped = l.replace(/[\w-]+="[^"]*"/g, '');
      let name = stripped.slice(stripped.indexOf(',') + 1).trim();
      const quality = (name.match(/\((\d{3,4}p)\)/) || [])[1] || '';
      name = name.replace(/\s*\(\d{3,4}p\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
      cur = { name, quality, logo: attr('tvg-logo'), needsHeaders: false };
    } else if (l.startsWith('#EXTVLCOPT') && cur) {
      if (/http-(referrer|user-agent)/i.test(l)) cur.needsHeaders = true;
    } else if (!l.startsWith('#') && cur) {
      const key = cur.name.toLowerCase();
      if (cur.name && isHttps(l) && !cur.needsHeaders && !seen.has(key)) {
        seen.add(key);
        out.push({ name: cur.name, quality: cur.quality, logo: isHttps(cur.logo) ? cur.logo : '', url: l });
      }
      cur = null;
    }
  }
  return out.slice(0, 80);
}

function tvCard(ch, i) {
  const ini = initials(ch.name);
  const thumb = ch.logo
    ? `<img src="${esc(ch.logo)}" alt="" loading="lazy" data-ini="${esc(ini)}">`
    : `<b>${esc(ini)}</b>`;
  return `<button class="card card--tv" data-idx="${i}">
    <span class="thumb">${thumb}</span>
    <span class="card__title">${esc(ch.name)}</span>
    <span class="badge">Ao vivo</span>
  </button>`;
}

async function loadTV(code = tv.code) {
  tv.code = code;
  const box = $('#tv-list');
  skeleton(box, 6, 'card--tv');
  try {
    const key = 'hub.tv.' + code;
    let items = cache.get(key, 6 * HOUR);
    if (!items) {
      items = parseM3U(await fetchText(CONFIG.tvUrl(code)));
      if (items.length) cache.set(key, items);
    }
    tv.items = items;
    if (!items.length) { showError(box, 'tv', 'Nenhum canal disponível para este país agora.'); return; }
    box.innerHTML = items.map(tvCard).join('');
    box.scrollLeft = 0;
  } catch {
    showError(box, 'tv', 'Não foi possível carregar os canais. Verifique a conexão.');
  }
}

function openTV(ch) {
  stopRadio();
  tv.open = true;
  $('#sheet-title').textContent = ch.name;
  $('#sheet-msg').textContent = 'Carregando o canal…';
  sheet.classList.add('is-open');
  sheet.setAttribute('aria-hidden', 'false');
  playHls(video, 'video', ch.url, tvFail);
}

function tvFail() {
  if (tv.open) $('#sheet-msg').textContent = 'Este canal está fora do ar. Feche e escolha outro.';
}

function closeTV() {
  tv.open = false;
  sheet.classList.remove('is-open');
  sheet.setAttribute('aria-hidden', 'true');
  resetMedia(video, 'video');
}

video.addEventListener('playing', () => { $('#sheet-msg').textContent = ''; });
video.addEventListener('waiting', () => { if (tv.open) $('#sheet-msg').textContent = 'Carregando…'; });
video.addEventListener('error', () => { if (tv.open && video.getAttribute('src')) tvFail(); });

sheet.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeTV(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tv.open) closeTV(); });

$('#tv-list').addEventListener('click', e => {
  const b = e.target.closest('[data-idx]');
  if (b && tv.items[+b.dataset.idx]) openTV(tv.items[+b.dataset.idx]);
});

/* ================= Rádios ================= */

const radio = { tag: '', items: [], cur: -1 };
const audio = $('#audio');
const mini = $('#mini');

async function fetchStations(tag) {
  const qs = new URLSearchParams({
    countrycode: 'BR', hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '100'
  });
  if (tag) qs.set('tag', tag);
  for (const host of CONFIG.radioHosts) {
    try { return await fetchJSON(`${host}/json/stations/search?${qs}`, 10000); } catch { /* tenta o próximo servidor */ }
  }
  throw new Error('radio');
}

function radioCard(st, i) {
  const ini = initials(st.name);
  const thumb = st.logo
    ? `<img src="${esc(st.logo)}" alt="" loading="lazy" data-ini="${esc(ini)}">`
    : `<b>${esc(ini)}</b>`;
  return `<button class="card card--radio${i === radio.cur ? ' is-active' : ''}" data-idx="${i}">
    <span class="thumb">${thumb}</span>
    <span class="card__title">${esc(st.name)}</span>
    <span class="card__sub">${esc(st.place || st.tag || 'Rádio')}</span>
  </button>`;
}

async function loadRadios(tag = radio.tag) {
  radio.tag = tag;
  radio.cur = -1;
  const box = $('#radio-list');
  skeleton(box, 6, 'card--radio');
  try {
    const key = 'hub.radio.' + (tag || 'top');
    let items = cache.get(key, 6 * HOUR);
    if (!items) {
      const seen = new Set();
      items = (await fetchStations(tag))
        .filter(s => {
          const name = (s.name || '').trim().toLowerCase();
          if (!name || seen.has(name) || !isHttps(s.url_resolved)) return false;
          seen.add(name);
          return true;
        })
        .slice(0, 40)
        .map(s => ({
          name: s.name.trim(),
          url: s.url_resolved,
          hls: s.hls === 1,
          logo: isHttps(s.favicon) ? s.favicon : '',
          place: s.state || '',
          tag: (s.tags || '').split(',')[0].trim()
        }));
      if (items.length) cache.set(key, items);
    }
    radio.items = items;
    if (!items.length) { showError(box, 'radio', 'Nenhuma rádio encontrada nesta categoria.'); return; }
    box.innerHTML = items.map(radioCard).join('');
    box.scrollLeft = 0;
  } catch {
    showError(box, 'radio', 'Não foi possível carregar as rádios. Verifique a conexão.');
  }
}

function setMiniLogo(st) {
  const box = $('#mini-logo');
  box.innerHTML = '';
  if (st.logo) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = st.logo;
    img.dataset.ini = initials(st.name);
    box.appendChild(img);
  } else {
    box.innerHTML = `<b>${esc(initials(st.name))}</b>`;
  }
}

function playRadio(idx) {
  const st = radio.items[idx];
  if (!st) return;
  closeTV();
  radio.cur = idx;
  document.querySelectorAll('#radio-list .card').forEach(c =>
    c.classList.toggle('is-active', +c.dataset.idx === idx));

  $('#mini-name').textContent = st.name;
  $('#mini-status').textContent = 'Conectando…';
  $('#mini-toggle').textContent = '⏸';
  setMiniLogo(st);
  mini.classList.add('is-open');
  mini.setAttribute('aria-hidden', 'false');

  if (st.hls || /\.m3u8(\?|$)/i.test(st.url)) {
    playHls(audio, 'audio', st.url, radioFail);
  } else {
    stopHls('audio');
    audio.src = st.url;
    audio.play().catch(() => { /* o navegador pode exigir um toque */ });
  }

  if ('mediaSession' in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: st.name,
      artist: 'Rádio ao vivo',
      artwork: st.logo ? [{ src: st.logo }] : []
    });
  }
}

function radioFail() { $('#mini-status').textContent = 'Sem sinal. Tente outra rádio.'; }

function stopRadio() {
  radio.cur = -1;
  resetMedia(audio, 'audio');
  mini.classList.remove('is-open');
  mini.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('#radio-list .card.is-active').forEach(c => c.classList.remove('is-active'));
}

audio.addEventListener('playing', () => {
  $('#mini-status').textContent = 'Ao vivo';
  $('#mini-toggle').textContent = '⏸';
});
audio.addEventListener('pause', () => { if (radio.cur >= 0) $('#mini-toggle').textContent = '▶'; });
audio.addEventListener('waiting', () => { if (radio.cur >= 0) $('#mini-status').textContent = 'Carregando…'; });
audio.addEventListener('error', () => { if (radio.cur >= 0 && audio.getAttribute('src')) radioFail(); });

$('#mini-toggle').addEventListener('click', () => {
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
});
$('#mini-close').addEventListener('click', stopRadio);

$('#radio-list').addEventListener('click', e => {
  const b = e.target.closest('[data-idx]');
  if (b) playRadio(+b.dataset.idx);
});

/* ================= Notícias ================= */

async function loadFeed(feed) {
  const data = await fetchJSON(CONFIG.rss2json + encodeURIComponent(feed.url), 12000);
  if (data.status !== 'ok') throw new Error('feed');
  return (data.items || []).slice(0, 8).map(it => {
    const enc = it.enclosure && /image/i.test(it.enclosure.type || '') ? it.enclosure.link : '';
    const inline = ((it.content || it.description || '').match(/<img[^>]+src=["']([^"']+)/i) || [])[1];
    const img = [it.thumbnail, enc, inline].find(isHttps) || '';
    const ts = Date.parse(String(it.pubDate || '').replace(' ', 'T') + 'Z') || 0;
    return { source: feed.name, title: (it.title || '').trim(), link: it.link, img, ts };
  }).filter(n => n.title && /^https?:\/\//.test(n.link || ''));
}

function newsCard(n) {
  const img = n.img ? `<img src="${esc(n.img)}" alt="" loading="lazy" data-hide>` : '';
  return `<a class="card card--news" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
    <span class="news__img">${img}</span>
    <span class="news__body">
      <span class="pill">${esc(n.source)}</span>
      <span class="news__title">${esc(n.title)}</span>
      <span class="news__time">${timeAgo(n.ts)}</span>
    </span>
  </a>`;
}

async function loadNews() {
  const box = $('#news-list');
  skeleton(box, 4, 'card--news');
  try {
    let items = cache.get('hub.news', 10 * MIN);
    if (!items) {
      const results = await Promise.allSettled(CONFIG.news.map(loadFeed));
      items = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
      if (!items.length) throw new Error('news');
      items.sort((a, b) => b.ts - a.ts);
      items = items.slice(0, 24);
      cache.set('hub.news', items);
    }
    box.innerHTML = items.map(newsCard).join('');
    box.scrollLeft = 0;
  } catch {
    showError(box, 'news', 'Não foi possível carregar as notícias agora.');
  }
}

/* ================= Clima ================= */

function wmo(code, isDay) {
  if (code === 0) return isDay ? ['☀️', 'Céu limpo'] : ['🌙', 'Céu limpo'];
  if (code <= 2) return [isDay ? '🌤️' : '☁️', 'Poucas nuvens'];
  if (code === 3) return ['☁️', 'Nublado'];
  if (code <= 48) return ['🌫️', 'Neblina'];
  if (code <= 57) return ['🌦️', 'Garoa'];
  if (code <= 67) return ['🌧️', 'Chuva'];
  if (code <= 77) return ['❄️', 'Neve'];
  if (code <= 82) return ['🌧️', 'Pancadas de chuva'];
  if (code <= 86) return ['❄️', 'Neve'];
  return ['⛈️', 'Tempestade'];
}

function tone(code, isDay) {
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  if (!isDay) return 'night';
  return code <= 1 ? 'sun' : 'cloud';
}

function weatherCard(name, d, attrs = '') {
  const cur = d.current;
  const daily = d.daily;
  const isDay = cur.is_day === 1;
  const [icon, label] = wmo(cur.weather_code, isDay);
  const rain = daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : null;
  return `<div class="card card--weather" ${attrs} data-tone="${tone(cur.weather_code, isDay)}">
    <span class="w__city">${esc(name)}</span>
    <span class="w__icon">${icon}</span>
    <span class="w__temp">${Math.round(cur.temperature_2m)}°</span>
    <span class="w__label">${label}</span>
    <span class="w__range">Máx ${Math.round(daily.temperature_2m_max[0])}° Mín ${Math.round(daily.temperature_2m_min[0])}°</span>
    <span class="w__rain">Chuva ${rain ?? 0}%</span>
  </div>`;
}

function forecastUrl(lats, lons) {
  const qs = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    current: 'temperature_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '1'
  });
  return 'https://api.open-meteo.com/v1/forecast?' + qs;
}

async function loadWeather() {
  const box = $('#city-slot');
  skeleton(box, 4, 'card--weather');
  try {
    let data = cache.get('hub.weather', 15 * MIN);
    if (!data) {
      const c = CONFIG.cities;
      const r = await fetchJSON(forecastUrl(c.map(x => x.lat), c.map(x => x.lon)));
      data = Array.isArray(r) ? r : [r];
      cache.set('hub.weather', data);
    }
    box.innerHTML = data.map((d, i) => weatherCard(CONFIG.cities[i].name, d)).join('');
  } catch {
    showError(box, 'weather', 'Não foi possível carregar a previsão agora.');
  }
}

/* "Meu local": pede a localização só quando a pessoa tocar no card */
const myLoc = {
  slot: $('#my-slot'),

  promptCard(msg = 'Usar minha localização') {
    this.slot.innerHTML = `<button class="card card--weather" id="my-loc" data-tone="cloud">
      <span class="w__icon">📍</span><span class="w__label">${esc(msg)}</span></button>`;
  },

  async show(lat, lon) {
    try {
      const [w, name] = await Promise.all([
        fetchJSON(forecastUrl([lat], [lon])),
        fetchJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`, 8000)
          .then(r => r.city || r.locality || '').catch(() => '')
      ]);
      this.slot.innerHTML = weatherCard(name || 'Meu local', Array.isArray(w) ? w[0] : w);
    } catch {
      this.promptCard('Falhou. Tocar para tentar de novo');
    }
  },

  ask() {
    if (!navigator.geolocation) { this.promptCard('Localização indisponível'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try { localStorage.setItem('hub.loc', JSON.stringify({ lat, lon })); } catch { /* ok */ }
        this.show(lat, lon);
      },
      () => this.promptCard('Permissão negada. Tocar para tentar'),
      { timeout: 10000, maximumAge: 10 * MIN }
    );
  },

  init() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('hub.loc') || 'null'); } catch { /* ok */ }
    if (saved && typeof saved.lat === 'number') this.show(saved.lat, saved.lon);
    else this.promptCard();
  }
};

$('#my-slot').addEventListener('click', e => {
  if (e.target.closest('#my-loc')) myLoc.ask();
});

/* ================= Interface geral ================= */

document.addEventListener('click', e => {
  /* "Ver tudo": alterna entre carrossel e grade */
  const tgl = e.target.closest('[data-toggle]');
  if (tgl) {
    const grid = $('#' + tgl.dataset.toggle).classList.toggle('carousel--grid');
    tgl.textContent = grid ? 'Recolher' : 'Ver tudo';
    return;
  }
  /* Botão "Tentar de novo" dos estados de erro */
  const retry = e.target.closest('[data-retry]');
  if (retry) {
    const map = { tv: () => loadTV(), radio: () => loadRadios(), news: loadNews, weather: loadWeather };
    if (map[retry.dataset.retry]) map[retry.dataset.retry]();
  }
});

function setHeader() {
  const now = new Date();
  const h = now.getHours();
  $('#hello').textContent = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  $('#today').textContent = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).format(now);
}

/* Destaca o botão da navegação conforme a seção visível */
function watchSections() {
  const tabs = [...document.querySelectorAll('.tabbar a')];
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        tabs.forEach(t => t.classList.toggle('is-active', t.hash === '#' + en.target.id));
      }
    });
  }, { rootMargin: '-35% 0px -55% 0px' });
  document.querySelectorAll('main section').forEach(s => io.observe(s));
}

function init() {
  setHeader();
  watchSections();

  renderChips($('#tv-chips'), CONFIG.tvCountries, tv.code, key => loadTV(key));
  renderChips($('#radio-chips'), CONFIG.radioTags, radio.tag, key => { stopRadio(); loadRadios(key); });

  myLoc.init();
  loadTV();
  loadRadios();
  loadNews();
  loadWeather();
}

init();


  
