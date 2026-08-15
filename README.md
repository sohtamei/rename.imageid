# imageIDファイルコピー名作成 / imageID File Copy Renamer

`index.html` をブラウザで開いて使う、ローカル完結型の画像ファイルリネーム補助アプリです。
This is a local-only image file renaming helper that runs in your browser by opening `index.html`.

- 対応形式 / Supported formats: JPG/JPEG, Sony RAW `.ARW`, HEIF `.HIF` / `.HEIF`
- 対象 / Target: MakerNote IFD tag `0x2043` in EXIF
- 文字列形式 / String format: UTF-16LE
- Sony MakerNoteのTIFF先頭基準オフセットに対応 / Supports Sony MakerNote offsets based on the TIFF start
- 出力 / Output: ZIP containing unchanged files renamed as `original-name_imageID.ext`
- 対応 / Supported: Major browsers on Windows, macOS, and iOS
- 表示言語 / UI languages: Japanese and English

## 使い方 / How To Use

1. `index.html` を開きます。 / Open `index.html`.
2. JPG、ARW、HIF/HEIFファイルを複数選択します。 / Select one or more JPG, ARW, or HIF/HEIF files.
3. 抽出結果を確認し、`ZIPを作成・保存` / `Create and save ZIP` を押します。

Windows/macOS/iOSでファイル名に使えない文字は `_` に置き換えます。
Characters that cannot be used in Windows/macOS/iOS file names are replaced with `_`.
