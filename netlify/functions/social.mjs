// travelwithmori social sync. Generated from readable source; do not edit by hand.
// ../moripradhyumansinh/travelwithmori/netlify/lib/store.mjs
import { getStore } from "@netlify/blobs";
var store = () => getStore({ name: "social-sync", consistency: "strong" });
var DEFAULT_SETTINGS = {
  autoSync: true,
  frequencyHours: 1,
  // 1, 3, 6, 12 or 24
  instagramEnabled: true,
  youtubeEnabled: true,
  youtubeChannel: ""
  // @handle, channel URL or channel ID (UC...)
};
async function readJSON(key, fallback = null) {
  const v = await store().get(key, { type: "json" });
  return v ?? fallback;
}
async function writeJSON(key, value) {
  await store().setJSON(key, value);
  return value;
}
async function removeKey(key) {
  await store().delete(key);
}
async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...await readJSON("settings", {}) };
}
async function saveSettings(patch) {
  const next = { ...await getSettings(), ...patch };
  return writeJSON("settings", next);
}
async function getHidden() {
  return readJSON("hidden", {});
}
async function setHidden(id, hidden) {
  const h = await getHidden();
  if (hidden) h[id] = true;
  else delete h[id];
  return writeJSON("hidden", h);
}
async function getSource(name) {
  return readJSON(`feed-${name}`, { items: [], status: "never", error: null, lastSync: null, lastAttempt: null });
}
async function saveSource(name, data) {
  return writeJSON(`feed-${name}`, data);
}
var getIgToken = () => readJSON("ig-token", null);
var saveIgToken = (t) => writeJSON("ig-token", t);
var clearIgToken = () => removeKey("ig-token");
async function withLock(fn) {
  const lock = await readJSON("sync-lock", null);
  if (lock && Date.now() - lock.at < 9e4) {
    throw new Error("A sync is already running. Try again in a minute.");
  }
  await writeJSON("sync-lock", { at: Date.now() });
  try {
    return await fn();
  } finally {
    await removeKey("sync-lock");
  }
}

// ../moripradhyumansinh/travelwithmori/netlify/functions/social-feed.mjs
var social_feed_default = async () => {
  const [ig2, yt2, hidden, s] = await Promise.all([getSource("instagram"), getSource("youtube"), getHidden(), getSettings()]);
  const visible = (src, on) => on ? (src.items || []).filter((i) => !hidden[i.id]) : [];
  const pick = ({ id, source, type, url, embed, thumb, video, caption, title, videoId, duration, views, publishedAt }) => ({ id, source, type, url, embed, thumb, video, caption, title, videoId, duration, views, publishedAt });
  const body = {
    instagram: { items: visible(ig2, s.instagramEnabled).map(pick), profile: ig2.profile || null, lastSync: ig2.lastSync },
    youtube: { items: visible(yt2, s.youtubeEnabled).map(pick), profile: yt2.profile || null, lastSync: yt2.lastSync }
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      // Browsers keep it 1 minute; Netlify's CDN serves it fast and refreshes in the background.
      "cache-control": "public, max-age=60",
      "netlify-cdn-cache-control": "public, durable, s-maxage=120, stale-while-revalidate=600"
    }
  });
};

