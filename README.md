# 家計帳簿

個人收支、銀行對帳、信用卡對帳與資產負債的網頁 App（GitHub Pages，可加到手機主畫面）。

- **這個 repo 是公開的，只放程式。** 帳本資料放在另一個 Private repo，網頁用使用者自己的 fine-grained token 直接讀寫 GitHub API；token 只存在各裝置的瀏覽器。
- 不要把任何真實帳目、帳號、檔案放進這個 repo、它的測試或歷史紀錄。

## 每月流程
1. 月底把原始檔放進電腦的 Finance 資料夾：`APP_RAW/`（記帳 APP，`YYYY-MM_帳本.xlsx`）、`BANK_RAW/兆豐/`、`BANK_RAW/玉山/`、`CARD_RAW/玉山/`（信用卡帳單 xlsx）、`INVEST_RAW/APP/`（Stock Ledger JSON）。
2. 電腦打開 App →「匯入」→ 選擇資料夾 → 寫入。沒變更的檔案會略過。
3. 手機上處理「對帳」：銀行待分類、信用卡配對；到「資產」填月底快照。

## 資料 repo 結構
```
state.json          設定、分類規則、手動修改、手動紀錄、月底快照
raw/YYYY-MM.json    匯入後的原始明細（每月一檔）
raw/invest.json     投資快照
photos/YYYY-MM/*.jpg 收據照片（記一筆拍照時上傳）
（載具發票 CSV 匯入後存在 raw/YYYY-MM.json，id 開頭 einvoice.）
```
每次儲存是一個 commit，GitHub 上可以看到完整修改歷史。兩台裝置同時改到同一個檔案時，App 會重新讀取再套用自己的修改。

## 計算規則
- 生活消費以消費日認列；信用卡只拿來對帳，不重複計入。
- 繳卡費、自有帳戶互轉＝轉帳，不算收支；投資買賣不算生活支出。
- BANK 啟用日（設定 `bankStart`）起，收入／負債／投資以銀行明細為準；之前以 APP 為準。
- 銀行支出若 APP 沒有同金額（±2 天）紀錄，會自動補入總帳。
- 手動紀錄的發票狀態 `receipt`：`carrier`（載具）／`paper`（紙本）／`none`（無發票）。紙本與無發票不參與載具發票的自動配對；標載具但雲端沒有的會列在對帳頁。
- 分類優先序：拆分規則 > 特殊規則 > 帳本對照；銀行：手動覆寫 > 自有帳戶 > 對手方規則 > 文字規則 > 待分類。

## 開發
不需要 build。`index.html` 依序載入 `engine.js`（解析與計算）、`store.js`（GitHub 資料層）、`app.js`（介面）。
發版時更新 `index.html` / `sw.js` 的版本字串。發版前跑：

```
node tests/engine.test.cjs
node --check app.js && node --check store.js && node --check engine.js
```
