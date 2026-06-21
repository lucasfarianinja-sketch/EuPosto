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
var TT_CLIENT_SECRET = "gmwB8hJU7ZLY1lYEemcjyy8ZCrKH7pLW";
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
        case "r2-presign": res = await r2Presign(url); break;
        case "queue_jobs": res = await queueJobs(request, env); break;
        case "get_jobs":   res = await getJobs(url, env); break;
        case "cancel_job": res = await cancelJob(url, env); break;
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

async function ttInit(req) {
  const auth = req.headers.get("Authorization");
  const body = await req.text();
  const r = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json; charset=UTF-8" },
    body
  });
  return json(await r.json(), r.status);
}
__name(ttInit, "ttInit");

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

export { worker_default as default };
