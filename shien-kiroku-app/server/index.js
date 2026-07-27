require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const RECORD_TYPES = ["support", "health", "meal", "stay", "medication"];

// ---------- 認証ミドルウェア ----------
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "ログインが必要です" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "セッションが無効です。再度ログインしてください" });
  }
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "管理者のみ実行できます" });
  next();
}

function accountToJson(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
}
function homeToJson(row) {
  return { id: row.id, name: row.name, address: row.address, capacity: row.capacity };
}
function residentToJson(row) {
  return {
    id: row.id, homeId: row.home_id, name: row.name, kana: row.kana,
    birthDate: row.birth_date ? new Date(row.birth_date).toISOString().slice(0, 10) : "",
    contact: row.contact, medications: row.medications || [],
  };
}
function recordToJson(row, history = []) {
  return {
    id: row.id, date: row.record_date ? new Date(row.record_date).toISOString().slice(0, 10) : "",
    data: row.data, createdBy: row.created_by, createdAt: row.created_at,
    lastEditedBy: row.last_edited_by, lastEditedAt: row.last_edited_at,
    editHistory: history.map((h) => ({ editedBy: h.edited_by, editedAt: h.edited_at, previousData: h.previous_data })),
  };
}

// ---------- 認証 ----------
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "ユーザー名とパスワードを入力してください" });
  const { rows } = await pool.query("select * from accounts where username = $1", [username]);
  const account = rows[0];
  if (!account) return res.status(401).json({ error: "ユーザー名またはパスワードが違います" });
  const ok = await bcrypt.compare(password, account.password_hash);
  if (!ok) return res.status(401).json({ error: "ユーザー名またはパスワードが違います" });
  const token = jwt.sign(
    { id: account.id, username: account.username, displayName: account.display_name, role: account.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({ token, account: accountToJson(account) });
});

app.get("/api/me", auth, async (req, res) => {
  const { rows } = await pool.query("select * from accounts where id = $1", [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: "アカウントが見つかりません" });
  res.json({ account: accountToJson(rows[0]) });
});

// ---------- アカウント管理（管理者のみ） ----------
app.get("/api/accounts", auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query("select * from accounts order by created_at asc");
  res.json({ accounts: rows.map(accountToJson) });
});

app.post("/api/accounts", auth, requireAdmin, async (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!username || !password || !displayName || !["admin", "staff"].includes(role)) {
    return res.status(400).json({ error: "入力内容を確認してください" });
  }
  const exists = await pool.query("select 1 from accounts where username = $1", [username]);
  if (exists.rowCount > 0) return res.status(409).json({ error: "そのユーザー名は既に使われています" });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    "insert into accounts (username, password_hash, display_name, role) values ($1,$2,$3,$4) returning *",
    [username, hash, displayName, role]
  );
  res.status(201).json({ account: accountToJson(rows[0]) });
});

app.put("/api/accounts/:id", auth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, password, displayName, role } = req.body || {};
  if (!username || !displayName || !["admin", "staff"].includes(role)) {
    return res.status(400).json({ error: "入力内容を確認してください" });
  }
  if (role !== "admin") {
    const { rows: admins } = await pool.query("select id from accounts where role = 'admin'");
    if (admins.length === 1 && admins[0].id === id) {
      return res.status(400).json({ error: "最後の管理者アカウントの権限は変更できません" });
    }
  }
  const dup = await pool.query("select 1 from accounts where username = $1 and id <> $2", [username, id]);
  if (dup.rowCount > 0) return res.status(409).json({ error: "そのユーザー名は既に使われています" });

  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query("update accounts set username=$1, password_hash=$2, display_name=$3, role=$4 where id=$5", [username, hash, displayName, role, id]);
  } else {
    await pool.query("update accounts set username=$1, display_name=$2, role=$3 where id=$4", [username, displayName, role, id]);
  }
  const { rows } = await pool.query("select * from accounts where id=$1", [id]);
  res.json({ account: accountToJson(rows[0]) });
});

app.delete("/api/accounts/:id", auth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: "ログイン中のアカウントは削除できません" });
  const { rows: admins } = await pool.query("select id from accounts where role = 'admin'");
  if (admins.length === 1 && admins[0].id === id) return res.status(400).json({ error: "最後の管理者アカウントは削除できません" });
  await pool.query("delete from accounts where id=$1", [id]);
  res.status(204).end();
});

// ---------- ホーム ----------
app.get("/api/homes", auth, async (req, res) => {
  const { rows } = await pool.query("select * from homes order by created_at asc");
  res.json({ homes: rows.map(homeToJson) });
});

