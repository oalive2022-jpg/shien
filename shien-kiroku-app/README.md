# 支援記録ノート

グループホーム向けの利用者管理・記録システムです。ログイン → ホーム選択 → 利用者支援記録・食事記録・宿泊記録・服薬記録の入力ができます。記録には記録者名と登録日時が自動で残り、修正履歴も保存されるため、行政監査にも対応できます。

## 構成

- `client/` : React (Vite) 製のフロントエンド
- `server/` : Node.js (Express) 製のAPIサーバー。ビルド後の `client` を配信し、`/api` 以下でAPIを提供します
- PostgreSQL : データの保存先(Renderの無料プランで利用可能)

---

## 1. ローカルで動かす

### 1-1. PostgreSQLを用意する

ローカルにPostgreSQLをインストールするか、Dockerで起動します。

```bash
docker run --name shien-kiroku-db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=shien_kiroku -p 5432:5432 -d postgres:16
```

### 1-2. サーバーを起動する

```bash
cd server
cp .env.example .env   # 中身を自分の環境に合わせて編集
npm install
npm run migrate         # テーブル作成＋初期管理者アカウント作成
npm start                # http://localhost:3000 でAPIが起動
```

初回起動時、`.env` の `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD`(未設定なら `admin` / `admin1234`)で管理者アカウントが自動作成されます。ログイン後、必ずパスワードを変更してください。

### 1-3. フロントエンドを起動する

別のターミナルで:

```bash
cd client
npm install
npm run dev              # http://localhost:5173 で起動（/api は自動的にサーバーへ転送されます）
```

ブラウザで `http://localhost:5173` を開いてログインできれば成功です。

---

## 2. GitHubにアップロードする

このフォルダをそのままリポジトリにしてください。

```bash
cd shien-kiroku-app
git init
git add .
git commit -m "初回コミット"
git branch -M main
git remote add origin https://github.com/【あなたのアカウント】/【リポジトリ名】.git
git push -u origin main
```

`.env` は `.gitignore` で除外されているため、パスワードなどの秘密情報はアップロードされません。

---

## 3. Renderにデプロイする

このリポジトリには `render.yaml` が含まれているので、**Renderの「Blueprint」機能**を使うと自動で Webサービス と PostgreSQL がまとめて作成されます。

