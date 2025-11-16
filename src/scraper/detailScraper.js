import http from "../http.js";
import { info } from "../logger.js";

export async function fetchKomikDetail(detailUrl){
  info("Fetching komik detail:", detailUrl);
  const data = await http.get(detailUrl);
  return data?.data || data || null;
}