app.post("/api/homes", auth, requireAdmin, async (req, res) => {
  const { name, address, capacity } = req.body || {};
  if (!name) return res.status(400).json({ error: "ホーム名を入力してください" });
  const { rows } = await pool.query("insert into homes (name, address, capacity) values ($1,$2,$3) returning *", [name, address || "", capacity || ""]);
  res.status(201).json({ home: homeToJson(rows[0]) });
});

app.put("/api/homes/:id", auth, requireAdmin, async (req, res) => {
  const { name, address, capacity } = req.body || {};
  if (!name) return res.status(400).json({ error: "ホーム名を入力してください" });
  const { rows } = await pool.query("update homes set name=$1, address=$2, capacity=$3 where id=$4 returning *", [name, address || "", capacity || "", req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "ホームが見つかりません" });
  res.json({ home: homeToJson(rows[0]) });
});

app.delete("/api/homes/:id", auth, requireAdmin, async (req, res) => {
  const { rows: residents } = await pool.query("select 1 from residents where home_id=$1", [req.params.id]);
  if (residents.length > 0) return res.status(409).json({ error: "入居者がいるホームは削除できません" });
  await pool.query("delete from homes where id=$1", [req.params.id]);
  res.status(204).end();
});

// ---------- 利用者 ----------
app.get("/api/homes/:homeId/residents", auth, async (req, res) => {
  const { rows } = await pool.query("select * from residents where home_id=$1 order by created_at desc", [req.params.homeId]);
  res.json({ residents: rows.map(residentToJson) });
});

function sanitizeMedications(medications) {
  if (!Array.isArray(medications)) return [];
  return medications
    .filter((m) => m && String(m.name || "").trim())
    .map((m) => ({
      id: m.id || crypto.randomUUID(),
      name: String(m.name || "").trim(),
      dosage: String(m.dosage || "").trim(),
      timing: String(m.timing || "").trim(),
    }));
}

app.post("/api/residents", auth, async (req, res) => {
  const { homeId, name, kana, birthDate, contact, medications } = req.body || {};
  if (!homeId || !name) return res.status(400).json({ error: "氏名と所属ホームは必須です" });
  const { rows } = await pool.query(
    "insert into residents (home_id, name, kana, birth_date, contact, medications) values ($1,$2,$3,$4,$5,$6) returning *",
    [homeId, name, kana || "", birthDate || null, contact || "", JSON.stringify(sanitizeMedications(medications))]
  );
  res.status(201).json({ resident: residentToJson(rows[0]) });
});

app.put("/api/residents/:id", auth, async (req, res) => {
  const { homeId, name, kana, birthDate, contact, medications } = req.body || {};
  if (!homeId || !name) return res.status(400).json({ error: "氏名と所属ホームは必須です" });
  const { rows } = await pool.query(
    "update residents set home_id=$1, name=$2, kana=$3, birth_date=$4, contact=$5, medications=$6 where id=$7 returning *",
    [homeId, name, kana || "", birthDate || null, contact || "", JSON.stringify(sanitizeMedications(medications)), req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "利用者が見つかりません" });
  res.json({ resident: residentToJson(rows[0]) });
});

app.delete("/api/residents/:id", auth, async (req, res) => {
  await pool.query("delete from residents where id=$1", [req.params.id]);
  res.status(204).end();
});

// ---------- 記録 ----------
app.get("/api/residents/:residentId/records/:type", auth, async (req, res) => {
  const { residentId, type } = req.params;
  if (!RECORD_TYPES.includes(type)) return res.status(400).json({ error: "不正な記録種別です" });
  const { rows } = await pool.query(
    "select * from records where resident_id=$1 and type=$2 order by created_at desc",
    [residentId, type]
  );
  const historyRes = await pool.query(
    "select * from record_edit_history where record_id = any($1::uuid[]) order by edited_at asc",
    [rows.map((r) => r.id)]
  );
  const historyByRecord = {};
  historyRes.rows.forEach((h) => { (historyByRecord[h.record_id] ||= []).push(h); });
  res.json({ records: rows.map((r) => recordToJson(r, historyByRecord[r.id] || [])) });
});

app.post("/api/residents/:residentId/records/:type", auth, async (req, res) => {
  const { residentId, type } = req.params;
  const { date, data } = req.body || {};
  if (!RECORD_TYPES.includes(type)) return res.status(400).json({ error: "不正な記録種別です" });
  if (!date) return res.status(400).json({ error: "日付を入力してください" });
  const { rows } = await pool.query(
    "insert into records (resident_id, type, record_date, data, created_by) values ($1,$2,$3,$4,$5) returning *",
    [residentId, type, date, data || {}, req.user.displayName]
  );
  res.status(201).json({ record: recordToJson(rows[0]) });
});

