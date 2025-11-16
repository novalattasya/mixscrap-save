// src/scraper/scraper.js
import { fetchAllListPages } from "./listScraper.js";
import { fetchKomikDetail } from "./detailScraper.js";
import { fetchChapterPages } from "./chapterScraper.js";
import * as db from "../db/index.js";
import { info, warn, error } from "../logger.js";
import pLimit from "p-limit";
import { CONCURRENCY, CHAPTER_CONCURRENCY } from "../config.js";
import { chapterParamToNumber } from "../utils.js";

const limit = pLimit(CONCURRENCY || 2);
const chapterLimit = pLimit(CHAPTER_CONCURRENCY || 3);

// retry & backoff settings
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "4", 10);
const RETRY_BACKOFF_MS = parseInt(process.env.RETRY_BACKOFF_MS || "2000", 10);

/**
 * Entry point: crawl list pages and process items with item-level concurrency
 */
export async function runScraper(startUrl){
  await fetchAllListPages(startUrl, async (pageObj) => {
    const items = pageObj.data || [];
    // limit concurrency for processing items (each item is a comic)
    const tasks = items.map(item => limit(() => processKomikItem(item)));
    await Promise.all(tasks);
  });

  info("Finished scanning all pages.");
}

/**
 * Process one komik item: insert/update metadata, detect missing chapters, schedule chapter scraping
 */
async function processKomikItem(item){
  try {
    const detailUrl = item.detail_url;
    const komik = await fetchKomikDetail(detailUrl);
    if (!komik) {
      warn("Empty komik detail for", item.param);
      return;
    }
    const param = komik.param;

    let existing = await db.findComicByParam(param);

    // --- new comic: insert metadata and chapter metas, then scrape chapters ---
    if (!existing) {
      info("New comic:", komik.title, "-> inserting metadata");
      const meta = {
        title: komik.title,
        param: komik.param,
        thumbnail: komik.thumbnail,
        genre: komik.genre,
        synopsis: komik.synopsis
      };
      await db.insertComic(meta);

      const chapters = komik.chapters || [];
      // insert chapter metas (oldest -> newest)
      // do dedupe and idempotent insert
      for (const ch of [...chapters].reverse()) {
        try {
          const exists = await db.findChapterByParam(ch.param);
          if (exists) continue;
          await db.insertChapter(param, ch);
        } catch (err) {
          const msg = (err && err.message) ? err.message : String(err);
          if (msg.includes("duplicate") || msg.includes("unique constraint") || msg.includes("already exists")) {
            warn("Ignored duplicate chapter insert (new comic)", ch.param);
            continue;
          }
          warn("Error inserting chapter meta (new comic)", ch.param, msg);
        }
      }

      // schedule scraping for all chapters with controlled concurrency
      const chapterTasks = (chapters || []).map(ch => chapterLimit(() => processChapterWithRetries(param, ch).catch(e => {
        // ensure single chapter failure doesn't bubble up
        warn("processChapterWithRetries error (new comic)", ch.param, e && e.message ? e.message : e);
      })));
      await Promise.all(chapterTasks);

      return;
    }

    // --- existing comic: possible metadata update + chapter comparison ---
    const metaPatch = {};
    if (JSON.stringify(existing.genre || []) !== JSON.stringify(komik.genre || [])) metaPatch.genre = komik.genre;
    if ((existing.synopsis || "") !== (komik.synopsis || "")) metaPatch.synopsis = komik.synopsis;
    if ((existing.thumbnail || "") !== (komik.thumbnail || "")) metaPatch.thumbnail = komik.thumbnail;
    if (Object.keys(metaPatch).length > 0) {
      info("Metadata changed for", param, "-> updating", Object.keys(metaPatch));
      await db.updateComic(param, metaPatch).catch(e => warn("Failed updateComic", e && e.message ? e.message : e));
    }

    // compare chapter lists
    const remoteChapters = komik.chapters || [];
    const remoteParams = remoteChapters.map(c => c.param);
    const dbChapters = await db.listChaptersByComicParam(param);
    const dbParams = dbChapters.map(c => c.param);

    // 1) missing remote params (new chapters)
    const missing = remoteChapters.filter(rc => !dbParams.includes(rc.param));

    // 2) failed/incomplete in DB (status != 'scraped' or pages missing)
    const failedOrIncomplete = dbChapters.filter(dc => {
      if (!dc.status || dc.status !== "scraped") return true;
      // optional: you can also check pages record if you implement findPagesByChapterParam
      return false;
    });

    // 3) numeric gap detection (only used for small series and when numerics are parseable)
    const numericMissing = (function(){
      if (!remoteChapters.length) return [];
      if (remoteChapters.length > 50) return []; // skip heavy heuristic for large series
      const parsed = remoteChapters.map(c => chapterParamToNumber(c.param)).filter(n => Number.isFinite(n));
      if (parsed.length / remoteChapters.length < 0.8) return [];
      return detectNumericGaps(remoteChapters, dbChapters);
    })();

    info(`Comic ${param}: remote=${remoteParams.length}, db=${dbParams.length}, missing=${missing.length}, failedOrIncomplete=${failedOrIncomplete.length}, numericGaps=${numericMissing.length}`);

    // Insert missing chapter metas (dedup + tolerant)
    const uniqueMissing = [];
    const seen = new Set();
    for (const ch of missing) {
      if (seen.has(ch.param)) continue;
      seen.add(ch.param);
      uniqueMissing.push(ch);
    }

    for (const ch of uniqueMissing) {
      try {
        const exists = await db.findChapterByParam(ch.param);
        if (exists) continue;
        await db.insertChapter(param, ch);
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        if (msg.includes("duplicate") || msg.includes("unique constraint") || msg.includes("already exists")) {
          warn(`Ignored duplicate chapter insert ${ch.param}`);
          continue;
        }
        warn("Error on insertChapter", ch.param, msg);
      }
    }

    // build toScrape list (dedup)
    const toScrapeParamsSet = new Set();
    missing.forEach(c => toScrapeParamsSet.add(c.param));
    failedOrIncomplete.forEach(c => toScrapeParamsSet.add(c.param));
    numericMissing.forEach(c => toScrapeParamsSet.add(c.param));

    const toScrape = [];
    // prefer remote chapter objects for detail_url
    for (const rp of remoteChapters) {
      if (toScrapeParamsSet.has(rp.param)) toScrape.push(rp);
    }
    // include failed/incomplete entries that might not be in remote list
    for (const dc of failedOrIncomplete) {
      if (!toScrapeParamsSet.has(dc.param)) continue;
      toScrape.push({
        param: dc.param,
        chapter: dc.chapter,
        detail_url: dc.detail_url,
        release: dc.release
      });
    }

    // scrape chapters with controlled concurrency
    const chapterTasks = toScrape.map(ch => chapterLimit(() => processChapterWithRetries(param, ch).catch(e => {
      warn("processChapterWithRetries error (existing comic)", ch.param, e && e.message ? e.message : e);
    })));
    await Promise.all(chapterTasks);

    // update comic timestamp
    await db.updateComic(param, { updated_at: new Date().toISOString() }).catch(() => {});
  } catch (err) {
    warn("Failed to process item", item.param, (err && err.stack) || (err && err.message) || err);
    // continue processing other items
  }
}