// ../moripradhyumansinh/travelwithmori/netlify/lib/auth.mjs
import crypto from "node:crypto";
var REPO = () => process.env.ADMIN_GITHUB_REPO || "moripradhyumansinh/travelwithmori";
var cache = /* @__PURE__ */ new Map();
async function requireAdmin(req) {
  const h = req.headers.get("authorization") || "";
  const token = h.replace(/^(Bearer|token)\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Please log in to the admin first.");
  const key = crypto.createHash("sha256").update(token).digest("hex");
  if ((cache.get(key) || 0) > Date.now()) return true;
  const r = await fetch(`https://api.github.com/repos/${REPO()}`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "travelwithmori-admin", accept: "application/vnd.github+json" }
  });
  if (!r.ok) throw new HttpError(401, "Your admin login has expired. Log in to /admin again.");
  const repo = await r.json();
  if (!repo.permissions?.push) throw new HttpError(403, "This GitHub account is not allowed to manage the site.");
  cache.set(key, Date.now() + 5 * 6e4);
  return true;
}
var HttpError = class extends Error {
  constructor(status2, message) {
    super(message);
    this.status = status2;
  }
};
var secret = () => process.env.IG_APP_SECRET || process.env.OAUTH_STATE_SECRET || "";
function signState() {
  const body = Buffer.from(JSON.stringify({ t: Date.now(), n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function checkState(state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig || !secret()) return false;
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return false;
  const { t } = JSON.parse(Buffer.from(body, "base64url").toString());
  return Date.now() - t < 15 * 6e4;
}
var json = (data, status2 = 200, headers = {}) => new Response(JSON.stringify(data), { status: status2, headers: { "content-type": "application/json", ...headers } });

// ../moripradhyumansinh/travelwithmori/netlify/lib/instagram.mjs
var GRAPH = "https://graph.instagram.com";
var DAY = 864e5;
var TokenError = class extends Error {
};
async function ig(path, params = {}) {
  const url = new URL(path.startsWith("http") ? path : GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(6e3) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    const msg = e.message || `Instagram returned ${res.status}`;
    if (e.code === 190 || e.code === 10 || e.code === 200 || res.status === 401) throw new TokenError(msg);
    if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || res.status === 429)
      throw new Error("Instagram rate limit reached. The next sync will try again.");
    throw new Error(msg);
  }
  return data;
}
function authorizeUrl(redirectUri2, state) {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("force_authentication", "1");
  u.searchParams.set("client_id", process.env.IG_APP_ID || "");
  u.searchParams.set("redirect_uri", redirectUri2);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_insights");
  u.searchParams.set("state", state);
  return u.toString();
}
async function exchangeCode(code, redirectUri2) {
  const body = new URLSearchParams({
    client_id: process.env.IG_APP_ID || "",
    client_secret: process.env.IG_APP_SECRET || "",
    grant_type: "authorization_code",
    redirect_uri: redirectUri2,
    code
  });
  const res = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const raw = await res.json().catch(() => ({}));
  const data = Array.isArray(raw.data) ? raw.data[0] : raw;
  if (!res.ok || !data?.access_token) {
    throw new Error(raw.error_message || raw.error?.message || "Instagram did not return a token.");
  }
  const long = await ig("/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: process.env.IG_APP_SECRET || "",
    access_token: data.access_token
  });
  return storeToken(long.access_token, long.expires_in);
}
async function storeToken(token, expiresIn) {
  token = String(token || "").trim();
  if (!token) throw new Error("The token is empty.");
  const me = await ig("/me", { fields: "user_id,username", access_token: token });
  const t = {
    token,
    userId: me.user_id || me.id,
    username: me.username,
    refreshedAt: Date.now(),
    expiresAt: Date.now() + (Number(expiresIn) || 60 * 86400) * 1e3
  };
  await saveIgToken(t);
  return t;
}
async function refreshIfNeeded(t) {
  if (!t) return t;
  const age = Date.now() - (t.refreshedAt || 0);
  const left = (t.expiresAt || 0) - Date.now();
  if (age < DAY || left > 50 * DAY) return t;
  try {
    const r = await ig("/refresh_access_token", { grant_type: "ig_refresh_token", access_token: t.token });
    const next = { ...t, token: r.access_token, refreshedAt: Date.now(), expiresAt: Date.now() + r.expires_in * 1e3 };
    await saveIgToken(next);
    return next;
  } catch (e) {
    if (left <= 0) throw new TokenError("Your Instagram connection has expired. Click Connect Instagram again.");
    return t;
  }
}
var FIELDS = "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp";
var MAX_PAGES = 12;
async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}
async function fetchReels(previous = [], deadline = Date.now() + 8e3) {
  let t = await getIgToken();
  if (!t) throw new TokenError("Instagram is not connected yet.");
  t = await refreshIfNeeded(t);
  const raw = [];
  let complete = false;
  let page = await ig("/me/media", { fields: FIELDS, limit: "50", access_token: t.token });
  for (let p = 0; p < MAX_PAGES; p++) {
    raw.push(...page.data || []);
    const next = page.paging?.next;
    if (!next) {
      complete = true;
      break;
    }
    if (Date.now() > deadline - 2500) break;
    page = await ig(next);
  }
  const prev = new Map(previous.map((r) => [r.id, r]));
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  for (const m of raw) {
    const isReel = m.media_product_type === "REELS" || m.media_type === "VIDEO" && /\/reel\//.test(m.permalink || "");
    const id = `ig:${m.id}`;
    if (!isReel || seen.has(id)) continue;
    seen.add(id);
    const old = prev.get(id);
    items.push({
      id,
      mediaId: m.id,
      source: "instagram",
      type: "reel",
      url: m.permalink,
      embed: m.permalink ? m.permalink.split("?")[0].replace(/\/?$/, "/embed") : null,
      thumb: m.thumbnail_url || old?.thumb || null,
      video: m.media_url || null,
      // the reel's video file, so it can play right on the website
      caption: (m.caption || "").slice(0, 400),
      views: old?.views ?? null,
      viewsAt: old?.viewsAt || 0,
      publishedAt: m.timestamp
    });
  }
  if (!complete) {
    for (const r of previous) if (!seen.has(r.id)) {
      seen.add(r.id);
      items.push(r);
    }
  }
  const queue = [...items].sort((a, b) => (a.viewsAt || 0) - (b.viewsAt || 0));
  let tokenProblem = null;
  await mapLimit(queue, 6, async (r) => {
    if (tokenProblem || Date.now() > deadline - 800) return;
    try {
      const ins = await ig(`/${r.mediaId || r.id.slice(3)}/insights`, { metric: "views", access_token: t.token });
      const v = ins.data?.find((d) => d.name === "views");
      const val = v?.values?.[0]?.value ?? v?.total_value?.value;
      if (Number.isFinite(val)) r.views = val;
      r.viewsAt = Date.now();
    } catch (e) {
      if (e instanceof TokenError && /expired|session/i.test(e.message)) tokenProblem = e;
      r.viewsAt = Date.now();
    }
  });
  if (tokenProblem) throw tokenProblem;
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { items, profile: { username: t.username, url: t.username ? `https://www.instagram.com/${t.username}/` : null } };
}

