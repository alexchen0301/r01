import React, { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

/* ------------------------------------------------------------------ */
/*  設定區                                                            */
/* ------------------------------------------------------------------ */
const MAX_PIN_ATTEMPTS = 3; 
const LOCKOUT_MINUTES = 15; 

const FLAP_POOL =
  "廣慈奉天宮站管制點位工作內容人潮安全通車東西南北門口區域崗哨值勤守望警戒巡查".split("");

const HEADER_MAP = {
  date: ["日期", "Date", "date"],
  group: ["組別", "組", "組別名稱", "Group", "Team", "group", "team"],
  name: ["姓名", "名字", "Name", "name"],
  empId: ["員工編號", "員編", "工號", "EmpID", "ID", "員工編号"],
  checkpoint: ["點位", "崗位", "站點", "位置", "管制點", "崗哨", "Checkpoint"],
  workContent: ["工作內容", "工作項目", "內容", "任務", "Content", "Duty"],
};

function toHalfWidthDigits(str) {
  return str.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}
function normalizePin(str) {
  return toHalfWidthDigits(str).trim();
}
async function apiGet(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "讀取失敗");
  return data;
}

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
  
  if (action === "login" && data.token) {
    sessionStorage.setItem("adminToken", data.token);
  }
  return data;
}

function todayStr() {
  return new Date().toLocaleDateString("sv-SE"); 
}

function findKey(row, candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const hit = keys.find((k) => k.trim() === c);
    if (hit) return hit;
  }
  for (const c of candidates) {
    const hit = keys.find((k) => k.replace(/\s/g, "").includes(c.replace(/\s/g, "")));
    if (hit) return hit;
  }
  return null;
}

function normalizeRows(rawRows, fallbackDate) {
  return rawRows
    .map((raw, i) => {
      const nameKey = findKey(raw, HEADER_MAP.name);
      const idKey = findKey(raw, HEADER_MAP.empId);
      const groupKey = findKey(raw, HEADER_MAP.group);
      const cpKey = findKey(raw, HEADER_MAP.checkpoint);
      const workKey = findKey(raw, HEADER_MAP.workContent);
      const dateKey = findKey(raw, HEADER_MAP.date);

      const name = nameKey ? String(raw[nameKey] ?? "").trim() : "";
      const empId = idKey ? String(raw[idKey] ?? "").trim() : "";
      if (!name && !empId) return null;

      let date = dateKey ? String(raw[dateKey] ?? "").trim() : "";
      if (!date) date = fallbackDate;
      if (/^\d+(\.\d+)?$/.test(date) && Number(date) > 30000) {
        const d = XLSX.SSF.parse_date_code(Number(date));
        if (d) date = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
      }

      return {
        id: `${date}-${empId || name}-${i}`,
        date,
        group: groupKey ? String(raw[groupKey] ?? "").trim() : "",
        name,
        empId,
        emp_id: empId,
        checkpoint: cpKey ? String(raw[cpKey] ?? "").trim() : "",
        workContent: workKey ? String(raw[workKey] ?? "").trim() : "",
        work_content: workKey ? String(raw[workKey] ?? "").trim() : "",
      };
    })
    .filter(Boolean);
}

function FlapText({ text, className, style }) {
  const [display, setDisplay] = useState(text);
  useEffect(() => {
    const chars = text.split("");
    const totalFrames = 9;
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      const revealCount = Math.ceil((frame / totalFrames) * chars.length);
      const next = chars
        .map((c, i) =>
          i < revealCount ? c : FLAP_POOL[Math.floor(Math.random() * FLAP_POOL.length)]
        )
        .join("");
      setDisplay(next);
      if (frame >= totalFrames) {
        clearInterval(interval);
        setDisplay(text);
      }
    }, 45);
    return () => clearInterval(interval);
  }, [text]);
  return (
    <span className={className} style={style}>
      {display}
    </span>
  );
}

