import React, { useState, useEffect, useMemo } from 'react';

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
  
  // 登入成功自動將 Token 寫入 sessionStorage
  if (action === "login" && data.token) {
    sessionStorage.setItem("adminToken", data.token);
  }
  
  return data;
}

export default function App() {
  // 頁面狀態
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'admin'
  
  // 查詢頁面狀態
  const [selectedDate, setSelectedDate] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [rosters, setRosters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 管理後台狀態
  const [pin, setPin] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [excelData, setExcelData] = useState([]);
  const [adminMsg, setAdminMsg] = useState('');

  // 1. 初始化讀取資料庫的日期列表
  useEffect(() => {
    fetchDatesAndData();
  }, []);

  const fetchDatesAndData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/roster');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '無法讀取資料');
      
      const dates = data.dates || [];
      setAvailableDates(dates);
      
      if (dates.length > 0) {
        setSelectedDate(dates[0]);
        fetchRosterByDate(dates[0]);
      } else {
        setRosters([]);
      }
    } catch (err) {
      setErrorMsg(err.message || '讀取資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const fetchRosterByDate = async (date) => {
    if (!date) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/roster?date=${encodeURIComponent(date)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '讀取失敗');
      setRosters(data.records || []);
    } catch (err) {
      setErrorMsg(err.message || '讀取班表失敗');
    } finally {
      setLoading(false);
    }
  };

  // 2. 搜尋過濾邏輯
  const filteredRosters = useMemo(() => {
    if (!searchQuery.trim()) return rosters;
    const q = searchQuery.trim().toLowerCase();
    return rosters.filter(r => 
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.emp_id && r.emp_id.toLowerCase().includes(q)) ||
      (r.checkpoint && r.checkpoint.toLowerCase().includes(q)) ||
      (r.work_content && r.work_content.toLowerCase().includes(q))
    );
  }, [rosters, searchQuery]);

  // 3. 後台登入處理
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await apiAdmin('login', { pin });
      if (res.ok) {
        setIsLoggedIn(true);
        setPin('');
      }
    } catch (err) {
      setLoginError(err.message || 'PIN 碼不正確');
    }
  };

  // 4. Excel 檔案解析
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

        const formatted = rawData.map(row => ({
          date: String(row['日期'] || row.date || '').trim(),
          empId: String(row['員編'] || row.empId || row['員工編號'] || '').trim(),
          name: String(row['姓名'] || row.name || '').trim(),
          checkpoint: String(row['點位'] || row.checkpoint || row['支援點位'] || '').trim(),
          workContent: String(row['工作內容'] || row.workContent || '').trim(),
        })).filter(r => r.date && r.name);

        if (formatted.length === 0) {
          setAdminMsg('⚠️ 讀取到的有效資料筆數為 0，請確認 Excel 欄位名稱是否包含「日期」與「姓名」');
          setExcelData([]);
        } else {
          setExcelData(formatted);
          setAdminMsg(`✅ 解析成功！共 ${formatted.length} 筆資料預覽如下，請確認後點擊送出。`);
        }
      } catch (err) {
        setAdminMsg('❌ Excel 解析失敗，請確認檔案格式是否正確。');
      }
    };
    reader.readAsBinaryString(file);
  };

  // 5. 確認上傳至 Supabase
  const handleConfirmUpload = async () => {
    if (excelData.length === 0) return;
    setIsUploading(true);
    setAdminMsg('');
    try {
      await apiAdmin('upload', { records: excelData });
      setAdminMsg('🎉 資料已成功匯入 Supabase 資料庫！');
      setExcelData([]);
      fetchDatesAndData(); // 重新整理前台日期與名單
    } catch (err) {
      setAdminMsg(`❌ 上傳失敗: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // 6. 刪除特定日期資料
  const handleDeleteDate = async (d) => {
    if (!window.confirm(`確定要刪除 ${d} 的所有班表紀錄嗎？`)) return;
    try {
      await apiAdmin('deleteDate', { date: d });
      setAdminMsg(`已成功刪除 ${d} 的班表`);
      fetchDatesAndData();
    } catch (err) {
      setAdminMsg(`刪除失敗: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-8">
      {/* 頂部標頭區域 */}
      <header className="max-w-5xl mx-auto mb-8 text-center border-b border-slate-800 pb-6">
        <h1 className="flap-font text-3xl md:text-4xl text-amber-400 font-bold tracking-wider mb-2 drop-shadow">
          支援人力點位查詢系統
        </h1>
        <p className="text-slate-400 text-sm">即時動態點位查詢與管理模組</p>

        {/* 分頁切換按鈕 */}
        <div className="flex justify-center gap-4 mt-6">
          <button
            onClick={() => setActiveTab('search')}
            className={`px-6 py-2 rounded-full font-semibold text-sm transition-all ${
              activeTab === 'search'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            🔍 點位查詢
          </button>
          <button
            onClick={() => setActiveTab('admin')}
            className={`px-6 py-2 rounded-full font-semibold text-sm transition-all ${
              activeTab === 'admin'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            ⚙️ 後台管理
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        {/* ==================== 頁面一：前台查詢 ==================== */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            {/* 搜尋與日期選單列 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-xl">
              <div>
                <label className="block text-xs text-slate-400 mb-1">選擇支援日期</label>
                <select
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    fetchRosterByDate(e.target.value);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-amber-300 font-medium focus:outline-none focus:border-amber-500"
                >
                  {availableDates.length === 0 ? (
                    <option value="">(目前無班表資料)</option>
                  ) : (
                    availableDates.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))
                  )}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">快速搜尋（姓名、員編、點位、工作內容）</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="輸入關鍵字..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* 訊息與載入顯示 */}
            {loading && <p className="text-center text-amber-400 py-8 animate-pulse">資料讀取中...</p>}
            {errorMsg && <p className="text-center text-red-400 py-4">{errorMsg}</p>}

            {/* 查詢結果卡片列表 */}
            {!loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRosters.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800">
                    尚無符合條件的班表資料
                  </div>
                ) : (
                  filteredRosters.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-xl p-5 shadow-lg transition-all space-y-3"
                    >
                      <div className="flex justify-between items-start border-b border-slate-800 pb-2">
                        <div>
                          <span className="text-lg font-bold text-white mr-2">{item.name}</span>
                          <span className="text-xs text-slate-400">({item.emp_id || '無員編'})</span>
                        </div>
                        <span className="text-xs bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full font-mono">
                          {item.date}
                        </span>
                      </div>

                      <div>
                        <span className="text-xs text-slate-400 block mb-0.5">支援點位</span>
                        <p className="text-amber-300 font-semibold">{item.checkpoint || '未指定'}</p>
                      </div>

                      {item.work_content && (
                        <div>
                          <span className="text-xs text-slate-400 block mb-0.5">工作內容</span>
                          <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-2 rounded border border-slate-800/50">
                            {item.work_content}
                          </p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================== 頁面二：後台管理 ==================== */}
        {activeTab === 'admin' && (
          <div className="max-w-2xl mx-auto">
            {!isLoggedIn ? (
              /* 未登入：PIN 碼輸入卡片 */
              <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-2xl space-y-6">
                <div className="text-center">
                  <h2 className="text-xl font-bold text-amber-400 mb-1">管理員解鎖驗證</h2>
                  <p className="text-xs text-slate-400">請輸入 ADMIN PIN 碼以存取後台控制台</p>
                </div>

                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="****"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-center text-2xl tracking-widest text-white focus:outline-none focus:border-amber-500"
                  />
                  {loginError && <p className="text-xs text-red-400 text-center">{loginError}</p>}

                  <button
                    type="submit"
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-3 rounded-xl transition shadow-lg shadow-amber-500/10"
                  >
                    驗證登入
                  </button>
                </form>
              </div>
            ) : (
              /* 已登入：Excel 匯入與管理 */
              <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-2xl space-y-6">
                <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                  <span className="text-sm text-emerald-400 font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    已驗證管理員身份
                  </span>
                  <button
                    onClick={() => {
                      sessionStorage.removeItem('adminToken');
                      setIsLoggedIn(false);
                    }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700"
                  >
                    登出系統
                  </button>
                </div>

                {/* 檔案上傳區 */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-200">選擇 Excel 檔案 (.xlsx)</label>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    className="block w-full text-xs text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-500 file:text-slate-950 hover:file:bg-amber-400 cursor-pointer bg-slate-950 p-2 rounded-xl border border-slate-800"
                  />
                </div>

                {/* 後台訊息提示 */}
                {adminMsg && (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-center text-slate-300">
                    {adminMsg}
                  </div>
                )}

                {/* 數據預覽與確認上傳 */}
                {excelData.length > 0 && (
                  <div className="space-y-4 pt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-400">資料預覽（前 5 筆）</span>
                      <span className="text-xs text-amber-400 font-mono">共 {excelData.length} 筆</span>
                    </div>

                    <div className="overflow-x-auto bg-slate-950 rounded-xl p-3 border border-slate-800 text-xs">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400">
                            <th className="p-1.5">日期</th>
                            <th className="p-1.5">員編</th>
                            <th className="p-1.5">姓名</th>
                            <th className="p-1.5">點位</th>
                          </tr>
                        </thead>
                        <tbody>
                          {excelData.slice(0, 5).map((r, idx) => (
                            <tr key={idx} className="border-b border-slate-900 text-slate-300">
                              <td className="p-1.5">{r.date}</td>
                              <td className="p-1.5">{r.empId}</td>
                              <td className="p-1.5">{r.name}</td>
                              <td className="p-1.5">{r.checkpoint}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <button
                      onClick={handleConfirmUpload}
                      disabled={isUploading}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                    >
                      {isUploading ? '正在寫入 Supabase 資料庫...' : '確認送出寫入資料庫'}
                    </button>
                  </div>
                )}

                {/* 已存在日期刪除管理 */}
                {availableDates.length > 0 && (
                  <div className="pt-6 border-t border-slate-800 space-y-3">
                    <h3 className="text-xs font-semibold text-slate-400">已匯入的日期資料管理</h3>
                    <div className="flex flex-wrap gap-2">
                      {availableDates.map((d) => (
                        <div
                          key={d}
                          className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs"
                        >
                          <span className="text-amber-300 font-mono">{d}</span>
                          <button
                            onClick={() => handleDeleteDate(d)}
                            className="text-red-400 hover:text-red-300 font-bold ml-1"
                            title="刪除此日期的資料"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
