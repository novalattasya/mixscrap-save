// scripts/test_update_chapter.js
import * as db from "../src/db/index.js";

async function run(){
  const testParam = "<ambil-salah-satu-chapter_param-dari-SQL-sample>";
  console.log("Testing updateChapterStatus for:", testParam);
  try {
    const before = await db.findChapterByParam(testParam);
    console.log("before:", before);
    const res = await db.updateChapterStatus(testParam, {
      status: "scraped",
      last_scraped_at: new Date().toISOString(),
      last_error: null,
      retries: 0
    });
    console.log("update result:", res);
    const after = await db.findChapterByParam(testParam);
    console.log("after:", after);
  } catch(e){
    console.error("ERROR:", e && e.message ? e.message : e);
  }
}
run();
