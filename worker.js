var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var R2_ACCESS_KEY_ID = "1d7bffd22646e6362f1ebd3132dd1211";
var R2_SECRET_ACCESS_KEY = "9c7c9badcc888c1728e133a9d47b3e396d28b8776768d575c155a7566ae24251";
var R2_ACCOUNT_ID = "87131197c4e7282f6a8fc8a0d2067463";
var R2_BUCKET = "euposto-videos";
var R2_PUBLIC_URL = "https://pub-e2a2b46909004142bb4b2ed9b4a7db94.r2.dev";
var IG_APP_ID = "1736364031132996";
var IG_CLIENT_SECRET = "f46a15a30cacf3030ee9a324ff80ef68";
var TT_CLIENT_SECRET = "nG83QfTZxOCv1jWCMuuT4lMhthKVNdq9";
var JOBS_KEY = "euposto_jobs";

var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    try {
      let res;
      switch (action) {
        case "exchange":   res = await igExchange(request); break;
        case "longlived":  res = await igLongLived(url); break;
        case "ig_refresh": res = await igRefresh(url); break;
        case "me":         res = await igMe(url); break;
        case "ig_debug":   res = await igDebug(url); break;
        case "tt_token":   res = await ttToken(request); break;
        case "tt_user":    res = await ttUser(url); break;
        case "tt_init":    res = await ttInit(request); break;
        case "tt_status":  res = await ttStatus(request); break;
        case "r2-presign": res = await r2Presign(url); break;
        case "queue_jobs": res = await queueJobs(request, env); break;
        case "get_jobs":   res = await getJobs(url, env); break;
        case "cancel_job": res = await cancelJob(url, env); break;
        case "ai_chat":    res = await aiChat(request, env); break;
        case "ai_caption": res = await aiCaption(request, env); break;
        case "financas_chat": res = await financasChat(request, env); break;
        case "financas_vision": res = await financasVision(request, env); break;
        case "tt_creator_info": res = await ttCreatorInfo(request); break;
        default:           res = json({ error: "Unknown action" }, 400);
      }
      const out = new Response(res.body, res);
      Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processJobs(env));
  }
};

async function loadJobs(env) {
  const raw = await env.JOB_QUEUE.get(JOBS_KEY);
  return raw ? JSON.parse(raw) : [];
}
__name(loadJobs, "loadJobs");

async function saveJobs(env, jobs) {
  await env.JOB_QUEUE.put(JOBS_KEY, JSON.stringify(jobs));
}
__name(saveJobs, "saveJobs");

async function queueJobs(req, env) {
  const body = await req.json();
  const existing = await loadJobs(env);
  const newJobs = body.jobs.map((j) => ({ ...j, status: "pending", createdAt: Date.now() }));
  await saveJobs(env, [...existing, ...newJobs]);
  return json({ ok: true, queued: newJobs.length });
}
__name(queueJobs, "queueJobs");

async function getJobs(url, env) {
  const owner = url.searchParams.get("owner");
  const jobs = await loadJobs(env);
  const filtered = owner ? jobs.filter((j) => j.owner === owner) : jobs;
  return json({ jobs: filtered });
}
__name(getJobs, "getJobs");

async function cancelJob(url, env) {
  const id = url.searchParams.get("id");
  const jobs = await loadJobs(env);
  const updated = jobs.map((j) => j.id === id ? { ...j, status: "cancelled" } : j);
  await saveJobs(env, updated);
  return json({ ok: true });
}
__name(cancelJob, "cancelJob");

async function processJobs(env) {
  const jobs = await loadJobs(env);
  const now = Date.now();
  let changed = false;
  for (const job of jobs) {
    if (job.status !== "pending") continue;
    if (job.publishAt > now) continue;
    job.status = "running";
    changed = true;
    try {
      let result;
      if (job.platform === "yt") result = await postYouTube(job);
      else if (job.platform === "ig") result = await postInstagram(job);
      else if (job.platform === "fb") result = await postFacebook(job);
      else if (job.platform === "tt") result = await postTikTok(job);
      job.status = "done";
      job.result = result;
      job.doneAt = Date.now();
    } catch (e) {
      job.status = "error";
      job.error = e.message;
      job.doneAt = Date.now();
    }
  }
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const cleaned = jobs.filter(
    (j) => j.status === "pending" || j.status === "running" || (j.doneAt && j.doneAt > cutoff)
  );
  if (changed || cleaned.length !== jobs.length) {
    await saveJobs(env, cleaned);
  }
}
__name(processJobs, "processJobs");

