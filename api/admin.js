import { db, json } from "./_supabase.js";
import crypto from 'crypto';

const HARDCODED_SECRET = "guangci_stable_jwt_key_2026";

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', HARDCODED_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verify(token) {
  if (!token) return null;
  const parts = String(token).trim().split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', HARDCODED_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  
  if (signature !== expected) return null;
  
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }

  const envPin = process.env.ADMIN_PIN;
  if (!envPin) {
    return json(res, 500, { error: '伺服器未讀取到 ADMIN_PIN 環境變數' });
  }

  const bodyData = req.body || {};
  const { action, pin, records, date } = bodyData;

  // 1. 登入驗證
  if (action === 'login') {
    if (!pin || String(pin).trim() !== String(envPin).trim()) {
      return json(res, 401, { error: 'PIN 碼不正確' });
    }
    const token = sign({ admin: true, exp: Math.floor(Date.now() / 1000) + 86400 });
    return json(res, 200, { ok: true, token });
  }

  // 2. 驗證權限
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const headerToken = authHeader.replace(/^Bearer\s+/i, '');
  const rawToken = headerToken || bodyData.token || '';

  const auth = verify(rawToken);

  if (!auth) {
    return json(res, 401, { error: '權限不足或登入已過期，請重新輸入 PIN 碼' });
  }

  try {
    const supabase = db();

    // 上傳名單：寫入 assignments 資料表
    if (action === 'upload') {
      if (!Array.isArray(records) || records.length === 0) {
        return json(res, 400, { error: '無效的資料格式' });
      }

      const byDate = {};
      for (const r of records) {
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push(r);
      }

      for (const [d, list] of Object.entries(byDate)) {
        // 清除舊資料
        await supabase.from('assignments').delete().eq('date', d);
        
        // 寫入 assignments 資料表（支援 group_name 欄位）
        const { error } = await supabase.from('assignments').insert(
          list.map((item, idx) => ({
            date: item.date,
            group_name: item.group || item.group_name || '',
            emp_id: item.empId || item.emp_id || '',
            name: item.name,
            checkpoint: item.checkpoint || '',
            work_content: item.workContent || item.work_content || '',
            row_no: idx + 1
          }))
        );
        if (error) throw error;
      }

      return json(res, 200, { ok: true, dates: Object.keys(byDate), byDate });
    }

    // 刪除特定日期的名單
    if (action === 'deleteDate') {
      if (!date) return json(res, 400, { error: '未指定日期' });
      const { error } = await supabase.from('assignments').delete().eq('date', date);
      if (error) throw error;

      const { data } = await supabase.from('assignments').select('date');
      const dates = Array.from(new Set((data || []).map((d) => d.date))).sort().reverse();
      return json(res, 200, { ok: true, dates });
    }

    return json(res, 400, { error: '未知的操作類型' });
  } catch (err) {
    console.error('API Error:', err);
    return json(res, 500, { error: err.message || '伺服器處理失敗' });
  }
}