// ../moripradhyumansinh/travelwithmori/netlify/lib/youtube.mjs
var API = "https://www.googleapis.com/youtube/v3";
var MAX_PAGES2 = 6;
async function yt(path, params) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set in Netlify environment variables.");
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(6e3) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error?.errors?.[0]?.reason || "";
    if (reason === "quotaExceeded" || reason === "rateLimitExceeded")
      throw new Error("YouTube daily quota reached. Sync will resume automatically later.");
    if (reason === "keyInvalid" || res.status === 400 && /API key/i.test(data.error?.message || ""))
      throw new Error("The YouTube API key is not valid. Check YOUTUBE_API_KEY in Netlify.");
    throw new Error(data.error?.message || `YouTube returned ${res.status}`);
  }
  return data;
}
function parseChannel(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  const m = s.match(/youtube\.com\/(channel\/(UC[\w-]{20,})|@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i);
  if (m) {
    if (m[2]) return { id: m[2] };
    if (m[3]) return { handle: "@" + m[3] };
    if (m[5]) return { username: m[5] };
    return { handle: "@" + m[4] };
  }
  if (/^UC[\w-]{20,}$/.test(s)) return { id: s };
  return { handle: s.startsWith("@") ? s : "@" + s };
}
async function getChannel(input) {
  const c = parseChannel(input);
  if (!c) throw new Error("Add your YouTube channel in the dashboard first.");
  const params = { part: "snippet,contentDetails,statistics" };
  if (c.id) params.id = c.id;
  else if (c.username) params.forUsername = c.username;
  else params.forHandle = c.handle;
  const data = await yt("/channels", params);
  const ch = data.items?.[0];
  if (!ch) throw new Error(`No YouTube channel found for "${input}".`);
  return {
    id: ch.id,
    title: ch.snippet.title,
    handle: ch.snippet.customUrl || null,
    url: ch.snippet.customUrl ? `https://www.youtube.com/${ch.snippet.customUrl}` : `https://www.youtube.com/channel/${ch.id}`,
    uploads: ch.contentDetails.relatedPlaylists.uploads
  };
}
function isoToSeconds(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
async function checkShort(id, seconds) {
  if (seconds > 180) return false;
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${id}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(3e3)
    });
    if (r.status === 200) return true;
    if (r.status >= 300 && r.status < 400) return false;
  } catch {
  }
  return seconds <= 60;
}
async function mapLimit2(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      await fn(items[n]);
    }
  }));
}
async function videoDetails(ids, previous, deadline) {
  const prevType = new Map(previous.filter((v) => v.checked !== false).map((v) => [v.id, v.type]));
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await yt("/videos", { part: "snippet,contentDetails,statistics,status", id: chunk.join(","), maxResults: "50" });
    for (const v of data.items || []) {
      if (v.status?.privacyStatus !== "public" && v.status?.privacyStatus !== "unlisted") continue;
      if (v.snippet?.liveBroadcastContent === "upcoming" || v.snippet?.liveBroadcastContent === "live") continue;
      const th = v.snippet.thumbnails || {};
      const views = v.statistics?.viewCount;
      out.push({
        id: `yt:${v.id}`,
        videoId: v.id,
        source: "youtube",
        type: prevType.get(`yt:${v.id}`) || null,
        // filled in below for new videos
        title: v.snippet.title,
        thumb: (th.maxres || th.standard || th.high || th.medium || th.default || {}).url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        duration: isoToSeconds(v.contentDetails?.duration),
        views: views === void 0 ? null : Number(views),
        // hidden by the channel = no number
        publishedAt: v.snippet.publishedAt
      });
    }
  }
  await mapLimit2(out.filter((v) => !v.type), 8, async (v) => {
    if (v.duration > 180) {
      v.type = "video";
      return;
    }
    if (Date.now() > deadline - 700) {
      v.type = v.duration <= 60 ? "short" : "video";
      v.checked = false;
      return;
    }
    v.type = await checkShort(v.videoId, v.duration) ? "short" : "video";
  });
  for (const v of out) {
    v.url = v.type === "short" ? `https://www.youtube.com/shorts/${v.videoId}` : `https://www.youtube.com/watch?v=${v.videoId}`;
  }
  return out;
}
async function fetchYouTube(channelInput, previous = [], extraUrls = [], deadline = Date.now() + 8e3) {
  const ch = await getChannel(channelInput);
  const ids = [];
  let pageToken = "";
  let complete = false;
  for (let p = 0; p < MAX_PAGES2; p++) {
    const data = await yt("/playlistItems", { part: "contentDetails", playlistId: ch.uploads, maxResults: "50", ...pageToken && { pageToken } });
    for (const it of data.items || []) ids.push(it.contentDetails.videoId);
    pageToken = data.nextPageToken;
    if (!pageToken) {
      complete = true;
      break;
    }
    if (Date.now() > deadline - 3e3) break;
  }
  for (const u of extraUrls) {
    const id = videoIdFromUrl(u);
    if (id) ids.push(id);
  }
  const unique = [...new Set(ids)];
  const items = await videoDetails(unique, previous, deadline);
  if (!complete) {
    const have = new Set(items.map((v) => v.id));
    for (const v of previous) if (!have.has(v.id)) items.push(v);
  }
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { items, profile: { title: ch.title, url: ch.url, handle: ch.handle } };
}
function videoIdFromUrl(u) {
  const s = String(u || "");
  const m = s.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(s) ? s : null;
}

