/* EditFlix Worker — /api/search
   Fan-out para Sakugabooru, AnimeThemes.moe, YouTube.
   Sem estado local; cache opcional em KV binding "EDITFLIX_CACHE" (24h).

   Configuração:
   - YOUTUBE_API_KEY (secret) — opcional. Sem key, YouTube é ignorado.
   - EDITFLIX_CACHE (KV) — opcional. Sem binding, corre sem cache.
*/

const CACHE_TTL = 60 * 60 * 24; // 24h
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/api/search') {
      return handleSearch(url, env, ctx);
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, ts: Date.now() });
    }

    if (url.pathname === '/api/status') {
      return json({
        keys: {
          youtube: !!env.YOUTUBE_API_KEY,
          tmdb: !!env.TMDB_API_KEY,
        },
        cache: !!env.EDITFLIX_CACHE,
      });
    }

    if (url.pathname === '/api/packs') {
      return handlePacks(url, env);
    }

    return json({ error: 'not_found' }, 404);
  },
};

async function handleSearch(url, env, ctx) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'missing_q' }, 400);

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const minRes = parseInt(url.searchParams.get('minRes') || '0', 10);
  const minFps = parseInt(url.searchParams.get('minFps') || '0', 10);
  const sources = new Set(url.searchParams.getAll('src'));
  if (sources.size === 0) {
    sources.add('sakuga'); sources.add('themes'); sources.add('youtube');
  }

  const cacheKey = `s:${q}:${page}:${minRes}:${minFps}:${[...sources].sort().join(',')}`;
  if (env.EDITFLIX_CACHE) {
    const hit = await env.EDITFLIX_CACHE.get(cacheKey, 'json');
    if (hit) return json(hit);
  }

  const category = (url.searchParams.get('category') || 'all').toLowerCase();
  const twixtorOnly = url.searchParams.get('twixtor') === '1';

  const tasks = [];
  if (sources.has('sakuga')) tasks.push(searchSakuga(q, page, { twixtor: twixtorOnly }).catch(err => logErr('sakuga', err) || []));
  if (sources.has('themes')) tasks.push(searchAnimeThemes(q, page).catch(err => logErr('themes', err) || []));
  if (sources.has('youtube') && env.YOUTUBE_API_KEY) tasks.push(searchYouTube(q, page, env.YOUTUBE_API_KEY, category).catch(err => logErr('youtube', err) || []));
  if (sources.has('tmdb')) tasks.push(searchTMDb(q, page, env.TMDB_API_KEY, category).catch(err => logErr('tmdb', err) || []));
  if (sources.has('reddit')) tasks.push(searchReddit(q, page, category).catch(err => logErr('reddit', err) || []));
  if (sources.has('archive')) tasks.push(searchArchive(q, page, category).catch(err => logErr('archive', err) || []));

  const groups = await Promise.all(tasks);
  let results = groups.flat();

  // Filtro de conteúdo — remove reactions, gameplay, parodias, memes.
  results = results.filter(r => !isNoise(r.title));

  // Se pediu só twixtor, apenas resultados marcados.
  if (twixtorOnly) {
    results = results.filter(r => r.type === 'twixtor' || /twixtor/i.test(r.title));
  }

  // Filtro por resolução mínima — só exclui quando a resolução É conhecida e inferior.
  // Resultados sem resolução conhecida passam (mostram-se ao user, que decide).
  if (minRes > 0) {
    results = results.filter(r => !r.height || r.height >= minRes);
  }
  // Filtro por fps mínimo — mesma lógica.
  if (minFps > 0) {
    results = results.filter(r => !r.fps || r.fps >= minFps);
  }

  // Ordenar: primeiro os que têm ficheiro para cortar, depois por resolução desc
  results.sort((a, b) => {
    if (a.canCut !== b.canCut) return a.canCut ? -1 : 1;
    return (b.height || 0) - (a.height || 0);
  });

  const payload = {
    query: q,
    page,
    count: results.length,
    results,
  };

  if (env.EDITFLIX_CACHE) {
    ctx.waitUntil(env.EDITFLIX_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL }));
  }

  return json(payload);
}