app.put("/api/records/:id", auth, async (req, res) => {
  const { data } = req.body || {};
  const { rows: existingRows } = await pool.query("select * from records where id=$1", [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: "記録が見つかりません" });

  await pool.query(
    "insert into record_edit_history (record_id, edited_by, previous_data) values ($1,$2,$3)",
    [existing.id, req.user.displayName, existing.data]
  );
  const { rows } = await pool.query(
    "update records set data=$1, last_edited_by=$2, last_edited_at=now() where id=$3 returning *",
    [data || {}, req.user.displayName, req.params.id]
  );
  const historyRes = await pool.query("select * from record_edit_history where record_id=$1 order by edited_at asc", [req.params.id]);
  res.json({ record: recordToJson(rows[0], historyRes.rows) });
});

app.delete("/api/records/:id", auth, async (req, res) => {
  await pool.query("delete from records where id=$1", [req.params.id]);
  res.status(204).end();
});

// ---------- 実績記録（サービス提供・加算） ----------
const USAGE_FLAG_KEYS = [
  "serviceProvided", "hospitalization", "outingStay", "trialUse", "offSiteUse",
  "postDischargeSupport", "nightSupport", "hospitalSupportSpecial", "longHospitalSupportSpecial",
  "homecomingSupport", "longHomecomingSupport", "daytimeSupport", "medicalCoordination7",
  "medicalCoordination", "independentLiving1", "independentLiving2", "intensiveSupport",
];

