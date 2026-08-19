import React, { useState, useEffect } from 'react';

// API 溝通函式（自動儲存與帶入 Token）
async function apiAdmin(action, payload = {}) {
  const token = sessionStorage.getItem("adminToken") || "";
  
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${token}` 
    },
    body: JSON.stringify({ action, ...payload, token }),
  });
  
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "操作失敗");
  
  // 關鍵修復：登入成功自動儲存 Token
  if (action === "login" && data.token) {
    sessionStorage.setItem("adminToken", data.token);
  }
  
  return data;
}

export default function App() {
  const [pin, setPin] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [excelData, setExcelData] = useState([]);
  const [message, setMessage] = useState("");

  // 登入處理
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await apiAdmin("login", { pin });
      if (res.ok) {
        setIsLoggedIn(true);
        setPin("");
      }
    } catch (err) {
      setLoginError(err.message || "PIN 碼錯誤");
    }
  };

  // 檔案拖曳與解析處理 (支援簡單表格陣列)
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(evt.target.result, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        // 格式化資料轉換
        const formatted = rawData.map(row => ({
          date: String(row.日期 || row.date || '').trim(),
          empId: String(row.員編 || row.empId || '').trim(),
          name: String(row.姓名 || row.name || '').trim(),
          checkpoint: String(row.點位 || row.checkpoint || '').trim(),
          workContent: String(row.工作內容 || row.workContent || '').trim(),
        })).filter(r => r.date && r.name);

        setExcelData(formatted);
        setMessage(`成功讀取 ${formatted.length} 筆資料，請點擊確認送出`);
      } catch (err) {
        setMessage("Excel 解析失敗，請確認格式");
      }
    };
    reader.readAsBinaryString(file);
  };

  // 上傳送出處理
  const handleConfirmUpload = async () => {
    if (excelData.length === 0) return;
    setIsUploading(true);
    setMessage("");
    try {
      await apiAdmin("upload", { records: excelData });
      setMessage("✅ 資料成功寫入 Supabase 資料庫！");
      setExcelData([]);
    } catch (err) {
      setMessage(`❌ 上傳失敗: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8">
      {/* 頂部標題 */}
      <header className="max-w-4xl mx-auto mb-8 text-center border-b border-slate-700 pb-4">
        <div className="flap-font text-slate-100 text-2xl font-semibold leading-tight mb-2">
          支援人力點位查詢系統
        </div>
        <p className="text-slate-400 text-sm">管理後台 - 名單匯入與維護</p>
      </header>

      <main className="max-w-4xl mx-auto">
        {!isLoggedIn ? (
          /* 登入區塊 */
          <div className="max-w-md mx-auto bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
            <h2 className="text-xl font-bold mb-4 text-center">後台管理員驗證</h2>
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">請輸入 ADMIN PIN 碼</label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-center text-lg tracking-widest focus:outline-none focus:border-blue-500"
                  placeholder="****"
                />
              </div>
              {loginError && <p className="text-red-400 text-sm text-center">{loginError}</p>}
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded transition"
              >
                解鎖並進入後台
              </button>
            </form>
          </div>
        ) : (
          /* 上傳管理區塊 */
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl space-y-6">
            <div className="flex justify-between items-center border-b border-slate-700 pb-4">
              <h2 className="text-lg font-bold text-green-400">已成功登入管理後台</h2>
              <button
                onClick={() => {
                  sessionStorage.removeItem("adminToken");
                  setIsLoggedIn(false);
                }}
                className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded"
              >
                登出
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">選擇要匯入的 Excel 檔案 (.xlsx)</label>
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleFileUpload}
                className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
              />
            </div>

            {message && (
              <div className="p-3 bg-slate-900 border border-slate-700 rounded text-sm text-center">
                {message}
              </div>
            )}

            {excelData.length > 0 && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">預覽即將寫入的資料（前 5 筆）：</p>
                <div className="overflow-x-auto bg-slate-900 rounded p-2 text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400">
                        <th className="p-1">日期</th>
                        <th className="p-1">員編</th>
                        <th className="p-1">姓名</th>
                        <th className="p-1">點位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excelData.slice(0, 5).map((r, idx) => (
                        <tr key={idx} className="border-b border-slate-800">
                          <td className="p-1">{r.date}</td>
                          <td className="p-1">{r.empId}</td>
                          <td className="p-1">{r.name}</td>
                          <td className="p-1">{r.checkpoint}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={handleConfirmUpload}
                  disabled={isUploading}
                  className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded transition disabled:opacity-50"
                >
                  {isUploading ? "正在寫入 Supabase..." : "確認送出寫入資料庫"}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