/* ---------- Sakugabooru ---------- */
async function searchSakuga(q, page, opts = {}) {
  let tags = q.trim().toLowerCase().replace(/\s+/g, '_');
  if (opts.twixtor) tags += ' twixtor';
  const params = new URLSearchParams({
    tags,
    limit: '20',
    page: String(page),
  });
  const res = await fetch(`https://www.sakugabooru.com/post.json?${params}`, {
    headers: { 'User-Agent': 'EditFlix/0.1 (+https://editflix.pt)' },
  });
  if (!res.ok) throw new Error(`sakuga http ${res.status}`);
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];

  return posts.map(p => {
    const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(p.file_url || '');
    const height = p.height || p.image_height || 0;
    const width = p.width || p.image_width || 0;
    const anime = extractSakugaAnime(p.tags);
    const animator = extractSakugaAnimator(p.tags);
    const isTwixtor = /(^|\s)twixtor(\s|$)/i.test(p.tags || '');
    return {
      id: `sakuga_${p.id}`,
      source: 'Sakugabooru',
      type: isTwixtor ? 'twixtor' : 'scene',
      title: (p.tags || '').replace(/_/g, ' ').split(' ').slice(0, 6).join(' ') || `sakuga #${p.id}`,
      anime,
      animator,
      resolution: height ? `${height}p` : null,
      height,
      width,
      fps: null,
      duration: null,
      previewVideo: isVideo ? p.file_url : null,
      previewImage: p.preview_url || p.sample_url,
      fileUrl: p.file_url,
      canCut: isVideo,
      externalUrl: `https://www.sakugabooru.com/post/show/${p.id}`,
    };
  });
}

function extractSakugaAnime(tags) {
  if (!tags) return null;
  const list = tags.split(' ');
  const series = list.find(t => /_series$/i.test(t) || /jujutsu|naruto|bleach|demon_slayer|attack_on_titan|chainsaw|one_piece/i.test(t));
  return series ? series.replace(/_series$/, '').replace(/_/g, ' ') : null;
}
function extractSakugaAnimator(tags) {
  if (!tags) return null;
  const cred = tags.split(' ').find(t => t.includes('animation') || t.includes('_animator'));
  return cred ? cred.replace(/_/g, ' ') : null;
}

/* ---------- AnimeThemes.moe ---------- */
async function searchAnimeThemes(q, page) {
  const params = new URLSearchParams({
    'filter[name-like]': `%${q}%`,
    'include': 'animethemes.animethemeentries.videos',
    'page[number]': String(page),
    'page[size]': '10',
  });
  const res = await fetch(`https://api.animethemes.moe/anime?${params}`, {
    headers: { 'User-Agent': 'EditFlix/0.1 (+https://editflix.pt)' },
  });
  if (!res.ok) throw new Error(`themes http ${res.status}`);
  const data = await res.json();
  const results = [];
  for (const anime of (data.anime || [])) {
    for (const theme of (anime.animethemes || [])) {
      for (const entry of (theme.animethemeentries || [])) {
        for (const video of (entry.videos || [])) {
          const height = video.resolution || 0;
          results.push({
            id: `themes_${video.id}`,
            source: 'AnimeThemes',
            type: 'opening',
            title: `${anime.name} — ${theme.slug || theme.type}`,
            anime: anime.name,
            animator: null,
            resolution: height ? `${height}p` : null,
            height,
            width: null,
            fps: null,
            duration: null,
            previewVideo: video.link,
            previewImage: null,
            fileUrl: video.link,
            canCut: true,
            externalUrl: `https://animethemes.moe/anime/${anime.slug}`,
          });
        }
      }
    }
  }
  return results;
}