// ../moripradhyumansinh/travelwithmori/netlify/lib/sync.mjs
async function extraVideos() {
  try {
    const base = process.env.URL || "";
    const r = await fetch(`${base}/data/socials.json`, { signal: AbortSignal.timeout(5e3) });
    const d = await r.json();
    return (d.extra_videos || []).map((x) => typeof x === "string" ? x : x.url).filter(Boolean);
  } catch {
    return [];
  }
}
async function runOne(name, enabled, fetcher) {
  const prev = await getSource(name);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (!enabled) {
    return saveSource(name, { ...prev, status: "off", error: null, lastAttempt: now });
  }
  try {
    const { items, profile } = await fetcher(prev.items || []);
    return saveSource(name, { items, profile, status: "ok", error: null, lastSync: now, lastAttempt: now });
  } catch (e) {
    return saveSource(name, {
      ...prev,
      status: e instanceof TokenError ? "disconnected" : "error",
      error: e.message || String(e),
      lastAttempt: now
    });
  }
}
async function runSync({ only, budgetMs = 7e3 } = {}) {
  return withLock(async () => {
    const s = await getSettings();
    const deadline = Date.now() + budgetMs;
    const jobs = {};
    if (!only || only === "instagram") {
      jobs.instagram = runOne("instagram", s.instagramEnabled, (prev) => fetchReels(prev, deadline));
    }
    if (!only || only === "youtube") {
      jobs.youtube = runOne(
        "youtube",
        s.youtubeEnabled && !!s.youtubeChannel,
        async (prev) => fetchYouTube(s.youtubeChannel, prev, await extraVideos(), deadline)
      );
    }
    const results = {};
    for (const [k, p] of Object.entries(jobs)) results[k] = await p;
    await writeJSON("last-run", { at: (/* @__PURE__ */ new Date()).toISOString() });
    return results;
  });
}

