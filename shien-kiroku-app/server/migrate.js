require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("./db");

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "init.sql"), "utf8");
  console.log("テーブルを作成しています...");
  await pool.query(sql);

  const { rows } = await pool.query("select count(*)::int as count from accounts");
  if (rows[0].count === 0) {
    const username = process.env.INITIAL_ADMIN_USERNAME || "admin";
    const password = process.env.INITIAL_ADMIN_PASSWORD || "admin1234";
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "insert into accounts (username, password_hash, display_name, role) values ($1, $2, $3, 'admin')",
      [username, hash, "管理者"]
    );
    console.log(`初期管理者アカウントを作成しました： ${username} / ${password}`);
    console.log("ログイン後、必ずパスワードを変更してください。");
  } else {
    console.log("アカウントは既に存在します。初期管理者の作成をスキップしました。");
  }

  console.log("マイグレーション完了");
  await pool.end();
}

migrate().catch((err) => {
  console.error("マイグレーションに失敗しました:", err);
  process.exit(1);
});