/* ---------- YouTube ---------- */
async function searchYouTube(q, page, apiKey, category) {
  // Data API v3 não tem "page number" tradicional, usa pageToken. Simplificação: só página 1 por agora.
  if (page > 1) return [];
  const negatives = ' -react -reaction -reacts -gameplay -walkthrough -parody -meme -review -analysis -tierlist';
  const qualifier = category === 'anime' ? ' AMV source 1080p' + negatives
    : category === 'movies' ? ' movieclips scene 1080p' + negatives
    : category === 'series' ? ' scene 1080p' + negatives
    : ' 1080p' + negatives;
  const params = new URLSearchParams({
    part: 'snippet',
    q: q + qualifier,
    type: 'video',
    videoDefinition: 'high',
    maxResults: '10',
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) throw new Error(`youtube http ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(it => ({
    id: `yt_${it.id.videoId}`,
    source: 'YouTube',
    type: 'video',
    title: it.snippet.title,
    anime: it.snippet.channelTitle,
    animator: null,
    resolution: '1080p+',
    height: 1080, // best-effort; a Data API não devolve altura real sem outra chamada
    width: null,
    fps: null,
    duration: null,
    previewVideo: null,
    previewImage: (it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default).url,
    fileUrl: null,
    canCut: false, // V1: yt-dlp em container
    externalUrl: `https://www.youtube.com/watch?v=${it.id.videoId}`,
  }));
}

/* ---------- TMDb ---------- */
// The Movie Database — usa v3 API. Sem key, tenta v4 (public) via search multi.
// Recomendação: obter key gratuita em https://www.themoviedb.org/settings/api
async function searchTMDb(q, page, apiKey, category) {
  if (!apiKey) return []; // sem key, salta silenciosamente
  const endpoint = category === 'movies' ? 'movie' : category === 'series' ? 'tv' : 'multi';
  const params = new URLSearchParams({
    api_key: apiKey,
    query: q,
    page: String(page),
    include_adult: 'false',
    language: 'en-US',
  });
  const res = await fetch(`https://api.themoviedb.org/3/search/${endpoint}?${params}`);
  if (!res.ok) throw new Error(`tmdb http ${res.status}`);
  const data = await res.json();

  // Para cada resultado, buscar vídeos (trailers) em paralelo
  const items = (data.results || []).slice(0, 8);
  const withVideos = await Promise.all(items.map(async (it) => {
    const mtype = it.media_type || (endpoint === 'multi' ? null : endpoint);
    if (!mtype || (mtype !== 'movie' && mtype !== 'tv')) return null;
    const vidRes = await fetch(`https://api.themoviedb.org/3/${mtype}/${it.id}/videos?api_key=${apiKey}`);
    if (!vidRes.ok) return null;
    const vd = await vidRes.json();
    const yt = (vd.results || []).find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Clip' || v.type === 'Teaser'));
    return { it, mtype, yt };
  }));

  const results = [];
  for (const w of withVideos) {
    if (!w || !w.yt) continue;
    const { it, mtype, yt } = w;
    const title = it.title || it.name;
    const year = (it.release_date || it.first_air_date || '').slice(0, 4);
    results.push({
      id: `tmdb_${mtype}_${it.id}`,
      source: mtype === 'tv' ? 'TMDb (série)' : 'TMDb (filme)',
      type: (yt.type || 'trailer').toLowerCase(),
      title: `${title}${year ? ` (${year})` : ''} — ${yt.name || 'trailer'}`,
      anime: null,
      animator: null,
      resolution: yt.size ? `${yt.size}p` : '1080p',
      height: yt.size || 1080,
      width: null,
      fps: null,
      duration: null,
      previewVideo: null,
      previewImage: it.backdrop_path ? `https://image.tmdb.org/t/p/w780${it.backdrop_path}` : (it.poster_path ? `https://image.tmdb.org/t/p/w780${it.poster_path}` : null),
      fileUrl: null,
      canCut: false,
      externalUrl: `https://www.youtube.com/watch?v=${yt.key}`,
    });
  }
  return results;
}

