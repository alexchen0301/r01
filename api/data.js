import { db, json } from "./_supabase.js";

export default async function handler(req, res) {
  try {
    const supabase = db();
    if (req.query?.dates === "1") {
      const result = await supabase.from("assignments").select("date").order("date", { ascending: false });
      if (result.error) throw result.error;
      return json(res, 200, { dates: [...new Set(result.data.map(r => r.date))] });
    }
    const date = String(req.query?.date || "").trim();
    if (!date) return json(res, 400, { error: "請指定日期" });
    const result = await supabase
      .from("assignments")
      .select("id,date,name,emp_id,checkpoint,work_content")
      .eq("date", date)
      .order("row_no", { ascending: true })
      .order("name", { ascending: true });
    if (result.error) throw result.error;
    return json(res, 200, {
      records: result.data.map(r => ({
        id: r.id, date: r.date, name: r.name, empId: r.emp_id,
        checkpoint: r.checkpoint, workContent: r.work_content
      }))
    });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: "資料讀取失敗" });
  }
}
