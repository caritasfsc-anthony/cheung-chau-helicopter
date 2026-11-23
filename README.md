# 長洲直升機巡航｜學校版

WebGL 教學遊戲，地圖只覆蓋長洲及附近海域，使用直升機而非無人機。這不是已上線的個人版 `hkrgb/hk-drone-flight`。

試玩：**https://caritasfsc-anthony.github.io/cheung-chau-helicopter/?v=s1-20261123-1215**

本機開發可用：http://127.0.0.1:8771/?v=s1-20261123-1215

手機省資源可加 `&quality=low`。除錯可加 `&debug=1`。

版本：**s1-20261123-1215**。飛行畫面置中於 16:9 舞台，多餘空間為黑邊。全程最低離地高度 100 米。左上「主頁」返回開始畫面；右上指南針為 north-up，指針隨航向轉動。直升機模型於起飛後背景下載，同一局自動顯示。圖磚未到也可先開始並操控；等候時會顯示計數、參考棋盤（並非真實海陸）及重試。

## 操作與任務

- 鍵盤：WASD 平移，Q / E 轉向，空白鍵升高，Shift 下降，C 切換視角，R 重飛
- 手機：請打橫使用，建議先開全屏幕；使用畫面左下／右下圖案按鈕
- 起點在東灣泳灘附近，離第一站巡查圈約 289 米，避免一出場就完成東灣
- 任務順序：東灣 → 南氹 → 東灣仔 → 觀音灣（饅頭石）
- 飛入各站黃圈即可；最後一站綠圈完成任務，無需返回碼頭或降落
- 「自由飛行」只在長洲範圍內，沒有中環等出發點

## 限制

沒有立體樓宇；市區是航拍貼在地面高程上。真手機未在此版本驗證。慢網絡仍需等候圖資，不能保證高清即時顯示。地圖被限制在長洲及約 1.5 公里周邊海域。

## 資料來源與授權

- 長洲航拍：地政總署 Imagery Map API（CSDI）。地圖畫面以本地小標誌及短句顯示地政總署標誌與 “Aerial Photograph from Lands Department”。
- 任務航點：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，並對照[地政總署長洲地圖](https://www.landsd.gov.hk/doc/en/mapping/ehkg/MapPages/GeoPDF/IS04_CheungChau.pdf)。
  - 東灣：[OSM node 1134027637](https://www.openstreetmap.org/node/1134027637)
  - 南氹：[OSM node 3239128609](https://www.openstreetmap.org/node/3239128609)（長洲本地，不是蒲台南氹灣）
  - 東灣仔：[OSM node 1134027647](https://www.openstreetmap.org/node/1134027647)（亦稱 Coral Beach／小東灣）
  - 觀音灣（饅頭石）：[OSM way 596846734 饅頭石 Loaf Rock](https://www.openstreetmap.org/way/596846734)；海灣本身見[觀音灣泳灘](https://www.openstreetmap.org/way/171726216)
  - 起飛點：[長洲東灣泳灘](https://www.openstreetmap.org/way/44717226)
- 高程：AWS / Mapzen Terrain Tiles（Terrarium）。香港地區主要為 SRTM／GMTED，courtesy of the U.S. Geological Survey。長洲精細高程：地政總署 5 米 DTM。
- 直升機模型：Sketchfab “[Animated civilian Helicopter](https://sketchfab.com/3d-models/animated-civilian-helicopter-f25c041a8d004eb092e4aa41d1dc33f4)” by [assetfactory](https://sketchfab.com/assetfactory)，[SKETCHFAB Standard](https://sketchfab.com/licenses)。出處來自模型檔內嵌資料，詳見 `model-license.txt`。執行時使用轉換後的 `helicopter-model.js` 與 `textures/`，不需要也不應公開上傳原始 `.glb`。