async function postYouTube(job) {
  const { token, videoUrl, title, description, hashtags = [], videoType, videoSize } = job;
  const tags = hashtags.map((h) => h.replace("#", ""));
  if (videoType === "short" && !tags.includes("shorts")) tags.push("shorts");
  const tagsText = hashtags.filter((h) => h !== "#shorts").join(" ");
  let finalDesc = description || "";
  if (tagsText) finalDesc = finalDesc ? finalDesc + "\n\n" + tagsText : tagsText;
  if (videoType === "short" && !finalDesc.includes("#shorts"))
    finalDesc = finalDesc ? finalDesc + "\n\n#shorts" : "#shorts";
  const metadata = {
    snippet: { title: title || "Vídeo", description: finalDesc, tags, categoryId: "22" },
    status: { privacyStatus: "public" }
  };
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(videoSize || 0)
      },
      body: JSON.stringify(metadata)
    }
  );
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `YouTube init HTTP ${initRes.status}`);
  }
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("YouTube: URL de upload não retornada");
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Falha ao buscar vídeo do R2: HTTP ${videoRes.status}`);
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: videoRes.body,
    duplex: "half"
  });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `YouTube upload HTTP ${putRes.status}`);
  }
  const ytData = await putRes.json();
  return ytData?.id || null;
}
__name(postYouTube, "postYouTube");

async function postInstagram(job) {
  const { token, videoUrl, igUserId, description, hashtags = [] } = job;
  const caption = buildCaption(description, hashtags);
  const initRes = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption, access_token: token })
    }
  );
  const initData = await initRes.json();
  if (initData.error) throw new Error(initData.error.message);
  const containerId = initData.id;
  if (!containerId) throw new Error("Instagram: container ID não retornado");
  await waitForIgContainer(token, containerId);
  const pubRes = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: token })
    }
  );
  const pubData = await pubRes.json();
  if (pubData.error) throw new Error(pubData.error.message);
  return pubData?.id || null;
}
__name(postInstagram, "postInstagram");

async function waitForIgContainer(token, containerId, maxWait = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const r = await fetch(
      `https://graph.instagram.com/v21.0/${containerId}?fields=status_code,status&access_token=${token}`
    );
    const d = await r.json();
    if (d.status_code === "FINISHED") return;
    if (d.status_code === "ERROR") throw new Error("Instagram: processamento falhou");
    await sleep(8000);
  }
  throw new Error("Instagram: timeout aguardando processamento");
}
__name(waitForIgContainer, "waitForIgContainer");

async function postFacebook(job) {
  const { token, videoUrl, pageId, title, description, hashtags = [] } = job;
  const desc = buildCaption(description, hashtags);
  const params = new URLSearchParams({
    file_url: videoUrl,
    title: title || "",
    description: desc,
    access_token: token
  });
  const r = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, {
    method: "POST",
    body: params
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d?.id || null;
}
__name(postFacebook, "postFacebook");

async function postTikTok(job) {
  const { token, videoUrl, title, hashtags = [] } = job;
  const ttTagsText = hashtags.join(" ");
  const ttTitle = (title + (ttTagsText ? " " + ttTagsText : "")).slice(0, 150);
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: { title: ttTitle, privacy_level: "PUBLIC_TO_EVERYONE", disable_duet: false, disable_comment: false, disable_stitch: false },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl }
    })
  });
  const initData = await initRes.json();
  if (initData.error?.code && initData.error.code !== "ok") throw new Error(initData.error.message || "TikTok init error");
  return initData?.data?.publish_id || null;
}
__name(postTikTok, "postTikTok");

function buildCaption(description, hashtags = []) {
  const tags = hashtags.join(" ");
  if (!description && !tags) return "";
  if (!description) return tags;
  if (!tags) return description;
  return description + "\n\n" + tags;
}
__name(buildCaption, "buildCaption");

var sleep = __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");