/* ---------- Reddit ---------- */
// Reddit exige User-Agent identificável ou devolve 403/429 silenciosamente.
const REDDIT_UA = 'EditFlix/0.2 (clip finder for editors; +https://eupostoapp.pages.dev/editflix-site/)';

// Subs de packs (Twitter/Discord são a fonte principal mas Reddit tem mirrors)
const PACK_SUBS = ['scenepacks', 'AnimeSceneSource', 'AMVSourcing', 'sceneSourceRequests'];

async function searchReddit(q, page, category) {
  const contentSubs = category === 'anime' ? ['sakuga', 'AnimeSakuga', 'anime']
    : category === 'movies' ? ['moviescenes', 'cinemagems', 'HighQualityGifs']
    : category === 'series' ? ['tvscenes', 'HighQualityGifs']
    : ['moviescenes', 'sakuga', 'cinemagems', 'HighQualityGifs', 'tvscenes'];
  const subs = [...new Set([...PACK_SUBS, ...contentSubs])];

  // Reddit bloqueou JSON. RSS ainda funciona. Uma query global search.rss filtrada por sub.
  const perSub = 15;
  const searches = subs.map(sub =>
    fetch(`https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=on&limit=${perSub}&sort=relevance&t=all&include_over_18=on`, {
      headers: { 'User-Agent': REDDIT_UA, 'Accept': 'application/atom+xml,application/xml' },
    })
      .then(r => r.ok ? r.text() : null)
      .then(xml => xml ? parseRedditRss(xml, sub) : [])
      .catch(() => [])
  );

  const perSubResults = await Promise.all(searches);
  return perSubResults.flat();
}

