import crypto from "crypto";
import { db, json } from "./_supabase.js";

const SESSION_HOURS = 12;

function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
}
function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function validToken(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

function normalizeRows(records) {
  return records.map((r, i) => ({
    date: String(r.date || "").trim(),
    name: String(r.name || "").trim(),
    emp_id: String(r.empId || "").trim(),
    checkpoint: String(r.checkpoint || "").trim(),
    work_content: String(r.workContent || "").trim(),
    row_no: i
  })).filter(r => r.date && (r.name || r.emp_id));
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};
    if (body.action === "login") {
      if (!process.env.ADMIN_PIN) return json(res, 500, { error: "尚未設定 ADMIN_PIN" });
      if (String(body.pin || "").trim() !== String(process.env.ADMIN_PIN).trim()) {
        return json(res, 401, { error: "PIN 錯誤" });
      }
      return json(res, 200, { token: makeToken() });
    }

    if (!validToken(req)) return json(res, 401, { error: "登入已失效，請重新輸入 PIN" });

    const supabase = db();

    if (body.action === "upload") {
      const rows = normalizeRows(Array.isArray(body.records) ? body.records : []);
      if (!rows.length) return json(res, 400, { error: "沒有可匯入的資料" });

      const dates = [...new Set(rows.map(r => r.date))];
      // 同一天重新匯入時，視為「取代當天名單」，避免重複。
      const del = await supabase.from("assignments").delete().in("date", dates);
      if (del.error) throw del.error;

      const ins = await supabase.from("assignments").insert(rows);
      if (ins.error) throw ins.error;

      const all = await supabase.from("assignments").select("date");
      if (all.error) throw all.error;
      const allDates = [...new Set(all.data.map(r => r.date))].sort().reverse();
      return json(res, 200, { dates: allDates, byDate: Object.fromEntries(dates.map(d => [d, true])) });
    }

    if (body.action === "deleteDate") {
      const date = String(body.date || "").trim();
      if (!date) return json(res, 400, { error: "缺少日期" });
      const del = await supabase.from("assignments").delete().eq("date", date);
      if (del.error) throw del.error;
      const all = await supabase.from("assignments").select("date");
      if (all.error) throw all.error;
      const allDates = [...new Set(all.data.map(r => r.date))].sort().reverse();
      return json(res, 200, { dates: allDates });
    }

    return json(res, 400, { error: "未知操作" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: "伺服器處理失敗，請稍後再試" });
  }
}