1. [Render](https://render.com/) にログイン(GitHubアカウントで登録可能)
2. ダッシュボードで **New +** → **Blueprint** を選択
3. 先ほどGitHubにpushしたリポジトリを選択
4. 内容を確認して **Apply** をクリック
   - `shien-kiroku-db`(PostgreSQL、無料プラン)
   - `shien-kiroku`(Webサービス、無料プラン)

   が自動的に作成されます。`DATABASE_URL` と `JWT_SECRET`、`INITIAL_ADMIN_PASSWORD` はRenderが自動生成し、Webサービスの環境変数として設定されます。

5. デプロイが完了したら、Webサービスの **Environment** タブで生成された `INITIAL_ADMIN_PASSWORD` の値を確認してください。これが初回ログイン時の管理者パスワードです(ユーザー名は `admin`)。
6. 発行されたURL(例：`https://shien-kiroku.onrender.com`)にアクセスし、`admin` と確認したパスワードでログイン → 「管理者メニュー」からパスワードを変更し、スタッフアカウントを発行してください。

### Blueprintを使わず手動で設定する場合

1. Renderで **PostgreSQL** を新規作成し、`Internal Database URL` を控える
2. **Web Service** を新規作成し、このGitHubリポジトリを接続
   - Build Command: `npm run build`
   - Start Command: `npm run start`
3. 環境変数を設定
   - `DATABASE_URL` : 手順1で控えた接続文字列
   - `JWT_SECRET` : 適当なランダム文字列
   - `INITIAL_ADMIN_USERNAME` : 任意(未設定なら `admin`)
   - `INITIAL_ADMIN_PASSWORD` : 任意(未設定なら `admin1234`。**必ず設定することを推奨**)
4. デプロイ実行

---

## 4. 運用時の注意

- 無料プランのPostgreSQL・Webサービスは一定期間で自動的にスリープ／データが削除される場合があります。本番の記録データを扱う場合は有料プランへの切り替えを検討してください。
- パスワードは `bcrypt` でハッシュ化して保存していますが、通信は必ずHTTPS(RenderのWebサービスは標準でHTTPS)で行ってください。
- スタッフアカウントの発行・削除、ホームの追加・削除は管理者権限が必要です。
- 記録の編集は元の内容を「修正履歴」として保持し、削除はできますが、監査対応としてより厳密な運用(削除の禁止・削除ログの保持など)が必要な場合はサーバー側の実装を調整してください。

---

## 4-1. 自社ドメインからのみアクセスできるようにする

Renderで独自ドメイン(例：`care.your-company.jp`)を設定した上で、以下の環境変数を追加すると、そのドメイン以外からのアクセスを拒否できます。

1. Renderで **Settings** → **Custom Domains** から独自ドメインを追加し、案内に従ってDNS(CNAMEなど)を設定する(TLS証明書はRenderが自動発行します)
2. Webサービスの **Environment** タブで以下を設定
   - `APP_DOMAIN` : 設定した独自ドメイン(例：`care.your-company.jp`)
   - `ALLOWED_ORIGINS` : 同じくその独自ドメインをフルURLで(例：`https://care.your-company.jp`)
3. 保存すると自動的に再デプロイされます

設定後の動作:
- `https://xxxx.onrender.com` など、独自ドメイン以外で画面を開こうとすると、独自ドメインへ自動的に転送されます
- 独自ドメイン以外のホスト名でAPIに直接アクセスしようとした場合は拒否されます(403)
- ログインは15分間に同一IPから10回失敗すると一時的に制限されます(総当たり攻撃対策)

※ この制限はホスト名(ドメイン名)ベースの制御です。VPNやプロキシ経由でホスト名を偽装するような高度な攻撃までは防げませんが、通常のアクセス制御としては十分な効果があります。導入初期や動作確認中は`APP_DOMAIN`と`ALLOWED_ORIGINS`を空のままにしておくと、これまで通りRenderの初期URLでも動作します。

## 5. 外部ツールからの参照（APIキー）

自分たちで作った別のシステム・ツールから、このアプリのデータを読み取り専用で参照できます。

1. アプリにログイン後、**管理者メニュー** → **APIキー** タブを開く
2. 用途を入力して「発行」をクリック
3. 表示されたキー(`skn_...`)をコピーする（**この画面を閉じると二度と表示されません**）
4. 外部ツールから、リクエストヘッダーに `X-API-Key: <発行したキー>` を付けて以下のエンドポイントにアクセスします

| エンドポイント | 内容 |
|---|---|
| `GET /api/external/v1/homes` | ホーム一覧 |
| `GET /api/external/v1/homes/:homeId/residents` | ホームの利用者一覧（服薬情報を含む） |
| `GET /api/external/v1/residents/:residentId/records/:type` | 記録（type = support / health / meal / stay / medication） |
| `GET /api/external/v1/residents/:residentId/usage?month=YYYY-MM` | 実績記録（指定月） |
| `GET /api/external/v1/residents/:residentId/medication-checks?month=YYYY-MM` | 服薬チェック（指定月） |

例（curl）:
```bash
curl https://your-app.onrender.com/api/external/v1/homes \
  -H "X-API-Key: skn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

このAPIは閲覧専用（作成・更新・削除は不可）です。利用者様の記録という機微な個人情報を扱うため、キーは必要な人だけに共有し、外部に公開したり、暗号化されていない通信で送信したりしないよう注意してください。不要になったキーは管理者メニューからいつでも失効(削除)できます。

## 6. データベース構成

- `accounts` : スタッフ／管理者アカウント
- `homes` : ホーム(施設)
- `residents` : 利用者
- `records` : 支援記録・食事記録・宿泊記録・服薬記録(種別は `type` 列で区別)
- `record_edit_history` : 記録の修正履歴

詳細は `server/init.sql` を参照してください。
