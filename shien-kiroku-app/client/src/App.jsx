import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Search, Trash2, Pencil, X, Check, Phone, Cake, FileText, Loader2,
  Home, Download, History, UserCircle2, AlertTriangle, LogOut, Shield,
  Utensils, Moon, Pill, ArrowLeft, Users, Lock, ClipboardList, BarChart3, ChevronLeft, ChevronRight,
} from "lucide-react";
import { api, getToken, setToken, downloadExport } from "./api";

// ---- トークン --------------------------------------------------------
const COLORS = {
  bg: "#F7F5EF", surface: "#FFFFFF", ink: "#26313C", inkSoft: "#5B6672",
  primary: "#2F5D62", primaryDark: "#1F4448", gold: "#B98B34", rose: "#B15A52",
  moss: "#6B8F71", line: "#DDD6C7", lineSoft: "#EAE5D8", blue: "#4C6FA1",
};
const HOME_PALETTE = [COLORS.primary, COLORS.gold, COLORS.rose, COLORS.moss, COLORS.blue, "#8A6BA1", "#A16B4C", "#5E8AA1"];
function homeColor(homeId, homes) {
  const idx = homes.findIndex((h) => h.id === homeId);
  return HOME_PALETTE[(idx < 0 ? 0 : idx) % HOME_PALETTE.length];
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const RECORD_TYPES = {
  support: {
    key: "support", label: "利用者支援記録", icon: FileText, color: COLORS.primary,
    fields: [
      { key: "category", label: "種別", type: "select", options: ["支援記録", "面談記録", "通院同行", "家族連絡", "その他"], required: true },
      { key: "content", label: "内容", type: "textarea", required: true, main: true },
    ],
  },
  meal: {
    key: "meal", label: "食事記録", icon: Utensils, color: COLORS.gold,
    fields: [
      { key: "mealType", label: "区分", type: "select", options: ["朝食", "昼食", "夕食", "間食"], required: true },
      { key: "staple", label: "主食摂取量", type: "select", options: ["全量", "8割", "半量", "2割", "未摂取"], required: true },
      { key: "side", label: "副食摂取量", type: "select", options: ["全量", "8割", "半量", "2割", "未摂取"], required: true },
      { key: "water", label: "水分摂取(ml)", type: "number" },
      { key: "notes", label: "特記事項", type: "textarea", main: true },
    ],
  },
  stay: {
    key: "stay", label: "宿泊記録", icon: Moon, color: COLORS.blue,
    fields: [
      { key: "bedtime", label: "就寝時刻", type: "time" },
      { key: "waketime", label: "起床時刻", type: "time" },
      { key: "condition", label: "夜間の様子", type: "select", options: ["良眠", "中途覚醒あり", "不眠", "巡視のみ"], required: true },
      { key: "notes", label: "特記事項", type: "textarea", main: true },
    ],
  },
  medication: {
    key: "medication", label: "服薬記録", icon: Pill, color: COLORS.rose,
    fields: [
      { key: "timing", label: "服薬タイミング", type: "select", options: ["朝", "昼", "夕", "就寝前", "頓服"], required: true },
      { key: "medicationName", label: "薬品名", type: "text", required: true },
      { key: "dosage", label: "用量", type: "text" },
      { key: "administered", label: "服薬確認", type: "select", options: ["確認済み", "未確認", "拒否・未服用"], required: true },
      { key: "notes", label: "備考", type: "textarea" },
    ],
  },
};
const RECORD_TYPE_ORDER = ["support", "meal", "stay", "medication"];

// ---- 実績記録（サービス提供・加算） --------------------------------------
const USAGE_FIELDS = [
  { key: "hospitalization", label: "入院" },
  { key: "outingStay", label: "外泊" },
  { key: "trialUse", label: "体験利用" },
  { key: "offSiteUse", label: "住居外利用" },
  { key: "postDischargeSupport", label: "退居後支援" },
  { key: "nightSupport", label: "夜間支援体制加算" },
  { key: "hospitalSupportSpecial", label: "入院時支援特別加算" },
  { key: "longHospitalSupportSpecial", label: "長期入院時支援特別加算" },
  { key: "homecomingSupport", label: "帰宅時支援加算" },
  { key: "longHomecomingSupport", label: "長期帰宅時支援加算" },
  { key: "daytimeSupport", label: "日中支援加算" },
  { key: "medicalCoordination7", label: "医療連携体制加算(Ⅶ)" },
  { key: "medicalCoordination", label: "医療連携体制加算" },
  { key: "independentLiving1", label: "自立生活支援加算(Ⅰ)" },
  { key: "independentLiving2", label: "自立生活支援加算(Ⅱ)" },
  { key: "intensiveSupport", label: "集中的支援加算" },
];
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

function todayMonthStr() { return new Date().toISOString().slice(0, 7); }
function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function defaultUsageDay() {
  const flags = { serviceProvided: true };
  USAGE_FIELDS.forEach((f) => { flags[f.key] = false; });
  return { flags, notes: "" };
}

const SUMMARY_COLUMNS = [
  { label: "サービス有日数", get: (s) => s.serviceProvidedDays },
  { label: "入院日数", get: (s) => s.hospitalizationDays },
  { label: "入院の最終日", get: (s) => s.hospitalizationLastDate || "-", isDate: true },
  { label: "外泊日数", get: (s) => s.outingStayDays },
  { label: "外泊の最終日", get: (s) => s.outingStayLastDate || "-", isDate: true },
  { label: "体験利用日数", get: (s) => s.trialUseDays },
  { label: "体験利用の最終日", get: (s) => s.trialUseLastDate || "-", isDate: true },
  { label: "住居外利用数", get: (s) => s.offSiteUseDays },
  { label: "退居後支援", get: (s) => s.postDischargeSupportDays },
  { label: "夜間支援体制加算", get: (s) => s.nightSupportDays },
  { label: "入院時支援特別加算", get: (s) => s.hospitalSupportSpecialDays },
  { label: "長期入院時支援特別加算", get: (s) => s.longHospitalSupportSpecialDays },
  { label: "帰宅時支援加算", get: (s) => s.homecomingSupportDays },
  { label: "長期帰宅時支援加算", get: (s) => s.longHomecomingSupportDays },
  { label: "日中支援", get: (s) => s.daytimeSupportDays },
  { label: "医療連携体制加算(Ⅶ)", get: (s) => s.medicalCoordination7Days },
  { label: "医療連携体制加算", get: (s) => s.medicalCoordinationDays },
  { label: "自立生活支援加算(Ⅰ)", get: (s) => s.independentLiving1Days },
  { label: "自立生活支援加算(Ⅱ)", get: (s) => s.independentLiving2Days },
  { label: "集中的支援加算", get: (s) => s.intensiveSupportDays },
];

const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap');
    .skn-root { font-family: 'Zen Kaku Gothic New', sans-serif; color: ${COLORS.ink}; background: ${COLORS.bg}; }
    .skn-serif { font-family: 'Shippori Mincho', serif; }
    .skn-tab { border-left: 4px solid transparent; transition: all .15s ease; }
    .skn-tab.active { background: ${COLORS.surface}; border-left-color: var(--tabcolor); box-shadow: 0 1px 3px rgba(38,49,60,0.08); }
    .skn-tab:hover:not(.active) { background: #F0ECDF; }
    .skn-chip { font-family: 'Zen Kaku Gothic New', sans-serif; font-size: 12px; padding: 2px 9px; border-radius: 999px; display: inline-block; }
    .skn-btn-primary { background: ${COLORS.primary}; color: #fff; }
    .skn-btn-primary:hover { background: ${COLORS.primaryDark}; }
    .skn-input { background: #fff; border: 1px solid ${COLORS.line}; }
    .skn-input:focus { outline: 2px solid ${COLORS.primary}; outline-offset: 1px; }
    .skn-card { background: ${COLORS.surface}; border: 1px solid ${COLORS.lineSoft}; }
    .skn-scroll::-webkit-scrollbar { width: 6px; }
    .skn-scroll::-webkit-scrollbar-thumb { background: ${COLORS.line}; border-radius: 3px; }
    .skn-modal-backdrop { background: rgba(38,49,60,0.45); }
    .skn-typetab { border-bottom: 3px solid transparent; }
    .skn-typetab.active { border-bottom-color: var(--tc); color: var(--tc); }
  `}</style>
);

function Avatar({ name, color, small }) {
  const initial = (name || "?").trim().charAt(0);
  const size = small ? "w-8 h-8 text-sm" : "w-10 h-10 text-base";
  return (
    <div className={`${size} rounded-full flex items-center justify-center flex-shrink-0 skn-serif font-bold`} style={{ background: color, color: "#fff" }}>
      {initial}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 skn-modal-backdrop flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`skn-card rounded-lg p-5 w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] overflow-y-auto skn-scroll`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="skn-serif text-lg font-bold" style={{ color: COLORS.primaryDark }}>{title}</h3>
          <button onClick={onClose} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="text-xs p-2 rounded mb-2 flex items-center gap-1.5" style={{ background: COLORS.rose + "1A", color: COLORS.rose }}><AlertTriangle size={13} /> {message}</div>;
}

// ---- ログイン画面 -------------------------------------------------------
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await api.post("/auth/login", { username: username.trim(), password });
      setToken(res.token);
      onLogin(res.account);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="skn-root min-h-screen flex items-center justify-center p-4">
      <FontStyle />
      <form onSubmit={submit} className="skn-card rounded-lg p-8 w-full max-w-sm space-y-4">
        <div className="text-center mb-2">
          <h1 className="skn-serif text-2xl font-bold" style={{ color: COLORS.primaryDark }}>支援記録ノート</h1>
          <p className="text-xs mt-1" style={{ color: COLORS.inkSoft }}>スタッフアカウントでログインしてください</p>
        </div>
        <label className="text-sm block"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>ユーザー名</span>
          <input className="skn-input w-full rounded px-3 py-2 text-sm" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></label>
        <label className="text-sm block"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>パスワード</span>
          <input type="password" className="skn-input w-full rounded px-3 py-2 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="text-xs" style={{ color: COLORS.rose }}>{error}</p>}
        <button type="submit" disabled={loading} className="skn-btn-primary w-full rounded py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} ログイン
        </button>
      </form>
    </div>
  );
}

// ---- ホーム選択画面 -------------------------------------------------------
function HomeSelectScreen({ account, homes, onSelect, onLogout, onManage }) {
  return (
    <div className="skn-root min-h-screen flex flex-col items-center justify-center p-4">
      <FontStyle />
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs" style={{ color: COLORS.inkSoft }}>ようこそ</p>
            <h1 className="skn-serif text-xl font-bold" style={{ color: COLORS.primaryDark }}>
              {account.displayName} さん{account.role === "admin" && <span className="ml-2 text-xs align-middle px-2 py-0.5 rounded" style={{ background: COLORS.gold + "22", color: COLORS.gold }}>管理者</span>}
            </h1>
          </div>
          <button onClick={onLogout} className="text-sm flex items-center gap-1 px-3 py-1.5 rounded" style={{ color: COLORS.inkSoft, border: `1px solid ${COLORS.line}` }}><LogOut size={14} /> ログアウト</button>
        </div>
        <p className="skn-serif text-lg font-bold mb-3" style={{ color: COLORS.primaryDark }}>担当するホームを選択してください</p>
        {homes.length === 0 && (
          <div className="skn-card rounded-lg p-6 text-center">
            <p className="text-sm mb-3" style={{ color: COLORS.inkSoft }}>まだホームが登録されていません</p>
            {account.role === "admin" && <button onClick={onManage} className="skn-btn-primary px-4 py-2 rounded text-sm inline-flex items-center gap-1"><Home size={14} /> ホームを登録する</button>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {homes.map((h) => (
            <button key={h.id} onClick={() => onSelect(h.id)} className="skn-card rounded-lg p-4 text-left hover:shadow-md transition-shadow relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: homeColor(h.id, homes) }} />
              <p className="skn-serif font-bold pl-2">{h.name}</p>
              {h.address && <p className="text-xs pl-2 mt-0.5" style={{ color: COLORS.inkSoft }}>{h.address}</p>}
            </button>
          ))}
        </div>
        {account.role === "admin" && homes.length > 0 && (
          <button onClick={onManage} className="text-xs mt-4 underline" style={{ color: COLORS.inkSoft }}>管理者メニューを開く</button>
        )}
      </div>
    </div>
  );
}

// ---- アカウント管理 -------------------------------------------------------
function AccountManager({ currentAccountId }) {
  const [accounts, setAccounts] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [newForm, setNewForm] = useState({ username: "", password: "", displayName: "", role: "staff" });
  const [msg, setMsg] = useState("");

  const load = useCallback(() => { api.get("/accounts").then((r) => setAccounts(r.accounts)).catch((e) => setMsg(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  if (!accounts) return <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>;
  const adminCount = accounts.filter((a) => a.role === "admin").length;
  const startEdit = (a) => { setEditingId(a.id); setForm({ username: a.username, password: "", displayName: a.displayName, role: a.role }); };

  const submitNew = async () => {
    if (!newForm.username.trim() || !newForm.password.trim() || !newForm.displayName.trim()) return;
    try {
      await api.post("/accounts", { ...newForm, username: newForm.username.trim(), displayName: newForm.displayName.trim() });
      setNewForm({ username: "", password: "", displayName: "", role: "staff" });
      setMsg(""); load();
    } catch (e) { setMsg(e.message); }
  };

  const submitEdit = async (a) => {
    try {
      await api.put(`/accounts/${a.id}`, { username: form.username.trim(), password: form.password || undefined, displayName: form.displayName.trim(), role: form.role });
      setEditingId(null); setMsg(""); load();
    } catch (e) { setMsg(e.message); }
  };

  const remove = async (a) => {
    try { await api.del(`/accounts/${a.id}`); load(); } catch (e) { setMsg(e.message); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner message={msg} />
      {accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between p-2.5 rounded" style={{ border: `1px solid ${COLORS.lineSoft}` }}>
          {editingId === a.id ? (
            <div className="flex-1 grid grid-cols-4 gap-2 mr-2">
              <input className="skn-input rounded px-2 py-1 text-sm" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="表示名" />
              <input className="skn-input rounded px-2 py-1 text-sm" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ユーザー名" />
              <input className="skn-input rounded px-2 py-1 text-sm" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="新パスワード(空欄で維持)" />
              <select className="skn-input rounded px-2 py-1 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">スタッフ</option><option value="admin">管理者</option>
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              {a.role === "admin" ? <Shield size={15} color={COLORS.gold} /> : <Users size={15} color={COLORS.inkSoft} />}
              <div>
                <p className="text-sm font-medium">{a.displayName} <span className="text-xs font-normal" style={{ color: COLORS.inkSoft }}>@{a.username}</span></p>
                <p className="text-[11px]" style={{ color: COLORS.inkSoft }}>{a.role === "admin" ? "管理者" : "スタッフ"}{a.id === currentAccountId && "（ログイン中）"}</p>
              </div>
            </div>
          )}
          <div className="flex gap-1 flex-shrink-0">
            {editingId === a.id ? (
              <>
                <button onClick={() => submitEdit(a)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.primary }}><Check size={15} /></button>
                <button onClick={() => setEditingId(null)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><X size={15} /></button>
              </>
            ) : (
              <>
                <button onClick={() => startEdit(a)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><Pencil size={14} /></button>
                <button onClick={() => remove(a)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.rose }}><Trash2 size={14} /></button>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="pt-3" style={{ borderTop: `1px solid ${COLORS.lineSoft}` }}>
        <p className="text-xs mb-2 font-medium" style={{ color: COLORS.inkSoft }}>新しいアカウントを発行</p>
        <div className="grid grid-cols-4 gap-2">
          <input className="skn-input rounded px-2 py-1.5 text-sm" placeholder="表示名" value={newForm.displayName} onChange={(e) => setNewForm({ ...newForm, displayName: e.target.value })} />
          <input className="skn-input rounded px-2 py-1.5 text-sm" placeholder="ユーザー名" value={newForm.username} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} />
          <input className="skn-input rounded px-2 py-1.5 text-sm" placeholder="パスワード" value={newForm.password} onChange={(e) => setNewForm({ ...newForm, password: e.target.value })} />
          <select className="skn-input rounded px-2 py-1.5 text-sm" value={newForm.role} onChange={(e) => setNewForm({ ...newForm, role: e.target.value })}>
            <option value="staff">スタッフ</option><option value="admin">管理者</option>
          </select>
        </div>
        <button onClick={submitNew} className="skn-btn-primary mt-2 px-4 py-1.5 rounded text-sm flex items-center gap-1"><Plus size={14} /> アカウントを発行</button>
      </div>
    </div>
  );
}

// ---- ホーム管理 ---------------------------------------------------------
function HomeManagerPanel({ homes, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", address: "", capacity: "" });
  const [newForm, setNewForm] = useState({ name: "", address: "", capacity: "" });
  const [msg, setMsg] = useState("");
  const startEdit = (h) => { setEditingId(h.id); setForm({ name: h.name, address: h.address || "", capacity: h.capacity || "" }); };

  const submitNew = async () => {
    if (!newForm.name.trim()) return;
    try { await api.post("/homes", newForm); setNewForm({ name: "", address: "", capacity: "" }); setMsg(""); onChanged(); }
    catch (e) { setMsg(e.message); }
  };
  const submitEdit = async (h) => {
    try { await api.put(`/homes/${h.id}`, form); setEditingId(null); onChanged(); }
    catch (e) { setMsg(e.message); }
  };
  const remove = async (h) => {
    try { await api.del(`/homes/${h.id}`); onChanged(); }
    catch (e) { setMsg(e.message); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner message={msg} />
      {homes.length === 0 && <p className="text-sm" style={{ color: COLORS.inkSoft }}>まだホームが登録されていません。</p>}
      {homes.map((h) => (
        <div key={h.id} className="flex items-center justify-between p-2.5 rounded" style={{ border: `1px solid ${COLORS.lineSoft}` }}>
          {editingId === h.id ? (
            <div className="flex-1 grid grid-cols-3 gap-2 mr-2">
              <input className="skn-input rounded px-2 py-1 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ホーム名" />
              <input className="skn-input rounded px-2 py-1 text-sm" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="住所" />
              <input className="skn-input rounded px-2 py-1 text-sm" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="定員" />
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: homeColor(h.id, homes) }} />
              <div>
                <p className="text-sm font-medium">{h.name}{h.capacity && <span className="ml-2 text-xs font-normal" style={{ color: COLORS.inkSoft }}>定員{h.capacity}名</span>}</p>
                {h.address && <p className="text-xs" style={{ color: COLORS.inkSoft }}>{h.address}</p>}
              </div>
            </div>
          )}
          <div className="flex gap-1 flex-shrink-0">
            {editingId === h.id ? (
              <>
                <button onClick={() => submitEdit(h)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.primary }}><Check size={15} /></button>
                <button onClick={() => setEditingId(null)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><X size={15} /></button>
              </>
            ) : (
              <>
                <button onClick={() => startEdit(h)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><Pencil size={14} /></button>
                <button onClick={() => remove(h)} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.rose }}><Trash2 size={14} /></button>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="pt-3" style={{ borderTop: `1px solid ${COLORS.lineSoft}` }}>
        <p className="text-xs mb-2 font-medium" style={{ color: COLORS.inkSoft }}>新しいホームを追加</p>
        <div className="grid grid-cols-3 gap-2">
          <input className="skn-input rounded px-2 py-1.5 text-sm" placeholder="ホーム名（例：さくら荘）" value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} />
          <input className="skn-input rounded px-2 py-1.5 text-sm" placeholder="住所" value={newForm.address} onChange={(e) => setNewForm({ ...newForm, address: e.target.value })} />
          <input className="skn-input rounded px-2 py-1.5 text-sm" placeholder="定員" value={newForm.capacity} onChange={(e) => setNewForm({ ...newForm, capacity: e.target.value })} />
        </div>
        <button disabled={!newForm.name.trim()} onClick={submitNew} className="skn-btn-primary mt-2 px-4 py-1.5 rounded text-sm flex items-center gap-1 disabled:opacity-40"><Plus size={14} /> ホームを追加</button>
      </div>
    </div>
  );
}

// ---- 利用者フォーム -------------------------------------------------------
function UserForm({ initial, homes, defaultHomeId, onCancel, onSave }) {
  const [form, setForm] = useState(initial || { name: "", kana: "", birthDate: "", homeId: defaultHomeId || homes[0]?.id || "", contact: "" });
  const [saving, setSaving] = useState(false);
  const canSave = form.name.trim().length > 0 && form.homeId && !saving;
  const submit = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };

  return (
    <div className="p-5 skn-card rounded-lg space-y-3">
      <h3 className="skn-serif text-lg font-bold" style={{ color: COLORS.primaryDark }}>{initial ? "基本情報を編集" : "利用者を追加"}</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm col-span-2"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>氏名 <span style={{ color: COLORS.rose }}>*</span></span>
          <input className="skn-input w-full rounded px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例）山田 太郎" /></label>
        <label className="text-sm col-span-2"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>ふりがな</span>
          <input className="skn-input w-full rounded px-3 py-2 text-sm" value={form.kana} onChange={(e) => setForm({ ...form, kana: e.target.value })} placeholder="やまだ たろう" /></label>
        <label className="text-sm"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>生年月日</span>
          <input type="date" className="skn-input w-full rounded px-3 py-2 text-sm" value={form.birthDate || ""} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></label>
        <label className="text-sm"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>所属ホーム <span style={{ color: COLORS.rose }}>*</span></span>
          <select className="skn-input w-full rounded px-3 py-2 text-sm" value={form.homeId} onChange={(e) => setForm({ ...form, homeId: e.target.value })}>
            {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select></label>
        <label className="text-sm col-span-2"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>連絡先</span>
          <input className="skn-input w-full rounded px-3 py-2 text-sm" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="電話番号など" /></label>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded text-sm flex items-center gap-1" style={{ color: COLORS.inkSoft, border: `1px solid ${COLORS.line}` }}><X size={14} /> キャンセル</button>
        <button disabled={!canSave} onClick={submit} className="skn-btn-primary px-4 py-2 rounded text-sm flex items-center gap-1 disabled:opacity-40">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 保存する</button>
      </div>
    </div>
  );
}

// ---- 記録：汎用フィールド描画 ---------------------------------------------
function FieldInput({ field, value, onChange }) {
  const common = "skn-input rounded px-2 py-1.5 text-sm";
  if (field.type === "select") return (
    <select className={common} value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">選択してください</option>
      {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  if (field.type === "textarea") return <textarea className={`${common} w-full min-h-[60px]`} placeholder={field.label} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === "number") return <input type="number" className={common} placeholder={field.label} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === "time") return <input type="time" className={common} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
  return <input type="text" className={common} placeholder={field.label} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
}
function emptyValues(schema) { return Object.fromEntries(schema.fields.map((f) => [f.key, ""])); }

function RecordForm({ schema, onAdd, currentStaff }) {
  const [date, setDate] = useState(todayStr());
  const [values, setValues] = useState(emptyValues(schema));
  const [saving, setSaving] = useState(false);
  const canSave = currentStaff && !saving && schema.fields.every((f) => !f.required || String(values[f.key] || "").trim());

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try { await onAdd({ date, data: values }); setValues(emptyValues(schema)); }
    finally { setSaving(false); }
  };

  return (
    <div className="skn-card rounded-lg p-4 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input type="date" className="skn-input rounded px-2 py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        {schema.fields.filter((f) => !f.main).map((f) => (
          <div key={f.key} className="flex flex-col"><FieldInput field={f} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} /></div>
        ))}
        {currentStaff && <span className="text-xs px-2 py-1.5 rounded flex items-center gap-1 ml-auto" style={{ color: COLORS.inkSoft }}><UserCircle2 size={14} /> 記録者：{currentStaff}</span>}
      </div>
      {schema.fields.filter((f) => f.main).map((f) => (
        <FieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
      ))}
      <div className="flex justify-end">
        <button disabled={!canSave} onClick={submit} className="px-4 py-1.5 rounded text-sm flex items-center gap-1 disabled:opacity-40 text-white" style={{ background: schema.color }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 記録を追加
        </button>
      </div>
    </div>
  );
}

function DataSummary({ schema, data }) {
  const main = schema.fields.find((f) => f.main);
  const chips = schema.fields.filter((f) => !f.main && data[f.key]);
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        {chips.map((f) => <span key={f.key} className="skn-chip" style={{ background: schema.color + "1A", color: schema.color, border: `1px solid ${schema.color}55` }}>{f.label}：{data[f.key]}</span>)}
      </div>
      {main && data[main.key] && <p className="text-sm whitespace-pre-wrap leading-relaxed">{data[main.key]}</p>}
    </>
  );
}

function RecordCard({ schema, record, currentStaff, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.data);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasHistory = record.editHistory && record.editHistory.length > 0;
  const canSaveEdit = schema.fields.every((f) => !f.required || String(draft[f.key] || "").trim());

  const saveEdit = async () => {
    setSaving(true);
    try { await onEdit(draft); setEditing(false); } finally { setSaving(false); }
  };

  return (
    <div className="skn-card rounded-lg p-3.5 group">
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-y-1">
        <span className="text-xs" style={{ color: COLORS.inkSoft }}>対象日 {record.date}</span>
        <div className="flex items-center gap-1">
          {!editing && <button onClick={() => { setDraft(record.data); setEditing(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><Pencil size={13} /></button>}
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><Trash2 size={13} /></button>
          ) : (
            <span className="text-xs flex items-center gap-1">
              <button onClick={onDelete} className="underline" style={{ color: COLORS.rose }}>削除する</button>
              <button onClick={() => setConfirmDel(false)} className="underline" style={{ color: COLORS.inkSoft }}>取消</button>
            </span>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          {schema.fields.map((f) => (
            <div key={f.key}>
              <span className="text-[11px]" style={{ color: COLORS.inkSoft }}>{f.label}</span>
              <FieldInput field={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded" style={{ color: COLORS.inkSoft, border: `1px solid ${COLORS.line}` }}>キャンセル</button>
            <button disabled={!canSaveEdit || !currentStaff || saving} onClick={saveEdit} className="text-xs px-3 py-1.5 rounded disabled:opacity-40 text-white" style={{ background: schema.color }}>修正を保存</button>
          </div>
        </div>
      ) : <DataSummary schema={schema} data={record.data} />}

      <div className="mt-2 pt-2 flex items-center justify-between flex-wrap gap-1" style={{ borderTop: `1px dashed ${COLORS.lineSoft}` }}>
        <p className="text-[11px]" style={{ color: COLORS.inkSoft }}>
          登録：{fmtDateTime(record.createdAt)}（{record.createdBy}）
          {record.lastEditedAt && <> ／ 修正：{fmtDateTime(record.lastEditedAt)}（{record.lastEditedBy}）</>}
        </p>
        {hasHistory && <button onClick={() => setShowHistory((s) => !s)} className="text-[11px] flex items-center gap-1 underline" style={{ color: COLORS.inkSoft }}><History size={11} /> 修正履歴（{record.editHistory.length}件）</button>}
      </div>

      {showHistory && (
        <div className="mt-2 space-y-2 pl-3" style={{ borderLeft: `2px solid ${COLORS.lineSoft}` }}>
          {record.editHistory.slice().reverse().map((h, i) => (
            <div key={i} className="text-[11px]" style={{ color: COLORS.inkSoft }}>
              <p className="font-medium mb-0.5">{fmtDateTime(h.editedAt)}（{h.editedBy}）による修正前の内容：</p>
              <DataSummary schema={schema} data={h.previousData} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 出力（CSV）パネル ----------------------------------------------------
function ExportPanel({ homes }) {
  const [typeKey, setTypeKey] = useState("support");
  const [homeId, setHomeId] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [msg, setMsg] = useState("");

  const doExport = async () => {
    try {
      const params = { type: typeKey };
      if (homeId !== "all") params.homeId = homeId;
      if (start) params.start = start;
      if (end) params.end = end;
      await downloadExport(params);
    } catch (e) { setMsg(e.message); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner message={msg} />
      <label className="text-sm block"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>記録種別</span>
        <select className="skn-input w-full rounded px-3 py-2 text-sm" value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
          {RECORD_TYPE_ORDER.map((k) => <option key={k} value={k}>{RECORD_TYPES[k].label}</option>)}
        </select></label>
      <label className="text-sm block"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>ホーム</span>
        <select className="skn-input w-full rounded px-3 py-2 text-sm" value={homeId} onChange={(e) => setHomeId(e.target.value)}>
          <option value="all">すべてのホーム</option>
          {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm block"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>開始日</span>
          <input type="date" className="skn-input w-full rounded px-3 py-2 text-sm" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm block"><span className="block mb-1" style={{ color: COLORS.inkSoft }}>終了日</span>
          <input type="date" className="skn-input w-full rounded px-3 py-2 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <div className="flex justify-end">
        <button onClick={doExport} className="skn-btn-primary px-4 py-2 rounded text-sm flex items-center gap-1"><Download size={14} /> CSVをダウンロード</button>
      </div>
    </div>
  );
}

// ---- 月選択 -------------------------------------------------------------
function MonthPicker({ month, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(shiftMonth(month, -1))} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><ChevronLeft size={16} /></button>
      <input type="month" className="skn-input rounded px-2 py-1.5 text-sm" value={month} onChange={(e) => onChange(e.target.value)} />
      <button onClick={() => onChange(shiftMonth(month, 1))} className="p-1.5 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><ChevronRight size={16} /></button>
    </div>
  );
}

// ---- 実績記録（利用者ごとの日別入力表） -----------------------------------
function UsageTable({ residentId, currentStaff }) {
  const [month, setMonth] = useState(todayMonthStr());
  const [days, setDays] = useState(null); // { "2026-07-01": {flags, notes, updatedBy, updatedAt} }
  const [savingDate, setSavingDate] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get(`/residents/${residentId}/usage?month=${month}`).then((r) => {
      const map = {};
      r.records.forEach((rec) => { map[rec.date] = rec; });
      setDays(map);
    }).catch((e) => setError(e.message));
  }, [residentId, month]);
  useEffect(() => { setDays(null); load(); }, [load]);

  const dateList = useMemo(() => {
    const n = daysInMonth(month);
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  }, [month]);

  const getDay = (date) => days?.[date] || defaultUsageDay();

  const save = async (date, next) => {
    setSavingDate(date);
    setDays((prev) => ({ ...(prev || {}), [date]: { ...next, updatedBy: currentStaff, updatedAt: new Date().toISOString() } }));
    try {
      await api.put(`/residents/${residentId}/usage/${date}`, next);
    } catch (e) { setError(e.message); } finally { setSavingDate(null); }
  };

  const toggleFlag = (date, key) => {
    const current = getDay(date);
    const nextFlags = { ...current.flags, [key]: !current.flags[key] };
    save(date, { flags: nextFlags, notes: current.notes });
  };
  const changeNotes = (date, value) => {
    setDays((prev) => ({ ...(prev || {}), [date]: { ...getDay(date), notes: value } }));
  };
  const commitNotes = (date) => { save(date, getDay(date)); };

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <MonthPicker month={month} onChange={setMonth} />
        <p className="text-xs" style={{ color: COLORS.inkSoft }}>チェックした内容はその場で自動保存されます</p>
      </div>
      {days === null ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>
      ) : (
        <div className="overflow-x-auto skn-scroll skn-card rounded-lg">
          <table className="text-xs border-collapse min-w-max">
            <thead>
              <tr style={{ background: COLORS.lineSoft }}>
                <th className="px-2 py-2 text-left sticky left-0" style={{ background: COLORS.lineSoft }}>日付</th>
                <th className="px-2 py-2">曜</th>
                <th className="px-2 py-2 whitespace-nowrap">サービス提供</th>
                {USAGE_FIELDS.map((f) => <th key={f.key} className="px-2 py-2 whitespace-nowrap font-normal">{f.label}</th>)}
                <th className="px-2 py-2 whitespace-nowrap">備考</th>
              </tr>
            </thead>
            <tbody>
              {dateList.map((date) => {
                const day = getDay(date);
                const dow = new Date(date + "T00:00:00").getDay();
                return (
                  <tr key={date} style={{ borderTop: `1px solid ${COLORS.lineSoft}` }}>
                    <td className="px-2 py-1.5 sticky left-0 whitespace-nowrap" style={{ background: COLORS.surface }}>{date.slice(8)}日{savingDate === date && <Loader2 className="inline animate-spin ml-1" size={10} />}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: dow === 0 ? COLORS.rose : dow === 6 ? COLORS.blue : COLORS.inkSoft }}>{WEEKDAY_JA[dow]}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={!!day.flags.serviceProvided} onChange={() => toggleFlag(date, "serviceProvided")} />
                    </td>
                    {USAGE_FIELDS.map((f) => (
                      <td key={f.key} className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={!!day.flags[f.key]} onChange={() => toggleFlag(date, f.key)} />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <input
                        className="skn-input rounded px-1.5 py-1 text-xs w-36"
                        value={day.notes}
                        onChange={(e) => changeNotes(date, e.target.value)}
                        onBlur={() => commitNotes(date)}
                        placeholder="例：朝食400円"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- 実績集計（ホーム全体の月次サマリー） ----------------------------------
function UsageSummaryModal({ homeId, onClose }) {
  const [month, setMonth] = useState(todayMonthStr());
  const [summaries, setSummaries] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSummaries(null);
    api.get(`/homes/${homeId}/usage-summary?month=${month}`).then((r) => setSummaries(r.summaries)).catch((e) => setError(e.message));
  }, [homeId, month]);

  const totalRow = useMemo(() => {
    if (!summaries) return null;
    const t = {};
    SUMMARY_COLUMNS.forEach((c) => {
      if (c.isDate) { t[c.label] = "-"; return; }
      t[c.label] = summaries.reduce((sum, s) => sum + (c.get(s) || 0), 0);
    });
    return t;
  }, [summaries]);

  return (
    <Modal title="実績集計" onClose={onClose} wide>
      <div className="mb-3"><MonthPicker month={month} onChange={setMonth} /></div>
      <ErrorBanner message={error} />
      {summaries === null ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>
      ) : (
        <div className="overflow-x-auto skn-scroll">
          <table className="text-xs border-collapse min-w-max">
            <thead>
              <tr style={{ background: COLORS.lineSoft }}>
                <th className="px-2 py-2 text-left sticky left-0" style={{ background: COLORS.lineSoft }}>名前</th>
                {SUMMARY_COLUMNS.map((c) => <th key={c.label} className="px-2 py-2 whitespace-nowrap font-normal">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.residentId} style={{ borderTop: `1px solid ${COLORS.lineSoft}` }}>
                  <td className="px-2 py-1.5 sticky left-0 whitespace-nowrap font-medium" style={{ background: COLORS.surface }}>{s.name}</td>
                  {SUMMARY_COLUMNS.map((c) => <td key={c.label} className="px-2 py-1.5 text-center whitespace-nowrap">{c.get(s)}</td>)}
                </tr>
              ))}
              {summaries.length === 0 && <tr><td colSpan={SUMMARY_COLUMNS.length + 1} className="text-center py-6" style={{ color: COLORS.inkSoft }}>利用者が登録されていません</td></tr>}
              {summaries.length > 0 && totalRow && (
                <tr style={{ borderTop: `2px solid ${COLORS.line}`, background: COLORS.lineSoft }}>
                  <td className="px-2 py-1.5 sticky left-0 font-bold" style={{ background: COLORS.lineSoft }}>合計</td>
                  {SUMMARY_COLUMNS.map((c) => <td key={c.label} className="px-2 py-1.5 text-center font-bold whitespace-nowrap">{totalRow[c.label]}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ---- 管理者パネル ---------------------------------------------------------
function AdminPanel({ currentAccountId, homes, onHomesChanged, onClose }) {
  const [tab, setTab] = useState("accounts");
  const tabs = [{ key: "accounts", label: "スタッフアカウント" }, { key: "homes", label: "ホーム" }, { key: "export", label: "CSV出力" }];
  return (
    <Modal title="管理者メニュー" onClose={onClose} wide>
      <div className="flex gap-4 mb-4" style={{ borderBottom: `1px solid ${COLORS.lineSoft}` }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="skn-typetab pb-2 text-sm font-medium" style={{ "--tc": COLORS.primary, color: tab === t.key ? COLORS.primary : COLORS.inkSoft }}>{t.label}</button>
        ))}
      </div>
      {tab === "accounts" && <AccountManager currentAccountId={currentAccountId} />}
      {tab === "homes" && <HomeManagerPanel homes={homes} onChanged={onHomesChanged} />}
      {tab === "export" && <ExportPanel homes={homes} />}
    </Modal>
  );
}

// ---- メイン業務画面 -------------------------------------------------------
function MainApp({ account, homeId, homes, onChangeHome, onLogout, onOpenAdmin, onHomesChanged }) {
  const [residents, setResidents] = useState(null);
  const [query, setQuery] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingBasic, setEditingBasic] = useState(false);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [activeType, setActiveType] = useState("support");
  const [recordsByType, setRecordsByType] = useState(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showUsageSummary, setShowUsageSummary] = useState(false);

  const home = homes.find((h) => h.id === homeId);

  const loadResidents = useCallback(() => {
    api.get(`/homes/${homeId}/residents`).then((r) => setResidents(r.residents)).catch((e) => setError(e.message));
  }, [homeId]);
  useEffect(() => { loadResidents(); }, [loadResidents]);

  const selected = residents?.find((u) => u.id === selectedId) || null;

  const loadRecords = useCallback(() => {
    if (!selectedId) return;
    setRecordsLoading(true);
    Promise.all(RECORD_TYPE_ORDER.map((t) => api.get(`/residents/${selectedId}/records/${t}`).then((r) => [t, r.records])))
      .then((entries) => setRecordsByType(Object.fromEntries(entries)))
      .catch((e) => setError(e.message))
      .finally(() => setRecordsLoading(false));
  }, [selectedId]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const filtered = useMemo(() => {
    if (!residents) return [];
    const q = query.trim();
    if (!q) return residents;
    return residents.filter((u) => u.name.includes(q) || (u.kana || "").includes(q));
  }, [residents, query]);

  const addUser = async (form) => {
    try {
      const r = await api.post("/residents", form);
      setShowAddUser(false); loadResidents(); setSelectedId(r.resident.id);
    } catch (e) { setError(e.message); }
  };
  const updateUserBasic = async (form) => {
    try { await api.put(`/residents/${selected.id}`, form); setEditingBasic(false); loadResidents(); }
    catch (e) { setError(e.message); }
  };
  const deleteUser = async () => {
    try { await api.del(`/residents/${selected.id}`); setSelectedId(null); setConfirmDeleteUser(false); loadResidents(); }
    catch (e) { setError(e.message); }
  };

  const addRecord = async (partial) => {
    try {
      await api.post(`/residents/${selectedId}/records/${activeType}`, partial);
      loadRecords();
    } catch (e) { setError(e.message); }
  };
  const editRecord = async (recordId, data) => {
    try { await api.put(`/records/${recordId}`, { data }); loadRecords(); }
    catch (e) { setError(e.message); }
  };
  const deleteRecord = async (recordId) => {
    try { await api.del(`/records/${recordId}`); loadRecords(); }
    catch (e) { setError(e.message); }
  };

  const schema = RECORD_TYPES[activeType];

  return (
    <div className="skn-root min-h-screen flex flex-col">
      <FontStyle />
      <header className="px-6 py-3.5 flex items-center justify-between flex-shrink-0 flex-wrap gap-2" style={{ background: COLORS.primaryDark }}>
        <div className="flex items-center gap-3">
          <button onClick={onChangeHome} className="text-white/80 hover:text-white" title="ホームを変更"><ArrowLeft size={18} /></button>
          <div><h1 className="skn-serif text-lg font-bold text-white tracking-wide">{home?.name}</h1><span className="text-xs" style={{ color: "#B9CBC9" }}>支援記録ノート</span></div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs px-2 py-1.5 rounded flex items-center gap-1" style={{ background: "#ffffff18", color: "#fff" }}><UserCircle2 size={14} /> {account.displayName}</span>
          <button onClick={() => setShowUsageSummary(true)} className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={{ background: "#ffffff22", color: "#fff" }}><BarChart3 size={14} /> 実績集計</button>
          {account.role === "admin" && <button onClick={onOpenAdmin} className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={{ background: "#ffffff22", color: "#fff" }}><Shield size={14} /> 管理者メニュー</button>}
          <button onClick={onLogout} className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={{ background: "#ffffff22", color: "#fff" }}><LogOut size={14} /> ログアウト</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 flex-shrink-0 flex flex-col border-r" style={{ borderColor: COLORS.line, background: "#F0ECDF" }}>
          <div className="p-3 flex-shrink-0 space-y-2">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: COLORS.inkSoft }} />
              <input className="skn-input w-full rounded pl-8 pr-3 py-2 text-sm" placeholder="利用者を検索" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button onClick={() => { setShowAddUser(true); setSelectedId(null); }} className="skn-btn-primary w-full rounded py-2 text-sm flex items-center justify-center gap-1"><Plus size={15} /> 利用者を追加</button>
          </div>
          <div className="flex-1 overflow-y-auto skn-scroll px-2 pb-3 space-y-1">
            {residents === null && <div className="flex justify-center py-6"><Loader2 className="animate-spin" size={16} /></div>}
            {residents !== null && filtered.length === 0 && <p className="text-xs text-center py-6 px-3" style={{ color: COLORS.inkSoft }}>{residents.length === 0 ? "このホームにはまだ利用者が登録されていません" : "該当する利用者が見つかりません"}</p>}
            {filtered.map((u) => {
              const color = homeColor(u.homeId, homes);
              const active = u.id === selectedId;
              return (
                <button key={u.id} onClick={() => { setSelectedId(u.id); setShowAddUser(false); setEditingBasic(false); setActiveType("support"); }} className={`skn-tab w-full text-left rounded-r rounded-l-sm px-3 py-2.5 flex items-center gap-2.5 ${active ? "active" : ""}`} style={{ "--tabcolor": color }}>
                  <Avatar name={u.name} color={color} small />
                  <div className="min-w-0"><p className="text-sm font-medium truncate">{u.name || "（未入力）"}</p></div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto skn-scroll p-6">
          <ErrorBanner message={error} />
          {showAddUser && <div className="max-w-xl mx-auto"><UserForm homes={homes} defaultHomeId={homeId} onCancel={() => setShowAddUser(false)} onSave={addUser} /></div>}
          {!showAddUser && !selected && <p className="text-center pt-20 text-sm" style={{ color: COLORS.inkSoft }}>左の一覧から利用者を選択してください</p>}

          {!showAddUser && selected && !editingBasic && (
            <div className="max-w-2xl mx-auto space-y-5">
              <div className="skn-card rounded-lg p-5 relative">
                <div className="absolute left-0 top-4 bottom-4 w-1 rounded-r" style={{ background: homeColor(selected.homeId, homes) }} />
                <div className="flex items-start justify-between pl-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <Avatar name={selected.name} color={homeColor(selected.homeId, homes)} />
                    <div><p className="text-xs" style={{ color: COLORS.inkSoft }}>{selected.kana}</p><h2 className="skn-serif text-xl font-bold">{selected.name}</h2></div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setEditingBasic(true)} className="p-2 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><Pencil size={15} /></button>
                    {!confirmDeleteUser ? (
                      <button onClick={() => setConfirmDeleteUser(true)} className="p-2 rounded hover:bg-black/5" style={{ color: COLORS.inkSoft }}><Trash2 size={15} /></button>
                    ) : (
                      <div className="flex items-center gap-1 text-xs">
                        <span style={{ color: COLORS.rose }}>削除しますか？</span>
                        <button onClick={deleteUser} className="underline" style={{ color: COLORS.rose }}>はい</button>
                        <button onClick={() => setConfirmDeleteUser(false)} className="underline" style={{ color: COLORS.inkSoft }}>いいえ</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="pl-3 mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm" style={{ color: COLORS.inkSoft }}>
                  {selected.birthDate && <span className="flex items-center gap-1.5"><Cake size={13} /> {selected.birthDate}</span>}
                  {selected.contact && <span className="flex items-center gap-1.5"><Phone size={13} /> {selected.contact}</span>}
                </div>
              </div>

              <div className="flex gap-5 flex-wrap" style={{ borderBottom: `1px solid ${COLORS.lineSoft}` }}>
                {RECORD_TYPE_ORDER.map((k) => {
                  const t = RECORD_TYPES[k]; const Icon = t.icon;
                  return (
                    <button key={k} onClick={() => setActiveType(k)} className="skn-typetab pb-2 text-sm font-medium flex items-center gap-1.5" style={{ "--tc": t.color, color: activeType === k ? t.color : COLORS.inkSoft }}>
                      <Icon size={14} /> {t.label}
                      <span className="text-[11px]" style={{ color: COLORS.inkSoft }}>({recordsByType?.[k]?.length ?? "…"})</span>
                    </button>
                  );
                })}
                <button onClick={() => setActiveType("usage")} className="skn-typetab pb-2 text-sm font-medium flex items-center gap-1.5" style={{ "--tc": COLORS.blue, color: activeType === "usage" ? COLORS.blue : COLORS.inkSoft }}>
                  <ClipboardList size={14} /> 実績記録
                </button>
              </div>

              {activeType === "usage" ? (
                <UsageTable residentId={selected.id} currentStaff={account.displayName} />
              ) : (
              <div>
                <RecordForm schema={schema} onAdd={addRecord} currentStaff={account.displayName} />
                <div className="mt-4 space-y-2.5">
                  {recordsLoading && <div className="flex justify-center py-6"><Loader2 className="animate-spin" size={16} /></div>}
                  {!recordsLoading && (recordsByType?.[activeType] || []).length === 0 && <p className="text-xs text-center py-6" style={{ color: COLORS.inkSoft }}>まだ記録がありません</p>}
                  {!recordsLoading && (recordsByType?.[activeType] || []).map((r) => (
                    <RecordCard key={r.id} schema={schema} record={r} currentStaff={account.displayName} onEdit={(data) => editRecord(r.id, data)} onDelete={() => deleteRecord(r.id)} />
                  ))}
                </div>
              </div>
              )}
            </div>
          )}

          {!showAddUser && selected && editingBasic && (
            <div className="max-w-xl mx-auto"><UserForm initial={selected} homes={homes} onCancel={() => setEditingBasic(false)} onSave={updateUserBasic} /></div>
          )}
        </main>
      </div>
      {showUsageSummary && <UsageSummaryModal homeId={homeId} onClose={() => setShowUsageSummary(false)} />}
    </div>
  );
}

// ---- ルート -------------------------------------------------------------
export default function App() {
  const [account, setAccount] = useState(undefined); // undefined=確認中, null=未ログイン
  const [homes, setHomes] = useState([]);
  const [sessionHomeId, setSessionHomeId] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => setAccount(null);
    window.addEventListener("shien-kiroku:unauthorized", onUnauthorized);
    return () => window.removeEventListener("shien-kiroku:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (!getToken()) { setAccount(null); return; }
    api.get("/me").then((r) => setAccount(r.account)).catch(() => setAccount(null));
  }, []);

  const loadHomes = useCallback(() => {
    api.get("/homes").then((r) => setHomes(r.homes)).catch(() => {});
  }, []);
  useEffect(() => { if (account) loadHomes(); }, [account, loadHomes]);

  if (account === undefined) {
    return (
      <div className="skn-root min-h-screen flex items-center justify-center">
        <FontStyle />
        <div className="flex items-center gap-2" style={{ color: COLORS.inkSoft }}><Loader2 className="animate-spin" size={18} /> 読み込み中…</div>
      </div>
    );
  }

  if (!account) return <LoginScreen onLogin={setAccount} />;

  const logout = () => { setToken(null); setAccount(null); setSessionHomeId(null); };

  if (!sessionHomeId) {
    return (
      <>
        <HomeSelectScreen account={account} homes={homes} onSelect={setSessionHomeId} onLogout={logout} onManage={() => setShowAdmin(true)} />
        {showAdmin && <AdminPanel currentAccountId={account.id} homes={homes} onHomesChanged={loadHomes} onClose={() => setShowAdmin(false)} />}
      </>
    );
  }

  return (
    <>
      <MainApp account={account} homeId={sessionHomeId} homes={homes} onChangeHome={() => setSessionHomeId(null)} onLogout={logout} onOpenAdmin={() => setShowAdmin(true)} onHomesChanged={loadHomes} />
      {showAdmin && <AdminPanel currentAccountId={account.id} homes={homes} onHomesChanged={loadHomes} onClose={() => setShowAdmin(false)} />}
    </>
  );
}
