# SALTY STUDIO ウェブサイト

貝殻や木の実など、身近な自然をモチーフにしたボードゲームサークル「SALTY STUDIO」の公式サイトです。静的HTML・CSSのみで構成されており、サーバーやビルドツールを必要としません。

## 構成

```
/
├── index.html              トップページ（ヒーロー / ニュース抜粋 / 作品導線 / About）
├── games/
│   ├── index.html           ゲーム一覧（自社開発 / アートワーク参加）
│   ├── yadokari.html        ヤドカリコロリン（新作）
│   ├── donguri.html         ドングリどこだ？（新作）
│   ├── ballooning.html      バルーニング（アートワーク参加）
│   ├── make-heroine.html    負けヒロインとは言わせない!!（既刊）
│   ├── murder-mystery.html  ムゲンマーダーミステリー（既刊）
│   └── karuta.html          うらにわには2わ...（既刊）
├── news/index.html          ニュース（新しい順の1ページ追記形式）
├── contact/index.html       お問い合わせ（Googleフォーム埋め込み枠）
└── assets/
    ├── css/style.css        共通スタイル（デザイントークン・全コンポーネント）
    ├── placeholder/         汎用プレースホルダー用（現状未使用・予備）
    └── games/<game>/        各作品の画像置き場（命名規則は下記）
```

## ローカルで確認する方法

CSSやナビゲーションのリンクはルート相対パス（`/assets/...` `/games/...`）で書かれているため、`file://` で直接開くと崩れます。必ず簡易サーバー経由で確認してください。

```bash
npx serve .
```

または

```bash
python -m http.server 8080
```

## 画像の差し替え方

現在、すべての画像は貝殻スパイラルのアイコン＋ラベルによるCSSプレースホルダー（`.media-placeholder`）です。実素材ができたら、該当箇所を `<img>` タグに差し替えてください。パスは以下の命名規則に揃えてあります。

```
/assets/games/yadokari/hero.jpg
/assets/games/donguri/hero.jpg
/assets/games/ballooning/hero.jpg, card-tokyo.jpg ...
/assets/games/make-heroine/thumb.jpg
/assets/games/murder-mystery/thumb.jpg
/assets/games/karuta/thumb.jpg
```

置き換え例（`games/yadokari.html` のヒーロー画像）:

```html
<!-- Before -->
<div class="media-placeholder">
  <span class="shell-spiral">...</span>
  <span class="ph-label">HERO IMAGE PLACEHOLDER<br>/assets/games/yadokari/hero.jpg</span>
</div>

<!-- After -->
<img src="/assets/games/yadokari/hero.jpg" alt="ヤドカリコロリン">
```

## 要確認・未確定のまま残している箇所

- **既刊3作品（負けヒロイン／マーダーミステリー／カルタ）の紹介文・人数・プレイ時間**：参照元とされていた既存 `index.html` が見つからなかったため、暫定の文章で仮組みしています。各ページに「本ページの紹介文は暫定内容です」という注記ボックスを付けているので、実際の内容に差し替えてください。
- **お問い合わせフォーム**（`contact/index.html`）：GoogleフォームのURL発行後、`.form-embed` 内のプレースホルダーを、フォームの「埋め込み」タブで取得した `<iframe>` コードに置き換えてください（HTMLコメントに手順を記載済み）。
- **バルーニングの販売・入手先リンク**：未定のため空欄です。決まり次第 `games/ballooning.html` の該当箇所に追記してください。
- **SNSリンク**：SALTY STUDIO自体のXアカウントが未定のため、ヘッダー・フッターとも「X（準備中）」のダミーリンクのままです。
- **ボドゲーマへのリンク**：既刊3作品は個別ページではなくトップページへの仮リンクです。

## デザイントークン

`assets/css/style.css` の `:root` に集約しています。主な変数：

- `--color-teal-900` / `--color-teal-700`：ティール系（ヘッダー・フッター・ヒーロー背景）
- `--color-coral-500` / `--color-coral-400`：珊瑚色（アクセント・CTA）
- `--font-heading`：Shippori Mincho（見出し）
- `--font-body`：Zen Kaku Gothic New（本文）

貝殻スパイラルのモチーフは `.shell-spiral` のインラインSVGとして各所で繰り返し使用しています。