async function igExchange(req) {
  const form = await req.formData();
  const r = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: form.get("client_id"),
      client_secret: IG_CLIENT_SECRET,
      grant_type: form.get("grant_type"),
      redirect_uri: form.get("redirect_uri"),
      code: form.get("code")
    })
  });
  return json(await r.json(), r.status);
}
__name(igExchange, "igExchange");

async function igLongLived(url) {
  const token = url.searchParams.get("token");
  // New Instagram Business Login API requires POST to versioned endpoint
  const r = await fetch(
    "https://graph.instagram.com/v22.0/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_CLIENT_SECRET,
        grant_type: "ig_exchange_token",
        access_token: token
      })
    }
  );
  return json(await r.json(), r.status);
}
__name(igLongLived, "igLongLived");

async function igRefresh(url) {
  const token = url.searchParams.get("token");
  // New Instagram Business Login API: refresh via POST
  const r = await fetch(
    "https://graph.instagram.com/v22.0/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: IG_APP_ID,
        client_secret: IG_CLIENT_SECRET,
        grant_type: "ig_refresh_token",
        access_token: token
      })
    }
  );
  return json(await r.json(), r.status);
}
__name(igRefresh, "igRefresh");

async function igMe(url) {
  const token = url.searchParams.get("token");
  const userId = url.searchParams.get("userId");
  // Try v21.0 with Bearer header (required by new Instagram Business API)
  const endpoint = userId
    ? `https://graph.instagram.com/v21.0/${userId}?fields=user_id,username,name`
    : `https://graph.instagram.com/v21.0/me?fields=user_id,username,name`;
  const r = await fetch(endpoint, { headers: { "Authorization": "Bearer " + token } });
  const data = await r.json();
  // Normalize user_id → id for compatibility
  if (data.user_id && !data.id) data.id = data.user_id;
  return json(data, r.status);
}
__name(igMe, "igMe");

async function igDebug(url) {
  const token = url.searchParams.get("token");
  const userId = url.searchParams.get("userId");
  const IG_CLIENT_SECRET_VAL = IG_CLIENT_SECRET;
  const results = {};

  const tryFetch = async (label, u, opts) => {
    try {
      const r = await fetch(u, opts);
      results[label] = await r.json();
    } catch(e) { results[label] = { fetchError: e.message }; }
  };

  await tryFetch("longlived_get_v22", `https://graph.instagram.com/v22.0/access_token?grant_type=ig_exchange_token&client_secret=${IG_CLIENT_SECRET_VAL}&access_token=${encodeURIComponent(token)}`, {});
  await tryFetch("longlived_post_api_ig", "https://api.instagram.com/oauth/access_token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: IG_APP_ID, client_secret: IG_CLIENT_SECRET_VAL, grant_type: "ig_exchange_token", access_token: token })
  });
  await tryFetch("me_bearer_v22", `https://graph.instagram.com/v22.0/me?fields=user_id,username,name`, { headers: { "Authorization": "Bearer " + token } });
  await tryFetch("me_param_v22", `https://graph.instagram.com/v22.0/me?fields=user_id,username,name&access_token=${encodeURIComponent(token)}`, {});
  if (userId) await tryFetch("userid_bearer_v22", `https://graph.instagram.com/v22.0/${userId}?fields=user_id,username,name`, { headers: { "Authorization": "Bearer " + token } });
  await tryFetch("me_bearer_no_version", `https://graph.instagram.com/me?fields=user_id,username,name`, { headers: { "Authorization": "Bearer " + token } });

  return json(results, 200);
}
__name(igDebug, "igDebug");

async function ttToken(req) {
  const body = await req.json();
  const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: body.client_key,
      client_secret: TT_CLIENT_SECRET,
      code: body.code,
      grant_type: body.grant_type,
      redirect_uri: body.redirect_uri
    })
  });
  return json(await r.json(), r.status);
}
__name(ttToken, "ttToken");

async function ttUser(url) {
  const token = url.searchParams.get("token");
  // Only request fields covered by user.info.basic scope (username needs user.info.profile)
  const r = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
    { headers: { "Authorization": "Bearer " + token } }
  );
  return json(await r.json(), r.status);
}
__name(ttUser, "ttUser");

async function ttCreatorInfo(req) {
  const auth = req.headers.get("Authorization");
  const r = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json; charset=UTF-8" }
  });
  return json(await r.json(), r.status);
}
__name(ttCreatorInfo, "ttCreatorInfo");

