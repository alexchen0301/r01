import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// 讀取管理員密碼
const ADMIN_PIN = process.env.ADMIN_PIN;
// 使用固定加解密鹽值，確保登入與上傳時 Token 驗證絕對一致
const JWT_SECRET = process.env.ADMIN_PIN || "guangci_system_secure_jwt_secret_key_2026";

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', String(JWT_SECRET))
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', String(JWT_SECRET))
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

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase 環境變數未設定');
  }
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!ADMIN_PIN) {
    return res.status(500).json({ error: '伺服器未讀取到 ADMIN_PIN 環境變數' });
  }

  const { action, pin, records, date } = req.body || {};

  // 1. 登入驗證
  if (action === 'login') {
    if (!pin || String(pin).trim() !== String(ADMIN_PIN).trim()) {
      return res.status(401).json({ error: 'PIN 碼不正確' });
    }
    // 簽發 24 小時有效的 Token
    const token = sign({ admin: true, exp: Math.floor(Date.now() / 1000) + 86400 });
    return res.status(200).json({ ok: true, token });
  }

  // 2. 驗證權限（上傳/刪除等操作）
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/, '');
  const auth = verify(token);

  if (!auth) {
    return res.status(401).json({ error: '權限不足或登入已過期，請重新輸入 PIN 碼' });
  }

  try {
    const supabase = getSupabase();

    // 上傳名單
    if (action === 'upload') {
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: '無效的資料格式' });
      }

      const byDate = {};
      for (const r of records) {
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push(r);
      }

      for (const [d, list] of Object.entries(byDate)) {
        await supabase.from('rosters').delete().eq('date', d);
        const { error } = await supabase.from('rosters').insert(
          list.map((item) => ({
            date: item.date,
            emp_id: item.empId,
            name: item.name,
            checkpoint: item.checkpoint,
            work_content: item.workContent,
          }))
        );
        if (error) throw error;
      }

      return res.status(200).json({ ok: true, dates: Object.keys(byDate), byDate });
    }

    // 刪除特定日期的名單
    if (action === 'deleteDate') {
      if (!date) return res.status(400).json({ error: '未指定日期' });
      const { error } = await supabase.from('rosters').delete().eq('date', date);
      if (error) throw error;

      const { data } = await supabase.from('rosters').select('date');
      const dates = Array.from(new Set((data || []).map((d) => d.date))).sort().reverse();
      return res.status(200).json({ ok: true, dates });
    }

    return res.status(400).json({ error: '未知的操作類型' });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: err.message || '伺服器處理失敗' });
  }
}
