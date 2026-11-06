# ふたりの日

デートの日を二人で残して見返す日記アプリです。iPhoneとAndroidのブラウザで動き、ホーム画面に追加して使えます。

## 試す

`src/config.js` が空の間は、データをその端末だけに保存するデモモードで動きます。

```bash
python3 -m http.server 8765
```

http://localhost:8765 を開きます。右上の「視点」で自分と相手を切り替えられます。

テストは http://localhost:8765/tests/index.html を開くと実行されます。

## 二人で使うための準備（無料）

すべて無料枠で使えます。クレジットカードの登録は不要です。

### 1. Supabaseのプロジェクトを作る

1. [supabase.com](https://supabase.com) でアカウントとプロジェクトを作ります（Regionは Tokyo）。
2. **SQL Editor** に [supabase/schema.sql](supabase/schema.sql) の全文を貼って実行します。

### 2. 二人のアカウントを作る

1. **Authentication → Users → Add user** で二人分を作ります。Auto Confirm をオンにします。
2. [supabase/setup_members.sql](supabase/setup_members.sql) のメールアドレスと名前を書き換えて、SQL Editorで実行します。2行表示されれば成功です。
3. **Authentication → Sign In / Providers** で「Allow new users to sign up」をオフにします。他の人が登録できなくなります。

相手には初回ログイン後に、設定（右上の「⋯」）からパスワードを変えてもらってください。

### 3. アプリを公開する

1. **Project Settings → API** のProject URLと、anon（または publishable）keyを [src/config.js](src/config.js) に書きます。
   `service_role` / `secret` keyは絶対に書かないでください。
2. このフォルダをGitHubのリポジトリに置き、**Settings → Pages** で公開します。
   HTTPSのURLが発行されます。
3. 二人のスマホでそのURLを開き、ホーム画面に追加します。
   - iPhone: Safariの共有ボタン → ホーム画面に追加
   - Android: Chromeのメニュー → ホーム画面に追加

### 4. カレンダー同期と休止対策を設定する

Supabaseの無料枠は、しばらく使わないとプロジェクトが休止します。この設定をすると、6時間ごとの同期が休止対策も兼ねます。

1. SQL Editorで次を実行し、表示された合言葉を控えます。

   ```sql
   select private.rotate_sync_secret();
   ```

2. Googleカレンダーを使うアカウントで [script.google.com](https://script.google.com) を開き、新しいプロジェクトに [apps-script/sync.gs](apps-script/sync.gs) の全文を貼ります。
3. **プロジェクトの設定 → スクリプト プロパティ** に次の3つを登録します。

   | プロパティ | 値 |
   |---|---|
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_ANON_KEY` | anon（または publishable）key |
   | `SYNC_SECRET` | 手順1の合言葉 |

4. エディタで `installTrigger` を選んで1度実行し、権限を許可します。

以降はTimeTreeの予定を、Googleカレンダーに**黄色（バナナ）の「会う」**として入れるだけです。

- 色を個別に付けていない予定は、題名が「会う」ぴったりのときだけ読み込みます。
- 予定を消すと、写真やコメントがまだない記録は自動で消えます。

## 使い方

1. 会った日の記録を開きます。カレンダーから入らなかった日は「＋」で作ります。
2. 「この日の写真を選ぶ」で、その日の写真を多めに選びます。別の日の写真は自動で外れます。
3. 自動で選ばれた写真と場所を確かめ、保存します。保存するまで相手には見えません。
4. コメントを書きます。相手のコメントは、自分が書くと読めるようになります。

## 仕組みと注意点

| 項目 | 内容 |
|---|---|
| 写真の選定 | 顔の数、料理や風景の分類、ピント、明るさ、似た写真の除外で選びます。解析は端末の中で行います |
| 保存する写真 | 長辺1600pxに縮小し、位置情報は画像から取り除きます。元の写真は端末に残ります |
| 容量の目安 | 1枚あたり約0.3〜0.5MBです。無料枠の1GBで、12枚のデートなら約200回分です |
| 場所の名前 | 写真の座標をOpenStreetMap（Nominatim）に送って調べます。写真そのものは送りません |
| 地図と場所の精度 | 写真の位置情報が元なので、近くの建物名になることがあります。保存前に書き直せます |
| コメントの非公開 | データベースの権限で守っています。ただしSupabaseの管理者は管理画面から中身を見られます |

Supabaseの無料枠の上限は変わることがあります。現在の内容は [公式の料金ページ](https://supabase.com/pricing) で確認してください。

## ファイル構成

```text
index.html          入口
src/lib/            写真解析、選定、背景、地名検索
src/store/          保存先（local.js: デモ / supabase.js: 本番）
src/views/          画面
supabase/           データベースの定義
apps-script/        Googleカレンダー同期
tests/              ブラウザで動くテスト
```