// ../moripradhyumansinh/travelwithmori/netlify/functions/social-admin.mjs
var FREQS = [1, 3, 6, 12, 24];
var redirectUri = () => `${process.env.URL}/api/instagram-callback`;
async function status() {
  const [settings, ig2, yt2, hidden, tok, lastRun] = await Promise.all([
    getSettings(),
    getSource("instagram"),
    getSource("youtube"),
    getHidden(),
    getIgToken(),
    readJSON("last-run")
  ]);
  const mark = (items) => (items || []).map((i) => ({ ...i, hidden: !!hidden[i.id] }));
  return {
    settings,
    lastRun: lastRun?.at || null,
    env: {
      youtubeKey: !!process.env.YOUTUBE_API_KEY,
      igApp: !!(process.env.IG_APP_ID && process.env.IG_APP_SECRET),
      redirectUri: redirectUri()
    },
    instagram: {
      connected: !!tok,
      username: tok?.username || null,
      expiresAt: tok?.expiresAt || null,
      status: ig2.status,
      error: ig2.error,
      lastSync: ig2.lastSync,
      lastAttempt: ig2.lastAttempt,
      items: mark(ig2.items)
    },
    youtube: {
      channel: yt2.profile || null,
      status: yt2.status,
      error: yt2.error,
      lastSync: yt2.lastSync,
      lastAttempt: yt2.lastAttempt,
      items: mark(yt2.items)
    }
  };
}
var social_admin_default = async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "status":
        return json(await status());
      case "save-settings": {
        const patch = {};
        if ("autoSync" in body) patch.autoSync = !!body.autoSync;
        if ("instagramEnabled" in body) patch.instagramEnabled = !!body.instagramEnabled;
        if ("youtubeEnabled" in body) patch.youtubeEnabled = !!body.youtubeEnabled;
        if ("frequencyHours" in body) {
          const f = Number(body.frequencyHours);
          if (!FREQS.includes(f)) throw new HttpError(400, "Pick a sync frequency from the list.");
          patch.frequencyHours = f;
        }
        if ("youtubeChannel" in body) {
          const c = String(body.youtubeChannel || "").trim();
          if (c) await getChannel(c);
          patch.youtubeChannel = c;
        }
        await saveSettings(patch);
        return json(await status());
      }
      case "sync":
        await runSync({ only: body.only, budgetMs: 6500 });
        return json(await status());
      case "hide":
        if (!body.id) throw new HttpError(400, "Missing post id.");
        await setHidden(String(body.id), !!body.hidden);
        return json({ ok: true });
      case "ig-connect-url":
        if (!process.env.IG_APP_ID || !process.env.IG_APP_SECRET)
          throw new HttpError(400, "Add IG_APP_ID and IG_APP_SECRET in Netlify first (see the guide).");
        return json({ url: authorizeUrl(redirectUri(), signState()) });
      case "ig-token": {
        const t = await storeToken(body.token, body.expiresIn);
        await runSync({ only: "instagram", budgetMs: 5500 }).catch(() => {
        });
        return json({ ok: true, username: t.username });
      }
      case "ig-disconnect":
        await clearIgToken();
        return json(await status());
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    return json({ error: e.message || "Something went wrong." }, e.status || 500);
  }
};

// ../moripradhyumansinh/travelwithmori/netlify/functions/instagram-callback.mjs
var back = (q) => new Response(null, { status: 302, headers: { location: `/admin/social.html?${q}` } });
var instagram_callback_default = async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return back("ig=denied");
  if (!checkState(u.searchParams.get("state"))) return back("ig=expired");
  try {
    await exchangeCode(u.searchParams.get("code"), `${process.env.URL}/api/instagram-callback`);
    await runSync({ only: "instagram", budgetMs: 4500 }).catch(() => {
    });
    return back("ig=connected");
  } catch (e) {
    return back("ig=failed&msg=" + encodeURIComponent(e.message || "error"));
  }
};

// ../bundle/social.src.mjs
var social_src_default = async (req, ctx) => {
  const p = new URL(req.url).pathname;
  if (p.startsWith("/api/social-admin")) return social_admin_default(req, ctx);
  if (p.startsWith("/api/instagram-callback")) return instagram_callback_default(req, ctx);
  return social_feed_default(req, ctx);
};
export const config = { path: ["/api/social-feed", "/api/social-admin", "/api/instagram-callback"] };
export default social_src_default;