function parseRedditRss(xml, sub) {
  const entries = xml.split('<entry>').slice(1);
  const out = [];
  for (const raw of entries) {
    const entry = raw.split('</entry>')[0];
    const title = htmlDecode(pick(entry, /<title[^>]*>([\s\S]*?)<\/title>/));
    const author = pick(entry, /<name>([\s\S]*?)<\/name>/)?.replace(/^\/u\//, '') || null;
    const permalink = pick(entry, /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/) || pick(entry, /<link[^>]*href=["']([^"']+)["']/);
    const content = htmlDecode(pick(entry, /<content[^>]*>([\s\S]*?)<\/content>/) || '');
    const postId = permalink ? (permalink.match(/comments\/([a-z0-9]+)/i) || [])[1] : null;
    if (!title) continue;

    // Extrai link do "conteúdo" ([link] aponta para o media do post)
    const mediaLinkMatch = content.match(/<a\s+href=["']([^"']+)["']>\s*\[link\]\s*<\/a>/i);
    const mediaUrl = mediaLinkMatch ? mediaLinkMatch[1] : null;
    // Extrai thumbnail
    const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    const previewImage = imgMatch ? imgMatch[1] : null;

    const packUrl = extractPackUrl(content) || extractPackUrl(mediaUrl || '');
    const isPackSub = PACK_SUBS.includes(sub);
    const isTwixtor = /twixtor/i.test(title);
    const is4k = /\b(2160p|4k)\b/i.test(title);
    const isEpisode = /\b(episode|episódio|full episode|complete)\b/i.test(title);

    // Caminho pack: URL de host de partilha detetada, ou sub de packs
    if (packUrl || isPackSub) {
      if (!packUrl) continue;
      out.push({
        id: `reddit_pack_${postId || Math.random().toString(36).slice(2)}`,
        source: `r/${sub}`,
        type: isTwixtor ? 'twixtor' : (is4k ? '4k' : 'scenepack'),
        title,
        anime: null,
        animator: author ? `u/${author}` : null,
        resolution: extractResolutionFromTitle(title),
        height: extractHeightFromTitle(title),
        width: 0,
        fps: extractFpsFromTitle(title),
        duration: null,
        previewVideo: null,
        previewImage,
        fileUrl: packUrl,
        canCut: false,
        externalUrl: permalink,
      });
      continue;
    }

    // Caminho cena/clipe direto (v.redd.it, imgur, .mp4, .gifv)
    let fileUrl = null, previewVideo = null, canCut = false;
    if (mediaUrl) {
      if (/v\.redd\.it\/[a-z0-9]+/i.test(mediaUrl)) {
        fileUrl = mediaUrl + '/DASH_720.mp4';
        previewVideo = fileUrl;
        canCut = true;
      } else if (/\.(mp4|webm|gifv)(\?|$)/i.test(mediaUrl)) {
        fileUrl = mediaUrl.replace(/\.gifv$/, '.mp4');
        previewVideo = fileUrl;
        canCut = true;
      } else if (/imgur\.com\/[a-z0-9]+$/i.test(mediaUrl)) {
        fileUrl = mediaUrl + '.mp4';
        previewVideo = fileUrl;
        canCut = true;
      }
    }
    if (!fileUrl && !previewImage) continue;

    out.push({
      id: `reddit_${postId || Math.random().toString(36).slice(2)}`,
      source: `r/${sub}`,
      type: isEpisode ? 'episode' : 'scene',
      title,
      anime: null,
      animator: author ? `u/${author}` : null,
      resolution: extractResolutionFromTitle(title),
      height: extractHeightFromTitle(title),
      width: 0,
      fps: null,
      duration: null,
      previewVideo,
      previewImage,
      fileUrl,
      canCut,
      externalUrl: permalink,
    });
  }
  return out;
}

function pick(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}
function htmlDecode(s) {
  if (!s) return s;
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#32;/g, ' ')
    .replace(/&amp;/g, '&');
}

function extractPackUrl(text) {
  const patterns = [
    /https?:\/\/drive\.google\.com\/[^\s)>\]]+/i,
    /https?:\/\/mega\.nz\/[^\s)>\]]+/i,
    /https?:\/\/(?:www\.)?dropbox\.com\/[^\s)>\]]+/i,
    /https?:\/\/we\.tl\/[^\s)>\]]+/i,
    /https?:\/\/(?:www\.)?mediafire\.com\/[^\s)>\]]+/i,
    /https?:\/\/pixeldrain\.com\/[^\s)>\]]+/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/[),.\]]+$/, '');
  }
  return null;
}
function extractResolutionFromTitle(title) {
  if (!title) return null;
  const m = title.match(/(\d{3,4})p/i);
  return m ? `${m[1]}p` : null;
}
function extractHeightFromTitle(title) {
  const r = extractResolutionFromTitle(title);
  return r ? parseInt(r) : 0;
}
function extractFpsFromTitle(title) {
  if (!title) return null;
  const m = title.match(/(\d{2,3})\s*fps/i);
  return m ? parseInt(m[1]) : null;
}
function extractPreviewImage(p) {
  if (p.preview && p.preview.images && p.preview.images[0]) {
    return String(p.preview.images[0].source.url).replace(/&amp;/g, '&');
  }
  if (p.thumbnail && /^https?:/.test(p.thumbnail)) return p.thumbnail;
  return null;
}

