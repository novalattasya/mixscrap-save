// scripts/check_db_exports.js
import * as db from "../src/db/index.js"; // jalankan dari folder project/scripts, adjust path
console.log("has updateChapterStatus:", typeof db.updateChapterStatus);
console.log("has insertPages:", typeof db.insertPages);
console.log("has findChapterByParam:", typeof db.findChapterByParam);