/**
 * Heuristic helper: detect numeric gaps by mapping numeric chapter numbers (if any)
 */
function detectNumericGaps(remoteChapters, dbChapters){
  const numsRemote = remoteChapters.map(c => ({ param: c.param, n: chapterParamToNumber(c.param) })).filter(x => Number.isFinite(x.n));
  if (numsRemote.length === 0) return [];
  const allNums = numsRemote.map(x => x.n);
  const minN = Math.min(...allNums), maxN = Math.max(...allNums);
  const dbNums = dbChapters.map(c => chapterParamToNumber(c.param)).filter(Number.isFinite);
  const missingNums = [];
  for (let k = minN; k <= maxN; k++) {
    if (!dbNums.includes(k)) missingNums.push(k);
  }
  const missing = numsRemote.filter(x => missingNums.includes(x.n)).map(x => remoteChapters.find(rc => rc.param === x.param)).filter(Boolean);
  return missing;
}

/**
 * Process one chapter with retries, validation, and status updates.
 * Does not throw on failure (handles internally), but returns after attempts exhausted.
 */
async function processChapterWithRetries(comic_param, ch){
  const chapterParam = ch.param;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      info(`Scraping chapter attempt ${attempt}/${MAX_RETRIES} -> ${chapterParam}`);
      // mark pending if adapter supports it
      try { if (db.updateChapterStatus) await db.updateChapterStatus(chapterParam, { status: "pending", retries: attempt - 1, last_error: null }); } catch(e){}

      // fetch pages
      const images = await fetchChapterPages(ch.detail_url);

      // validate pages
      if (!Array.isArray(images) || images.length === 0) {
        const errMsg = `Empty pages array for ${chapterParam}`;
        warn(errMsg);
        try { if (db.updateChapterStatus) await db.updateChapterStatus(chapterParam, { status: "failed", last_error: errMsg, retries: attempt }); } catch(e){}
        try { await db.insertPages(chapterParam, images || []); } catch(e){}
        if (attempt < MAX_RETRIES) await sleep(RETRY_BACKOFF_MS * attempt);
        continue; // retry
      }

      // validate url shapes
      const invalid = images.find(u => typeof u !== "string" || !/^https?:\/\//i.test(u));
      if (invalid) {
        const errMsg = `Invalid image url in pages for ${chapterParam}: ${invalid}`;
        warn(errMsg);
        try { if (db.updateChapterStatus) await db.updateChapterStatus(chapterParam, { status: "failed", last_error: errMsg, retries: attempt }); } catch(e){}
        try { await db.insertPages(chapterParam, images); } catch(e){}
        if (attempt < MAX_RETRIES) await sleep(RETRY_BACKOFF_MS * attempt);
        continue; // retry
      }

      // save pages (adapter should upsert or be idempotent)
      await db.insertPages(chapterParam, images);

      // mark scraped
      try { if (db.updateChapterStatus) await db.updateChapterStatus(chapterParam, { status: "scraped", last_scraped_at: new Date().toISOString(), last_error: null, retries: attempt }); } catch(e){}

      info(`Saved chapter ${chapterParam} with ${images.length} images`);
      return; // success
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      error(`Error scraping chapter ${chapterParam} attempt ${attempt}: ${msg}`);
      try { if (db.updateChapterStatus) await db.updateChapterStatus(chapterParam, { status: "failed", last_error: msg, retries: attempt }); } catch(e){}
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BACKOFF_MS * attempt);
        continue;
      } else {
        warn(`Max attempts reached for ${chapterParam}`);
        return;
      }
    }
  }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