/* ---------- Internet Archive ---------- */
async function searchArchive(q, page, category) {
  // Archive.org só tem material em domínio público. Séries modernas / IP ativo NÃO estão lá.
  // Query rigorosa: match no TÍTULO + downloads mínimos → evita lixo aleatório.
  const cleaned = q.replace(/[^\w\s-]/g, '').trim();
  if (!cleaned) return [];
  const query = `title:(${cleaned}) AND mediatype:movies AND downloads:[500 TO *]`;
  const params = new URLSearchParams({
    q: query,
    fl: 'identifier,title,description,year,downloads',
    rows: '10',
    page: String(page),
    output: 'json',
    sort: 'downloads desc',
  });
  const res = await fetch(`https://archive.org/advancedsearch.php?${params}`);
  if (!res.ok) throw new Error(`archive http ${res.status}`);
  const data = await res.json();
  const docs = (data.response && data.response.docs) || [];

  // Para cada, buscar ficheiros disponíveis (formatos de vídeo)
  const results = await Promise.all(docs.map(async (d) => {
    try {
      const metaRes = await fetch(`https://archive.org/metadata/${d.identifier}`);
      if (!metaRes.ok) return null;
      const meta = await metaRes.json();
      const files = (meta.files || []).filter(f => /\.(mp4|mkv|webm|mov)$/i.test(f.name));
      if (files.length === 0) return null;
      // Prefere ficheiros h264 ou mais pequenos
      files.sort((a, b) => (parseInt(a.size || '0') - parseInt(b.size || '0')));
      const best = files[0];
      const fileUrl = `https://archive.org/download/${d.identifier}/${encodeURIComponent(best.name)}`;
      const height = parseInt(best.height || '0') || 0;
      return {
        id: `archive_${d.identifier}`,
        source: 'Archive.org',
        type: 'episode',
        title: d.title || d.identifier,
        anime: null,
        animator: null,
        resolution: height ? `${height}p` : null,
        height,
        width: parseInt(best.width || '0') || 0,
        fps: null,
        duration: parseFloat(best.length || '0') || null,
        previewVideo: null,
        previewImage: `https://archive.org/services/img/${d.identifier}`,
        fileUrl,
        canCut: true,
        externalUrl: `https://archive.org/details/${d.identifier}`,
      };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

/* ---------- Packs (curated index) ---------- */
// packs.json vive junto do Worker mas o Worker não pode ler ficheiros do repo diretamente;
// serve-se a partir da mesma Pages (raw) usando o commit atual.
const PACKS_URL = 'https://raw.githubusercontent.com/lucasfarianinja-sketch/EuPosto/master/editflix-site/packs.json';

async function handlePacks(url, env) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const type = (url.searchParams.get('type') || '').toLowerCase();

  const res = await fetch(PACKS_URL, { cf: { cacheTtl: 300 } });
  if (!res.ok) return json({ packs: [], error: 'packs.json unreachable' }, 502);
  const data = await res.json();

  let packs = data.packs || [];
  // esconde entradas de exemplo
  packs = packs.filter(p => !/^example/i.test(p.id || ''));

  if (q) {
    packs = packs.filter(p => {
      const hay = [p.title, p.series, p.character, ...(p.tags || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  if (type) packs = packs.filter(p => (p.type || '').toLowerCase() === type);

  return json({ count: packs.length, updated: data.updated, packs });
}

/* ---------- Content noise filter ---------- */
// Termos que indicam conteúdo derivado (não é a obra em si)
const NOISE_TERMS = [
  'react', 'reaction', 'reacts', 'reacting', 'reacted',
  'gameplay', 'game play', 'walkthrough', 'playthrough', 'lets play', "let's play",
  'parody', 'parodia', 'meme', 'crack', 'shitpost',
  'review', 'analysis', 'analise', 'breakdown', 'explained',
  'tier list', 'ranking', 'top 10', 'top10', 'top 5',
  'edit compilation', 'amv compilation', 'best of', 'moments compilation',
  'fan animation', 'fan made', 'fanmade',
  'tutorial', 'how to edit', 'como editar',
  'behind the scenes', 'making of', 'interview', 'entrevista',
  'unboxing', 'podcast',
];

function isNoise(title) {
  if (!title) return false;
  const t = String(title).toLowerCase();
  return NOISE_TERMS.some(term => t.includes(term));
}

/* ---------- Helpers ---------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      ...CORS,
    },
  });
}
function logErr(src, err) {
  console.error(`[${src}]`, err && err.message || err);
  return null;
}
