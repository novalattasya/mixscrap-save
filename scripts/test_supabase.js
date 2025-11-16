// scripts/test_supabase.js
import dotenv from "dotenv";
dotenv.config();
import { SUPABASE_URL, SUPABASE_KEY } from "../src/config.js";
import { createClient } from "@supabase/supabase-js";

async function main(){
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("ENV missing SUPABASE_URL or SUPABASE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("Trying simple insert to table `comics` (will use upsert to avoid conflict)");
  try {
    const payload = {
      title: "TEST_CONN_" + Math.random().toString(36).slice(2,8),
      param: "test-conn-" + Date.now(),
      thumbnail: null,
      genre: ["Test"],
      synopsis: "Connectivity test",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const r = await supabase.from("comics").insert(payload).select();
    console.log("RESP:", r.error ? { error: r.error } : { data: r.data });
  } catch (err) {
    console.error("Exception:", err);
  }
}

main();