export default function App() {
  const [mode, setMode] = useState("lookup");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [lockedUntil, setLockedUntil] = useState(null);

  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedResult, setSelectedResult] = useState(null);
  const [searched, setSearched] = useState(false);

  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadDateOverride, setUploadDateOverride] = useState(todayStr());
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [deletingDate, setDeletingDate] = useState(null);

  const loadDateList = useCallback(async () => {
    try {
      const data = await apiGet("/api/data?dates=1");
      const list = Array.isArray(data.dates) ? data.dates : [];
      list.sort().reverse();
      setAvailableDates(list);
      return list;
    } catch {
      setAvailableDates([]);
      return [];
    }
  }, []);

  const loadRecordsForDate = useCallback(async (date) => {
    if (!date) return;
    setRecordsLoading(true);
    try {
      const data = await apiGet(`/api/data?date=${encodeURIComponent(date)}`);
      const rawRecords = Array.isArray(data.records) ? data.records : [];
      const normalizedRecords = rawRecords.map(r => ({
        ...r,
        empId: r.empId || r.emp_id || "",
        group: r.group || r.group_name || "",
        workContent: r.workContent || r.work_content || "",
      }));
      setRecords(normalizedRecords);
    } catch {
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadDateList();
      const initial = list.includes(todayStr()) ? todayStr() : list[0] || todayStr();
      setSelectedDate(initial);
      if (initial) loadRecordsForDate(initial);
    })();
  }, [loadDateList, loadRecordsForDate]);

  useEffect(() => {
    if (sessionStorage.getItem("adminToken")) setAdminAuthed(true);
  }, []);

  function handleSearch() {
    const term = searchTerm.trim();
    setSearched(true);
    setSelectedResult(null);
    if (!term) {
      setSearchResults([]);
      return;
    }
    const lower = term.toLowerCase();
    const results = records.filter(
      (r) => 
        (r.name && r.name.includes(term)) || 
        (r.empId && r.empId.toLowerCase().includes(lower))
    );
    setSearchResults(results);
    if (results.length === 1) setSelectedResult(results[0]);
  }

  async function handlePinSubmit(e) {
    if (e) e.preventDefault();
    setPinError("");
    try {
      const data = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", pin: normalizePin(pinInput) }),
      });
      const result = await data.json().catch(() => ({}));
      if (!data.ok) throw new Error(result.error || "PIN 錯誤");
      
      sessionStorage.setItem("adminToken", result.token);
      setAdminAuthed(true);
      setPinInput("");
    } catch (err) {
      setPinError(err.message || "PIN 錯誤");
      setPinInput("");
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus(null);
    setUploadBusy(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array", cellDates: false });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const normalized = normalizeRows(raw, uploadDateOverride);
        if (normalized.length === 0) {
          setUploadStatus({
            type: "error",
            msg: "無法辨識任何名單資料，請確認欄位包含「姓名或員工編號」、「點位」、「工作內容」。",
          });
          setUploadPreview(null);
        } else {
          setUploadPreview(normalized);
        }
      } catch (err) {
        setUploadStatus({ type: "error", msg: "檔案讀取失敗，請確認為有效的 Excel 檔（.xlsx）。" });
        setUploadPreview(null);
      } finally {
        setUploadBusy(false);
      }
    };
    reader.onerror = () => {
      setUploadStatus({ type: "error", msg: "檔案讀取失敗，請再試一次。" });
      setUploadBusy(false);
    };
    reader.readAsArrayBuffer(file);
  }

  async function confirmUpload() {
    if (!uploadPreview) return;
    setUploadBusy(true);
    try {
      const result = await apiAdmin("upload", { records: uploadPreview });
      setUploadStatus({
        type: "success",
        msg: `已成功上傳 ${uploadPreview.length} 筆名單，涵蓋 ${result.dates?.length || 0} 個日期。`,
      });
      setUploadPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      
      const updatedList = await loadDateList();
      const targetDate = uploadPreview[0]?.date || updatedList[0] || todayStr();
      setSelectedDate(targetDate);
      loadRecordsForDate(targetDate);
    } catch (err) {
      setUploadStatus({ type: "error", msg: err.message || "儲存失敗，請再試一次。" });
    } finally {
      setUploadBusy(false);
    }
  }

  async function deleteDate(date) {
    setDeletingDate(date);
    try {
      const result = await apiAdmin("deleteDate", { date });
      const remaining = Array.isArray(result.dates) ? result.dates : [];
      setAvailableDates(remaining);
      if (selectedDate === date) {
        const next = remaining[0] || todayStr();
        setSelectedDate(next);
        if (next) loadRecordsForDate(next);
      }
      setUploadStatus({ type: "success", msg: `已刪除 ${date} 的名單。` });
    } catch (err) {
      setUploadStatus({ type: "error", msg: err.message || "刪除失敗，請再試一次。" });
    } finally {
      setDeletingDate(null);
    }
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: "#0B1220", fontFamily: "'Inter', sans-serif" }}
    >
      <style>{`
        .flap-font { font-family: 'Barlow Condensed', sans-serif; }
        .tabular { font-variant-numeric: tabular-nums; }
        @keyframes riseIn { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform: translateY(0);} }
        .rise-in { animation: riseIn 0.35s ease-out; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); opacity: 0.6; }
      `}</style>

      {/* 頂部列 */}
      <div
        className="sticky top-0 z-10 w-full border-b"
        style={{ background: "#0B1220", borderColor: "#1E2A44" }}
      >
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flap-font uppercase tracking-widest text-red-400 text-xs font-semibold">
                廣慈 / 奉天宮站
              </div>
              <div className="flap-font text-slate-100 text-xl font-semibold leading-tight">
                支援人力點位查詢系統
              </div>
            </div>
            <div className="flex rounded-full overflow-hidden border" style={{ borderColor: "#28395A" }}>
              <button
                onClick={() => setMode("lookup")}
                className="px-3 py-1.5 text-xs font-semibold transition"
                style={{
                  background: mode === "lookup" ? "#E3002B" : "transparent",
                  color: mode === "lookup" ? "#FFFFFF" : "#8FA3C4",
                }}
              >
                查詢
              </button>
              <button
                onClick={() => setMode("admin")}
                className="px-3 py-1.5 text-xs font-semibold transition"
                style={{
                  background: mode === "admin" ? "#E3002B" : "transparent",
                  color: mode === "admin" ? "#FFFFFF" : "#8FA3C4",
                }}
              >
                管理
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pb-16 pt-4">
        {mode === "lookup" ? (
          <LookupView
            availableDates={availableDates}
            selectedDate={selectedDate}
            setSelectedDate={(d) => {
              setSelectedDate(d);
              loadRecordsForDate(d);
            }}
            records={records}
            recordsLoading={recordsLoading}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            handleSearch={handleSearch}
            searched={searched}
            searchResults={searchResults}
            selectedResult={selectedResult}
            setSelectedResult={setSelectedResult}
          />
        ) : !adminAuthed ? (
          <PinGate
            pinInput={pinInput}
            setPinInput={setPinInput}
            pinError={pinError}
            handlePinSubmit={handlePinSubmit}
            lockedUntil={lockedUntil}
          />
        ) : (
          <AdminView
            availableDates={availableDates}
            uploadDateOverride={uploadDateOverride}
            setUploadDateOverride={setUploadDateOverride}
            fileInputRef={fileInputRef}
            handleFileChange={handleFileChange}
            uploadPreview={uploadPreview}
            uploadStatus={uploadStatus}
            uploadBusy={uploadBusy}
            confirmUpload={confirmUpload}
            cancelPreview={() => {
              setUploadPreview(null);
              setUploadStatus(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            deleteDate={deleteDate}
            deletingDate={deletingDate}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  查詢畫面                                                          */
/* ------------------------------------------------------------------ */
function LookupView({
  availableDates,
  selectedDate,
  setSelectedDate,
  records,
  recordsLoading,
  searchTerm,
  setSearchTerm,
  handleSearch,
  searched,
  searchResults,
  selectedResult,
  setSelectedResult,
}) {
  return (
    <div className="rise-in">
      <div className="flex items-center justify-between mb-4">
        <label className="text-xs text-slate-400 flap-font uppercase tracking-wider">
          查詢日期
        </label>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="text-sm rounded-md px-2 py-1 border tabular"
          style={{ background: "#131C30", color: "#E7EDF7", borderColor: "#28395A" }}
        >
          {availableDates.length === 0 ? (
            <option value="">（尚無名單）</option>
          ) : (
            availableDates.map((d) => (
              <option key={d} value={d}>
                {d}
                {d === todayStr() ? "（今日）" : ""}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="mb-2">
        <div
          className="flex items-center rounded-xl border px-3 py-2.5"
          style={{ background: "#111A2E", borderColor: "#28395A" }}
        >
          <span className="text-slate-500 mr-2">🔎</span>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder="輸入姓名或員工編號"
            className="flex-1 bg-transparent outline-none text-slate-100 placeholder-slate-500 text-base"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="ml-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{ background: "#E3002B", color: "#FFFFFF" }}
          >
            查詢
          </button>
        </div>
      </div>

      {recordsLoading && (
        <div className="text-slate-500 text-sm mt-6 text-center">名單讀取中…</div>
      )}

      {!recordsLoading && records.length === 0 && (
        <div
          className="mt-8 text-center rounded-xl border border-dashed p-6"
          style={{ borderColor: "#28395A" }}
        >
          <div className="text-slate-300 text-sm font-medium">
            {selectedDate || "當前日期"} 尚未上傳管制名單
          </div>
          <div className="text-slate-500 text-xs mt-1">請聯繫管理員確認當日名單是否已上傳。</div>
        </div>
      )}

      {!recordsLoading && searched && searchResults.length > 1 && !selectedResult && (
        <div className="mt-4 space-y-2">
          <div className="text-xs text-slate-400 mb-1">找到 {searchResults.length} 筆相符資料，請選擇：</div>
          {searchResults.map((r) => (
            <button
              key={r.id || `${r.name}-${r.empId}`}
              onClick={() => setSelectedResult(r)}
              className="w-full text-left rounded-lg border px-3 py-2.5 flex items-center justify-between"
              style={{ background: "#111A2E", borderColor: "#28395A" }}
            >
              <span className="text-slate-100 text-sm font-medium">{r.name}</span>
              <span className="text-slate-500 text-xs tabular">{r.empId}</span>
            </button>
          ))}
        </div>
      )}

      {!recordsLoading && searched && searchResults.length === 0 && (
        <div
          className="mt-6 text-center rounded-xl border p-6"
          style={{ borderColor: "#3B2A2A", background: "#1A1210" }}
        >
          <div className="text-red-300 text-sm font-medium">查無此姓名或員工編號</div>
          <div className="text-slate-500 text-xs mt-1">
            請確認輸入內容或當日日期是否正確，如有疑問請聯繫現場管理人員。
          </div>
        </div>
      )}

      {selectedResult && (
        <div className="mt-5 rise-in">
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ borderColor: "#2E4066", background: "#101A30" }}
          >
            <div
              className="px-4 py-2 flex items-center justify-between text-xs flap-font tracking-wider uppercase"
              style={{ background: "#1B2740", color: "#8FA3C4" }}
            >
              <span>管制點位</span>
              <span className="tabular">{selectedResult.date}</span>
            </div>
            
            <div className="px-5 py-5">
              <div className="text-slate-400 text-xs mb-1">{selectedResult.empId}</div>
              <div className="text-slate-100 text-lg font-semibold mb-4">{selectedResult.name}</div>

              {selectedResult.group && (
                <div className="mb-3">
                  <div className="text-slate-500 text-xs mb-0.5 tracking-wide">組別</div>
                  <div className="text-amber-300 font-semibold text-base">
                    {selectedResult.group}
                  </div>
                </div>
              )}

              <div className="mb-4">
                <div className="text-slate-500 text-xs mb-1 tracking-wide">管制點位</div>
                <FlapText
                  text={selectedResult.checkpoint || "（未指定）"}
                  className="flap-font block text-3xl font-bold tracking-wide"
                  style={{ color: "#E3002B" }}
                />
              </div>

              <div>
                <div className="text-slate-500 text-xs mb-1 tracking-wide">工作內容</div>
                <div className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                  {selectedResult.workContent || "（未提供）"}
                </div>
              </div>
            </div>
          </div>
          {searchResults.length > 1 && (
            <button
              onClick={() => setSelectedResult(null)}
              className="mt-3 text-xs text-slate-400 underline"
            >
              ← 返回選擇其他相符結果
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PinGate({ pinInput, setPinInput, pinError, handlePinSubmit, lockedUntil }) {
  const isLocked = !!(lockedUntil && lockedUntil > Date.now());
  const [showPin, setShowPin] = useState(false);
  return (
    <div className="mt-10 rise-in">
      <div
        className="rounded-2xl border p-6 text-center"
        style={{ borderColor: isLocked ? "#5B2A2A" : "#28395A", background: "#111A2E" }}
      >
        <div className="text-slate-300 text-sm mb-4">
          {isLocked ? "此裝置已暫時鎖定管理登入" : "請輸入管理員 PIN 以上傳 / 管理名單"}
        </div>
        <div className="relative">
          <input
            type={showPin ? "text" : "password"}
            inputMode="numeric"
            value={pinInput}
            disabled={isLocked}
            onChange={(e) => setPinInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePinSubmit(e);
            }}
            className="w-full text-center tracking-[0.5em] text-xl rounded-lg px-3 py-2 outline-none border disabled:opacity-40"
            style={{ background: "#0B1220", color: "#E7EDF7", borderColor: "#28395A" }}
            placeholder="••••"
          />
          <button
            type="button"
            onClick={() => setShowPin((v) => !v)}
            disabled={isLocked}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 disabled:opacity-40"
          >
            {showPin ? "隱藏" : "顯示"}
          </button>
        </div>
        {pinError && (
          <div className={`text-xs mt-2 ${isLocked ? "text-red-300" : "text-red-400"}`}>
            {pinError}
          </div>
        )}
        <button
          type="button"
          onClick={handlePinSubmit}
          disabled={isLocked}
          className="mt-4 w-full py-2.5 rounded-lg font-semibold text-sm disabled:opacity-40"
          style={{ background: "#E3002B", color: "#FFFFFF" }}
        >
          {isLocked ? "登入已鎖定" : "進入管理後台"}
        </button>
        <div className="text-slate-600 text-xs mt-3">
          連續輸入錯誤 {MAX_PIN_ATTEMPTS} 次將鎖定此裝置 {LOCKOUT_MINUTES} 分鐘
        </div>
      </div>
    </div>
  );
}

function AdminView({
  availableDates,
  uploadDateOverride,
  setUploadDateOverride,
  fileInputRef,
  handleFileChange,
  uploadPreview,
  uploadStatus,
  uploadBusy,
  confirmUpload,
  cancelPreview,
  deleteDate,
  deletingDate,
}) {
  return (
    <div className="rise-in space-y-6">
      <div className="rounded-2xl border p-4" style={{ borderColor: "#28395A", background: "#111A2E" }}>
        <div className="flap-font text-slate-100 text-sm font-semibold uppercase tracking-wider mb-3">
          上傳每日名單
        </div>

        <div className="mb-3">
          <label className="text-xs text-slate-400 block mb-1">
            預設日期（若 Excel 內無「日期」欄位時套用）
          </label>
          <input
            type="date"
            value={uploadDateOverride}
            onChange={(e) => setUploadDateOverride(e.target.value)}
            className="rounded-md px-2 py-1.5 border text-sm tabular"
            style={{ background: "#0B1220", color: "#E7EDF7", borderColor: "#28395A" }}
          />
        </div>

        <label
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 cursor-pointer transition hover:border-red-400"
          style={{ borderColor: "#28395A" }}
        >
          <span className="text-slate-300 text-sm font-medium mb-1">點擊選擇 Excel 檔案</span>
          <span className="text-slate-500 text-xs">
            欄位建議：日期（選填）／組別／姓名／員工編號／點位／工作內容
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {uploadBusy && <div className="text-slate-400 text-xs mt-3">處理中…</div>}

        {uploadStatus && (
          <div
            className="mt-3 text-xs rounded-md px-3 py-2"
            style={{
              background: uploadStatus.type === "error" ? "#1A1210" : "#0D2A22",
              color: uploadStatus.type === "error" ? "#F87171" : "#3DD9A8",
            }}
          >
            {uploadStatus.msg}
          </div>
        )}

        {/* 預覽表格包含組別欄位 */}
        {uploadPreview && (
          <div className="mt-4">
            <div className="text-slate-300 text-xs mb-2">
              預覽（共 {uploadPreview.length} 筆），確認無誤後送出：
            </div>
            <div
              className="max-h-56 overflow-y-auto rounded-lg border"
              style={{ borderColor: "#28395A" }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500" style={{ background: "#0B1220" }}>
                    <th className="text-left px-2 py-1.5 font-medium">日期</th>
                    <th className="text-left px-2 py-1.5 font-medium">組別</th>
                    <th className="text-left px-2 py-1.5 font-medium">姓名</th>
                    <th className="text-left px-2 py-1.5 font-medium">員編</th>
                    <th className="text-left px-2 py-1.5 font-medium">點位</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadPreview.map((r) => (
                    <tr key={r.id} className="border-t" style={{ borderColor: "#1E2A44" }}>
                      <td className="px-2 py-1.5 text-slate-400 tabular">{r.date}</td>
                      <td className="px-2 py-1.5 text-amber-300">{r.group || "—"}</td>
                      <td className="px-2 py-1.5 text-slate-200">{r.name}</td>
                      <td className="px-2 py-1.5 text-slate-400 tabular">{r.empId}</td>
                      <td className="px-2 py-1.5 text-slate-200">{r.checkpoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={confirmUpload}
                disabled={uploadBusy}
                className="flex-1 py-2 rounded-lg font-semibold text-sm disabled:opacity-50"
                style={{ background: "#E3002B", color: "#FFFFFF" }}
              >
                確認送出
              </button>
              <button
                onClick={cancelPreview}
                className="px-4 py-2 rounded-lg font-semibold text-sm"
                style={{ background: "#1B2740", color: "#8FA3C4" }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border p-4" style={{ borderColor: "#28395A", background: "#111A2E" }}>
        <div className="flap-font text-slate-100 text-sm font-semibold uppercase tracking-wider mb-3">
          已上傳名單
        </div>
        {availableDates.length === 0 ? (
          <div className="text-slate-500 text-xs">目前尚無任何日期的名單資料。</div>
        ) : (
          <div className="space-y-2">
            {availableDates.map((d) => (
              <div
                key={d}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: "#0B1220" }}
              >
                <span className="text-slate-200 text-sm tabular">
                  {d}
                  {d === todayStr() ? " (今日)" : ""}
                </span>
                <button
                  onClick={() => deleteDate(d)}
                  disabled={deletingDate === d}
                  className="text-xs text-red-400 disabled:opacity-50"
                >
                  {deletingDate === d ? "刪除中…" : "刪除"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-slate-600 text-xs text-center">
        此名單資料所有使用者皆可查詢，請確認上傳內容不含非必要之個人資料。
      </div>
    </div>
  );
}
