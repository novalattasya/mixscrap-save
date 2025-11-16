// src/db/supabaseDb.js
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";
import { info, warn, error } from "../logger.js";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Supabase config missing. Check SUPABASE_URL and SUPABASE_KEY in env.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // use default global fetch
});

/** Helper: safe log of supabase responses */
function logResp(tag, resp) {
  if (!resp) return;
  if (resp.error) {
    error(`[Supabase][${tag}] ERROR:`, resp.error);
  } else {
    info(`[Supabase][${tag}] OK`);
  }
}

/** Helper to mask key in logs (for safety) */
function maskKey(k){
  if (!k) return "";
  return k.slice(0,6) + "..." + k.slice(-6);
}

info("[DB] Supabase adapter initialized");
info("[DB] SUPABASE_URL:", SUPABASE_URL);
info("[DB] SUPABASE_KEY (masked):", maskKey(SUPABASE_KEY));

/* -------------------- comics -------------------- */
export async function findComicByParam(param){
  const resp = await supabase.from("comics").select("*").eq("param", param).limit(1).maybeSingle();
  logResp("findComicByParam", resp);
  if (resp.error) throw resp.error;
  return resp.data || null;
}

export async function insertComic(meta){
  const now = new Date().toISOString();
  const payload = {
    title: meta.title,
    author: meta.author || null,     // <- baru
    status: meta.status || null,     // <- baru
    type: meta.type || null,         // <- baru
    param: meta.param,
    thumbnail: meta.thumbnail || null,
    genre: meta.genre || [],
    synopsis: meta.synopsis || "",
    created_at: now,
    updated_at: now
  };
  const resp = await supabase.from("comics").insert(payload).select();
  logResp("insertComic", resp);
  if (resp.error) throw resp.error;
  return Array.isArray(resp.data) ? resp.data[0] : resp.data;
}

export async function updateComic(param, patch){
  const now = new Date().toISOString();
  // allow patch to include author/status/type if present
  const p = { ...patch, updated_at: now };
  const resp = await supabase.from("comics").update(p).eq("param", param).select();
  logResp("updateComic", resp);
  if (resp.error) throw resp.error;
  return Array.isArray(resp.data) ? resp.data[0] : resp.data;
}

/* -------------------- chapters -------------------- */
export async function findChapterByParam(chapterParam){
  const resp = await supabase.from("chapters").select("*").eq("param", chapterParam).limit(1).maybeSingle();
  logResp("findChapterByParam", resp);
  if (resp.error) throw resp.error;
  return resp.data || null;
}

/**
 * Insert chapter meta idempotently using upsert on param.
 * Returns inserted/updated row.
 */
export async function insertChapter(comic_param, chapterMeta){
  const payload = {
    comic_param,
    chapter: chapterMeta.chapter,
    param: chapterMeta.param,
    release: chapterMeta.release || null,
    detail_url: chapterMeta.detail_url || null,
    status: chapterMeta.status || "pending",
    retries: chapterMeta.retries || 0,
    last_error: chapterMeta.last_error || null,
    last_scraped_at: chapterMeta.last_scraped_at || null,
    created_at: new Date().toISOString()
  };

  const resp = await supabase
    .from("chapters")
    .upsert(payload, { onConflict: "param" })
    .select();
  logResp("insertChapter(upsert)", resp);
  if (resp.error) throw resp.error;
  // resp.data is array
  return Array.isArray(resp.data) ? resp.data[0] : resp.data;
}

export async function updateChapterStatus(chapterParam, patch){
  const resp = await supabase.from("chapters").update(patch).eq("param", chapterParam).select();
  logResp("updateChapterStatus", resp);
  if (resp.error) throw resp.error;
  return Array.isArray(resp.data) ? resp.data[0] : resp.data;
}

/* -------------------- pages -------------------- */
export async function findPagesByChapterParam(chapter_param){
  const resp = await supabase.from("pages").select("*").eq("chapter_param", chapter_param).limit(1).maybeSingle();
  logResp("findPagesByChapterParam", resp);
  if (resp.error) throw resp.error;
  return resp.data || null;
}

/**
 * Insert or update pages (upsert on chapter_param).
 * images must be array of strings.
 */
export async function insertPages(chapter_param, images){
  const payload = {
    chapter_param,
    images: images || [],
    verified: Array.isArray(images) && images.length > 0,
    last_verified_at: Array.isArray(images) && images.length > 0 ? new Date().toISOString() : null,
    created_at: new Date().toISOString()
  };

  const resp = await supabase.from("pages").upsert(payload, { onConflict: "chapter_param" }).select();
  logResp("insertPages(upsert)", resp);
  if (resp.error) throw resp.error;
  return Array.isArray(resp.data) ? resp.data[0] : resp.data;
}

/* -------------------- helpers -------------------- */

/**
 * List chapters by comic param (ordered by created_at asc)
 */
export async function listChaptersByComicParam(comic_param){
  const resp = await supabase.from("chapters").select("*").eq("comic_param", comic_param).order("created_at", { ascending: true });
  logResp("listChaptersByComicParam", resp);
  if (resp.error) throw resp.error;
  return resp.data || [];
}

/**
 * Quick ping/test function
 */
export async function ping(){
  try {
    const r = await supabase.from("comics").select("param").limit(1);
    logResp("ping-select-comics", r);
    return r;
  } catch (e) {
    error("Ping failed:", e);
    throw e;
  }
}