function usageToJson(row) {
  return {
    date: row.record_date ? new Date(row.record_date).toISOString().slice(0, 10) : "",
    flags: row.flags || {},
    notes: row.notes || "",
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function todayMonthStr() { return new Date().toISOString().slice(0, 7); }

function monthRange(month) {
  // month は "YYYY-MM" 形式
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

app.get("/api/residents/:residentId/usage", auth, async (req, res) => {
  const { residentId } = req.params;
  const month = req.query.month || todayMonthStr();
  const { start, end } = monthRange(month);
  const { rows } = await pool.query(
    "select * from usage_records where resident_id=$1 and record_date >= $2 and record_date <= $3 order by record_date asc",
    [residentId, start, end]
  );
  res.json({ records: rows.map(usageToJson) });
});

app.put("/api/residents/:residentId/usage/:date", auth, async (req, res) => {
  const { residentId, date } = req.params;
  const { flags, notes } = req.body || {};
  const cleanFlags = {};
  USAGE_FLAG_KEYS.forEach((k) => { cleanFlags[k] = !!(flags || {})[k]; });
  const { rows } = await pool.query(
    `insert into usage_records (resident_id, record_date, flags, notes, updated_by, updated_at)
     values ($1,$2,$3,$4,$5, now())
     on conflict (resident_id, record_date)
     do update set flags=$3, notes=$4, updated_by=$5, updated_at=now()
     returning *`,
    [residentId, date, cleanFlags, notes || "", req.user.displayName]
  );
  res.json({ record: usageToJson(rows[0]) });
});

app.get("/api/homes/:homeId/usage-summary", auth, async (req, res) => {
  const { homeId } = req.params;
  const month = req.query.month || todayMonthStr();
  const { start, end } = monthRange(month);
  const { rows: residentRows } = await pool.query("select id, name from residents where home_id=$1 order by created_at desc", [homeId]);
  const { rows } = await pool.query(
    `select u.* from usage_records u join residents r on r.id = u.resident_id
     where r.home_id=$1 and u.record_date >= $2 and u.record_date <= $3`,
    [homeId, start, end]
  );

  const byResident = {};
  residentRows.forEach((r) => {
    byResident[r.id] = { residentId: r.id, name: r.name, serviceProvidedDays: 0 };
    USAGE_FLAG_KEYS.forEach((k) => { if (k !== "serviceProvided") byResident[r.id][k + "Days"] = 0; });
    byResident[r.id].hospitalizationLastDate = null;
    byResident[r.id].outingStayLastDate = null;
    byResident[r.id].trialUseLastDate = null;
  });

  rows.forEach((row) => {
    const bucket = byResident[row.resident_id];
    if (!bucket) return;
    const dateStr = new Date(row.record_date).toISOString().slice(0, 10);
    const flags = row.flags || {};
    if (flags.serviceProvided) bucket.serviceProvidedDays += 1;
    USAGE_FLAG_KEYS.forEach((k) => {
      if (k === "serviceProvided") return;
      if (flags[k]) bucket[k + "Days"] += 1;
    });
    if (flags.hospitalization && (!bucket.hospitalizationLastDate || dateStr > bucket.hospitalizationLastDate)) bucket.hospitalizationLastDate = dateStr;
    if (flags.outingStay && (!bucket.outingStayLastDate || dateStr > bucket.outingStayLastDate)) bucket.outingStayLastDate = dateStr;
    if (flags.trialUse && (!bucket.trialUseLastDate || dateStr > bucket.trialUseLastDate)) bucket.trialUseLastDate = dateStr;
  });

  const summaries = residentRows.map((r) => byResident[r.id]);
  res.json({ month, summaries });
});

// ---------- 服薬チェック（利用者登録時の服薬情報に基づく日次確認） ----------
function medCheckToJson(row) {
  return {
    date: row.record_date ? new Date(row.record_date).toISOString().slice(0, 10) : "",
    checks: row.checks || {},
    notes: row.notes || "",
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

app.get("/api/residents/:residentId/medication-checks", auth, async (req, res) => {
  const { residentId } = req.params;
  const month = req.query.month || todayMonthStr();
  const { start, end } = monthRange(month);
  const { rows } = await pool.query(
    "select * from medication_checks where resident_id=$1 and record_date >= $2 and record_date <= $3 order by record_date asc",
    [residentId, start, end]
  );
  res.json({ records: rows.map(medCheckToJson) });
});

app.put("/api/residents/:residentId/medication-checks/:date", auth, async (req, res) => {
  const { residentId, date } = req.params;
  const { checks, notes } = req.body || {};
  const { rows } = await pool.query(
    `insert into medication_checks (resident_id, record_date, checks, notes, updated_by, updated_at)
     values ($1,$2,$3,$4,$5, now())
     on conflict (resident_id, record_date)
     do update set checks=$3, notes=$4, updated_by=$5, updated_at=now()
     returning *`,
    [residentId, date, checks || {}, notes || "", req.user.displayName]
  );
  res.json({ record: medCheckToJson(rows[0]) });
});

// ---------- CSV出力 ----------
function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

app.get("/api/export", auth, async (req, res) => {
  const { type = "support", homeId, residentId, start, end } = req.query;
  if (!RECORD_TYPES.includes(type)) return res.status(400).json({ error: "不正な記録種別です" });

  const params = [type];
  let query = `
    select r.record_date, r.data, r.created_by, r.created_at, r.last_edited_by, r.last_edited_at,
           res.name as resident_name, h.name as home_name
    from records r
    join residents res on res.id = r.resident_id
    join homes h on h.id = res.home_id
    where r.type = $1`;
  if (homeId) { params.push(homeId); query += ` and h.id = $${params.length}`; }
  if (residentId) { params.push(residentId); query += ` and res.id = $${params.length}`; }
  if (start) { params.push(start); query += ` and r.record_date >= $${params.length}`; }
  if (end) { params.push(end); query += ` and r.record_date <= $${params.length}`; }
  query += " order by r.record_date asc";

  const { rows } = await pool.query(query, params);

  const fieldKeys = {
    support: [["category", "種別"], ["content", "内容"]],
    health: [["measuredTime", "計測時間"], ["temperature", "体温(℃)"], ["bpHigh", "最高血圧"], ["bpLow", "最低血圧"], ["pulse", "脈拍"], ["oxygen", "酸素濃度(%)"], ["bloodSugar", "血糖値"], ["weight", "体重(kg)"], ["waterIntake", "水分摂取量"], ["mealIntake", "食事摂取量"], ["sleepAndToilet", "睡眠・排便排尿等"], ["userVoice", "利用者の声"], ["notes", "備考"]],
    meal: [["mealType", "区分"], ["staple", "主食摂取量"], ["side", "副食摂取量"], ["water", "水分摂取(ml)"], ["notes", "特記事項"]],
    stay: [["bedtime", "就寝時刻"], ["waketime", "起床時刻"], ["condition", "夜間の様子"], ["morningCondition", "朝の様子"], ["eveningCondition", "夕方から夜の様子"], ["overnightWatch", "深夜帯の見守りの様子"]],
    medication: [["timing", "服薬タイミング"], ["medicationName", "薬品名"], ["dosage", "用量"], ["administered", "服薬確認"], ["notes", "備考"]],
  }[type];

  const header = ["ホーム", "利用者名", "対象日", ...fieldKeys.map((f) => f[1]), "記録者", "登録日時", "最終修正者", "最終修正日時"];
  const lines = [header.map(csvEscape).join(",")];
  rows.forEach((r) => {
    const row = [
      r.home_name, r.resident_name,
      r.record_date ? new Date(r.record_date).toISOString().slice(0, 10) : "",
      ...fieldKeys.map((f) => (r.data || {})[f[0]] || ""),
      r.created_by, r.created_at, r.last_edited_by || "", r.last_edited_at || "",
    ];
    lines.push(row.map(csvEscape).join(","));
  });

  const csv = "\uFEFF" + lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="export_${type}.csv"`);
  res.send(csv);
});

// ---------- フロントエンドの静的配信 ----------
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`サーバー起動: http://localhost:${PORT}`));