async function ttInit(req) {
  const auth = req.headers.get("Authorization");
  const url = new URL(req.url);
  const useInbox = url.searchParams.get("inbox") === "1";
  // Inbox endpoint = upload as DRAFT (works for unaudited apps + public accounts).
  // Direct publish endpoint requires audited app OR private account.
  const endpoint = useInbox
    ? "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
    : "https://open.tiktokapis.com/v2/post/publish/video/init/";
  const body = await req.text();
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json; charset=UTF-8" },
    body
  });
  return json(await r.json(), r.status);
}
__name(ttInit, "ttInit");

async function ttStatus(req) {
  const auth = req.headers.get("Authorization");
  const body = await req.text();
  const r = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json; charset=UTF-8" },
    body
  });
  return json(await r.json(), r.status);
}
__name(ttStatus, "ttStatus");

async function r2Presign(url) {
  const ext = (url.searchParams.get("ext") || "mp4").replace(/^\./, "");
  const ctype = url.searchParams.get("contentType") || "video/mp4";
  const filename = `euposto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const presignedUrl = await buildPresignedPut(filename, ctype);
  const publicUrl = `${R2_PUBLIC_URL}/${filename}`;
  return json({ presignedUrl, publicUrl });
}
__name(r2Presign, "r2Presign");

async function buildPresignedPut(filename, contentType, expiresIn = 3600) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region = "auto";
  const svc = "s3";
  const now = new Date();
  const amzdate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const datestamp = amzdate.slice(0, 8);
  const canonicalUri = `/${R2_BUCKET}/${encodeURIComponent(filename)}`;
  const credScope = `${datestamp}/${region}/${svc}/aws4_request`;
  const credential = `${R2_ACCESS_KEY_ID}/${credScope}`;
  const qs = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(credential)}`,
    `X-Amz-Date=${amzdate}`,
    `X-Amz-Expires=${expiresIn}`,
    `X-Amz-SignedHeaders=host`
  ].join("&");
  const canonicalReq = ["PUT", canonicalUri, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const hashedReq = await sha256hex(canonicalReq);
  const stringToSign = ["AWS4-HMAC-SHA256", amzdate, credScope, hashedReq].join("\n");
  const sigKey = await signingKey(R2_SECRET_ACCESS_KEY, datestamp, region, svc);
  const sig = hex(await hmac(sigKey, stringToSign));
  return `https://${host}${canonicalUri}?${qs}&X-Amz-Signature=${sig}`;
}
__name(buildPresignedPut, "buildPresignedPut");

async function hmac(key, msg) {
  const k = typeof key === "string" ? enc(key) : key;
  const ck = await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", ck, enc(msg));
}
__name(hmac, "hmac");

async function sha256hex(msg) {
  return hex(await crypto.subtle.digest("SHA-256", enc(msg)));
}
__name(sha256hex, "sha256hex");

async function signingKey(secret, date, region, service) {
  const kDate = await hmac("AWS4" + secret, date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
__name(signingKey, "signingKey");

var enc = __name((s) => new TextEncoder().encode(s), "enc");
var hex = __name((b) => [...new Uint8Array(b instanceof ArrayBuffer ? b : b)].map((x) => x.toString(16).padStart(2, "0")).join(""), "hex");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
__name(json, "json");

async function aiChat(request, env) {
  const body = await request.json();
  const messages = body.messages || [];
  const systemPrompt = `És o assistente IA do EuPosto, uma app que publica vídeos em YouTube, Instagram, TikTok e Facebook ao mesmo tempo. Ajudas criadores com: como usar a app, dicas de conteúdo viral, estratégias de hashtags, melhores horários para postar, edição de clipes, ideias para vídeos, otimização de SEO em redes sociais, análise de tendências. Responde sempre em português, de forma curta, prática e direta. Se a pergunta for sobre uma funcionalidade do EuPosto, explica brevemente onde encontrá-la (Início, Publicar, Contas, Histórico, Definições).`;
  if (!env.AI) {
    return json({ reply: "IA não configurada no Worker. Adiciona binding 'AI' nas configurações do Cloudflare Worker." });
  }
  try {
    const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 400
    });
    return json({ reply: out.response || out.result?.response || "Sem resposta." });
  } catch (e) {
    return json({ error: e.message, reply: "Erro a contactar IA: " + e.message }, 500);
  }
}
__name(aiChat, "aiChat");

async function aiCaption(request, env) {
  const body = await request.json();
  const description = body.description || "";
  const platforms = body.platforms || [];
  const language = body.language || "pt";
  const systemPrompt = `És um copywriter de redes sociais. Geras legendas CURTAS (máximo 2 frases + 3-5 hashtags relevantes), em ${language === "pt" ? "português" : language === "pt-BR" ? "português do Brasil" : "inglês"}, otimizadas para engagement. Sem clichés, sem floreios, sem emojis em excesso (máximo 1-2). Foca no que o vídeo mostra/diz. Responde APENAS com a legenda, sem prefixos tipo "Aqui está:" ou comentários extra.`;
  const userPrompt = `Vídeo sobre: "${description}"
Plataformas: ${platforms.join(", ") || "geral"}
Gera uma legenda curta e cativante.`;
  if (!env.AI) {
    return json({ caption: "IA não configurada. Adiciona binding 'AI' no Worker." });
  }
  try {
    const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 200
    });
    return json({ caption: (out.response || out.result?.response || "").trim() });
  } catch (e) {
    return json({ error: e.message, caption: "Erro: " + e.message }, 500);
  }
}
__name(aiCaption, "aiCaption");

async function financasChat(request, env) {
  const body = await request.json();
  const userText = String(body.text || "").slice(0, 800);
  const context = String(body.context || "").slice(0, 500);
  const today = String(body.today || new Date().toISOString().slice(0, 10));
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  const d = new Date(today);
  const dayNames = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
  const weekday = dayNames[d.getDay()];

  const systemPrompt = `És o "FINANCEIRO", um assistente pessoal de finanças que fala em português (europeu e brasileiro) como uma conversa de WhatsApp. Ajudas o utilizador a registar gastos e ganhos e responder perguntas sobre o mês.

# DATA E CONTEXTO
- Hoje é ${weekday}, ${today}.
- Mês actual: ${context}.
- "ontem" = ${new Date(d.getTime() - 86400000).toISOString().slice(0,10)}
- "anteontem" = ${new Date(d.getTime() - 2*86400000).toISOString().slice(0,10)}

# CATEGORIAS (usa EXACTAMENTE estes ids, sem acentos)
Entradas (type "in"):
- salario (ordenado, salário, pagamento mensal do trabalho)
- freelance (freela, projecto, trabalho pontual, gig)
- investimento (dividendos, juros, venda de ações, cripto, rendimentos)
- reembolso (devolução, cashback, reembolso de imposto)
- prenda (presente, prémio, oferta, dinheiro dado)
- outros (qualquer entrada que não encaixe)

Saídas (type "out"):
- alimentacao (almoço, jantar, café, restaurante, snack, take-away, uber eats, glovo)
- mercearia (supermercado: Continente, Pingo Doce, Lidl, Mercadona, Auchan, Minipreço, Aldi)
- transportes (metro, autocarro, comboio, uber, bolt, gasolina, passe, via verde, taxi, parking)
- habitacao (renda, hipoteca, luz, água, gás, internet, IPTV, condomínio)
- saude (farmácia, médico, dentista, análises, seguro saúde, óculos)
- lazer (cinema, concerto, bar, jogos, steam, playstation, xbox, bilhetes, ginásio)
- compras (roupa, sapatos, electrónica, amazon, worten, fnac, ikea, decathlon)
- subscricoes (netflix, spotify, youtube, hbo, disney+, prime, icloud, chatgpt, apple, google one)
- educacao (livros, cursos, universidade, propinas, formação)
- viagens (hotel, voo, airbnb, booking, ryanair, tap, aluguer de carro)
- outros (qualquer saída que não encaixe)

# INTENT (escolhe UM)
- "add" — utilizador declara UM movimento NOVO. Pode ter VÁRIOS numa só frase ("gastei 12 no almoço e 30 no super") — extrai todos.
- "summary" — pede totais ("resumo", "quanto gastei", "saldo", "balanço", "quanto ganhei"). Se pediu mês específico, inclui "month":"YYYY-MM".
- "list" — pede histórico ("mostra os últimos", "movimentos", "histórico").
- "delete_last" — quer apagar ("apaga o último", "cancela", "não era isso", "erro", "naaoo", "isso está errado", "eu só ganhei X uma vez", correcções ao teu último registo).
- "help" — pergunta como funciona.
- "clarify" — falta info crítica OU o utilizador está apenas a informar-te de contexto sem pedir nada ("Tenho 500€ na conta", "esse mês entrou 800", frases descritivas do estado actual). NUNCA registes movimentos a partir de frases descritivas do saldo.

# QUANDO NÃO REGISTAR (importante!)
- Frases sobre o SALDO ATUAL ("tenho X na conta", "estou com Y de saldo") NÃO são movimentos — responde clarify.
- Frases sobre TOTAIS já feitos ("esse mês entrou X", "já gastei Y") NÃO são movimentos NOVOS — se o total bate com o contexto, responde clarify ou summary; nunca add.
- Se o utilizador está a corrigir-te ("nao era isso", "só uma vez", "isso está errado"), usa "delete_last", nunca "add".
- Se acabaste de registar X e o utilizador diz "não" ou "errado", é delete_last.

# FORMATO OBRIGATÓRIO (JSON puro, sem markdown, sem texto antes/depois)
{
  "intent": "add" | "summary" | "list" | "delete_last" | "help" | "clarify",
  "entries": [{ "type":"in"|"out", "amount":number, "desc":"string curta", "cat":"id_categoria", "date":"YYYY-MM-DD" }],
  "month": "YYYY-MM" (opcional, só em summary de outro mês),
  "reply": "resposta curta em pt, tom WhatsApp, 1 emoji no máximo"
}

# INTERPRETAÇÃO DE VALORES
- "15", "15€", "15 euros", "15 eur", "€15", "quinze euros" → 15
- "1,50", "1.50", "1 e 50" → 1.5
- "1.500", "1500", "mil e quinhentos", "1,5k" → 1500
- "2 e meio" → 2.5
- Se der número inteiro sem contexto, é euros inteiros.

# INTERPRETAÇÃO DE DATAS
- Sem data → hoje (${today})
- "ontem" → ${new Date(d.getTime() - 86400000).toISOString().slice(0,10)}
- "no dia X" → substitui X no mês actual
- "segunda passada" / "há 3 dias" → calcula relativo a ${today}

# EXEMPLOS

Utilizador: "gastei 12 no almoço"
{"intent":"add","entries":[{"type":"out","amount":12,"desc":"Almoço","cat":"alimentacao","date":"${today}"}],"reply":"Registado ✅"}

Utilizador: "netflix 12,90"
{"intent":"add","entries":[{"type":"out","amount":12.9,"desc":"Netflix","cat":"subscricoes","date":"${today}"}],"reply":"Registado ✅"}

Utilizador: "recebi 1450 do salário"
{"intent":"add","entries":[{"type":"in","amount":1450,"desc":"Salário","cat":"salario","date":"${today}"}],"reply":"Boa 💼 Salário registado."}

Utilizador: "gastei 8€ no café e 45 no super do lidl"
{"intent":"add","entries":[{"type":"out","amount":8,"desc":"Café","cat":"alimentacao","date":"${today}"},{"type":"out","amount":45,"desc":"Lidl","cat":"mercearia","date":"${today}"}],"reply":"Duas registadas ✅"}

Utilizador: "paguei 620 de renda ontem"
{"intent":"add","entries":[{"type":"out","amount":620,"desc":"Renda","cat":"habitacao","date":"${new Date(d.getTime() - 86400000).toISOString().slice(0,10)}"}],"reply":"Registado ✅"}

Utilizador: "quanto gastei este mês?"
{"intent":"summary","entries":[],"reply":""}

Utilizador: "resumo de agosto"
{"intent":"summary","month":"${d.getFullYear()}-08","entries":[],"reply":""}

Utilizador: "apaga o último"
{"intent":"delete_last","entries":[],"reply":""}

Utilizador: "olá"
{"intent":"help","entries":[],"reply":"Olá! 👋 Escreve os teus gastos e ganhos como se falasses com um amigo (ex: 'gastei 12€ no almoço')."}

Utilizador: "gastei"
{"intent":"clarify","entries":[],"reply":"Quanto foi e no quê?"}

Utilizador: "Tenho 500€ na conta"
{"intent":"clarify","entries":[],"reply":"Boa 👍 Isso é o teu saldo atual? Se quiseres registar entradas ou gastos, diz-me."}

Utilizador: "esse mês entrou 806€"
{"intent":"clarify","entries":[],"reply":"Isso é um resumo do que já entrou, ou queres registar uma entrada de 806€? Se já registámos, pede-me 'resumo'."}

Utilizador: "naooo, eu só ganhei 806 uma vez"
{"intent":"delete_last","entries":[],"reply":"Certo, apago o último ✅"}

Utilizador: "não era isso"
{"intent":"delete_last","entries":[],"reply":"Apagado ✅"}

# REGRAS FINAIS
- Descrição SEMPRE curta (1-3 palavras), começada com maiúscula ("Almoço", "Netflix", "Uber").
- Não inventes movimentos que o utilizador não referiu.
- Não incluas o JSON dentro do "reply" — o "reply" é o que aparece no chat.
- Se a categoria não for óbvia, usa "outros".
- Responde SEMPRE JSON válido, mesmo que a mensagem seja estranha.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map(h => ({ role: h.role === "user" ? "user" : "assistant", content: String(h.content || "").slice(0, 400) })),
    { role: "user", content: userText }
  ];

  // Preference: Gemini (free) > Claude Haiku (paid) > Llama (Workers AI free).
  if (env.GEMINI_API_KEY) {
    try {
      const parsed = await geminiJSON(env.GEMINI_API_KEY, systemPrompt, messages.slice(1));
      return json(parsed);
    } catch (e) { /* fall through */ }
  }
  if (env.ANTHROPIC_API_KEY) {
    try {
      const parsed = await claudeJSON(env.ANTHROPIC_API_KEY, systemPrompt, messages.slice(1));
      return json(parsed);
    } catch (e) { /* fall through */ }
  }

  if (!env.AI) {
    return json({ intent: "clarify", reply: "IA não configurada." });
  }

  try {
    const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages,
      max_tokens: 600,
      temperature: 0.15,
      response_format: { type: "json_object" }
    });
    const raw = out.response ?? out.result?.response ?? out;
    let parsed;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      parsed = raw;
    } else if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); }
      catch {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : { intent: "clarify", reply: "Não percebi. Tenta escrever assim: 'gastei 12€ no almoço'." };
      }
    } else {
      parsed = { intent: "clarify", reply: "Resposta inesperada da IA." };
    }
    return json(parsed);
  } catch (e) {
    return json({ intent: "clarify", reply: "Falha na IA: " + e.message }, 500);
  }
}
__name(financasChat, "financasChat");

async function claudeJSON(apiKey, systemPrompt, userAssistantTurns) {
  const messages = userAssistantTurns.map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content
  }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      system: systemPrompt + "\n\nRESPONDE APENAS COM JSON VÁLIDO. NADA MAIS.",
      messages
    })
  });
  if (!res.ok) throw new Error("Claude HTTP " + res.status);
  const data = await res.json();
  const text = data?.content?.[0]?.text || "";
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Claude replied non-JSON");
  }
}
__name(claudeJSON, "claudeJSON");

async function claudeVisionJSON(apiKey, prompt, imageBase64) {
  const b64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: prompt + "\n\nRESPONDE APENAS COM JSON. Nenhum texto antes ou depois." }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error("Claude Vision HTTP " + res.status);
  const data = await res.json();
  const text = data?.content?.[0]?.text || "";
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Claude Vision replied non-JSON");
  }
}
__name(claudeVisionJSON, "claudeVisionJSON");

async function geminiJSON(apiKey, systemPrompt, userAssistantTurns) {
  const contents = userAssistantTurns.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }]
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
          maxOutputTokens: 800
        }
      })
    }
  );
  if (!res.ok) throw new Error("Gemini HTTP " + res.status);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemini replied non-JSON");
  }
}
__name(geminiJSON, "geminiJSON");

async function geminiVisionJSON(apiKey, prompt, imageBase64) {
  const b64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: b64 } },
            { text: prompt }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          maxOutputTokens: 1500
        }
      })
    }
  );
  if (!res.ok) throw new Error("Gemini Vision HTTP " + res.status);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemini Vision replied non-JSON");
  }
}
__name(geminiVisionJSON, "geminiVisionJSON");

async function financasVision(request, env) {
  const body = await request.json();
  const image = String(body.image || "");
  const today = String(body.today || new Date().toISOString().slice(0, 10));
  const context = String(body.context || "");
  const note   = String(body.text  || "").slice(0, 300);

  const prompt = `És um extractor de movimentos financeiros de imagens. A imagem que recebes é UMA de: extracto bancário, notificação/histórico de app (MB WAY, Revolut, N26, banco), recibo de compra, factura, print de pagamento.

TAREFA: identificar CADA transacção visível e devolver em JSON. Ignora headers, totais e linhas de saldo — só transacções individuais.

# CATEGORIAS (usa exactamente estes ids)
Entradas (type "in"):
- salario | freelance | investimento | reembolso | prenda | outros

Saídas (type "out"):
- alimentacao (restaurantes, cafés, ubereats, glovo)
- mercearia (Continente, Pingo Doce, Lidl, Mercadona, Auchan, Aldi, Minipreço)
- transportes (uber, bolt, gasolina, metro, comboio, via verde, taxi, parking)
- habitacao (renda, luz EDP/Endesa, água, gás, MEO/NOS/Vodafone internet)
- saude (farmácia, médico, dentista, seguros de saúde)
- lazer (cinema, bar, jogos, ginásio, steam, netflix se for descrito assim)
- compras (Amazon, Worten, Fnac, Ikea, Zara, H&M, Decathlon, roupa)
- subscricoes (Netflix, Spotify, HBO, Disney+, iCloud, Prime, ChatGPT, YouTube)
- educacao (livros, cursos, universidade)
- viagens (hotel, voo, TAP, Ryanair, Airbnb, Booking)
- outros

# REGRAS
- Sinal do valor NÃO vai no amount (amount é sempre POSITIVO). Se a transacção é gasto/débito → type "out". Se é entrada/crédito → type "in".
- Descrição CURTA (1-3 palavras), começada com maiúscula (ex: "Continente", "Netflix", "Uber", "Salário").
- Data em YYYY-MM-DD. Se a imagem mostra dia/mês sem ano, assume ${d.getFullYear()}. Se não há data, usa ${today}.
- Extrai TODAS as linhas visíveis, não só as maiores.
- Se a imagem não é de transacções (é uma paisagem, meme, etc), responde clarify.

# FORMATO
Responde APENAS um objecto JSON válido, nada mais:
{
  "intent": "add",
  "entries": [
    {"type":"out","amount":45.30,"desc":"Continente","cat":"mercearia","date":"2026-09-05"},
    {"type":"out","amount":12.90,"desc":"Netflix","cat":"subscricoes","date":"2026-09-03"}
  ],
  "reply": "Registei 2 movimentos do print ✅"
}

Se não conseguires ler:
{"intent":"clarify","entries":[],"reply":"Não consegui ler o print. Podes tirar mais nítido ou aproximar?"}

Data de hoje: ${today}.
${note ? `Nota do utilizador: "${note}"` : ""}`;

  // Preference: Gemini (free) > Claude (paid) > Llama Vision (free).
  if (env.GEMINI_API_KEY) {
    try {
      const parsed = await geminiVisionJSON(env.GEMINI_API_KEY, prompt, image);
      return json(parsed);
    } catch (e) { /* fall through */ }
  }
  if (env.ANTHROPIC_API_KEY) {
    try {
      const parsed = await claudeVisionJSON(env.ANTHROPIC_API_KEY, prompt, image);
      return json(parsed);
    } catch (e) { /* fall through */ }
  }

  if (!env.AI) return json({ intent: "clarify", reply: "IA não configurada." });

  try {
    const b64 = image.replace(/^data:image\/[a-z]+;base64,/, "");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const out = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      prompt,
      image: [...bytes],
      max_tokens: 900
    });
    const raw = out.response ?? out.result?.response ?? out;
    let parsed;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      parsed = raw;
    } else if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); }
      catch {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : { intent: "clarify", reply: "Não consegui interpretar a imagem." };
      }
    } else {
      parsed = { intent: "clarify", reply: "Resposta inesperada da IA." };
    }
    return json(parsed);
  } catch (e) {
    return json({ intent: "clarify", reply: "Erro a analisar imagem: " + e.message }, 500);
  }
}
__name(financasVision, "financasVision");

export { worker_default as default };
