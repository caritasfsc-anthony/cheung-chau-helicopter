# 郊野學園考察團

WebGL 教學遊戲，地圖只覆蓋長洲及附近海域，使用直升機而非無人機。這不是已上線的個人版 `hkrgb/hk-drone-flight`。

試玩：**https://caritasfsc-anthony.github.io/cheung-chau-helicopter/?v=s1-20261123-1700**

本機開發可用：http://127.0.0.1:8771/?v=s1-20261123-1700

手機省資源可加 `&quality=low`。除錯可加 `&debug=1`。

版本：**s1-20261123-1700**。從長洲南面海域海拔 589 米、朝向 340° 起飛；桌上版與手機都顯示左下 WASD、右下 J／Q／R／M 圖示加字母控制鍵；小地圖圖示改按實際畫布邊緣夾位；指南針字母下有半透明圓底。新增輕量按鈕亮光／按下縮放與 480ms 過場（輕微放大、提亮及暖金光暈），支援減少動態效果設定；指南針使用明確尺寸，直升機連同主／尾旋翼等比例放大 2 倍（9 米 → 18 米），追尾鏡頭不變。開場先顯示標題畫面，按 START 後翻頁看考察團故事；第 6 頁「準備出發」之後先進入第一個尋人標題（尋找莫博士），按 LET'S GO 才起飛。其後每個角色都是：標題頁 → 飛行（提示含方位與地貌）→ 找到後的剪影頁 → 關卡之間的故事頁 → 下一節。救出斑班長後會播放約兩分鐘的結尾短片，播完或按「跳過」才到結果畫面。約 600 米內提示盒出現加厚 1.1cqh、雙層反向旋轉及柔光幻彩邊，約 300 米才顯示黃圈與距離。飛行畫面置中於 16:9 舞台，多餘空間為黑邊。全程最低離地高度 100 米。左上「主頁」或結果畫面的「返回標題」回到標題，不會停在故事中間；結果畫面「再飛一次」會回到第一個尋人標題，不再重播開場故事。右上指南針為 north-up，指針隨航向轉動。直升機模型於起飛後背景下載，同一局自動顯示。圖磚未到也可先開始並操控；等候時會顯示計數、參考棋盤（並非真實海陸）及重試。

## 操作與任務

- 鍵盤：Q 左轉，R 或 E 右轉，W／A／S／D 平移，J 或空白鍵升高，M、Shift 或 X 下降，C 切換視角
- 桌上版與手機都會顯示畫面左下 WASD、右下 J／Q／R／M 圖示加字母控制鍵；手機請打橫使用，建議先開全屏幕
- 起點在長洲南面海域（約北緯 22.1892017、東經 114.0360482），朝向 340°、海拔 589 米；離第一站約 2.5 公里，避免一出場就完成第一個尋人目標
- 四節尋人（飛近後才顯示目標圖形）：莫博士、金剛仔、小螢、斑班長
- 約 600 米內提示盒現幻彩邊，約 300 米顯示黃圈與距離；飛入 70 米範圍即找到該角色，無需返回碼頭或降落
- 標題與故事畫面不提供自由飛行；任務在長洲範圍內進行，沒有中環等出發點

## 限制

沒有立體樓宇；市區是航拍貼在地面高程上。真手機未在此版本驗證。慢網絡仍需等候圖資，不能保證高清即時顯示。地圖被限制在長洲及約 1.5 公里周邊海域。

## 資料來源與授權

- 長洲航拍：地政總署 Imagery Map API（CSDI）。地圖畫面以本地小標誌及短句顯示地政總署標誌與 “Aerial Photograph from Lands Department”。
- 任務航點：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，並對照[地政總署長洲地圖](https://www.landsd.gov.hk/doc/en/mapping/ehkg/MapPages/GeoPDF/IS04_CheungChau.pdf)。
  - 東灣：[OSM node 1134027637](https://www.openstreetmap.org/node/1134027637)
  - 南氹：[OSM node 3239128609](https://www.openstreetmap.org/node/3239128609)（長洲本地，不是蒲台南氹灣）
  - 東灣仔：[OSM node 1134027647](https://www.openstreetmap.org/node/1134027647)（亦稱 Coral Beach／小東灣）
  - 觀音灣（饅頭石）：[OSM way 596846734 饅頭石 Loaf Rock](https://www.openstreetmap.org/way/596846734)；海灣本身見[觀音灣泳灘](https://www.openstreetmap.org/way/171726216)
  - 起飛點：長洲南面海域（22.1892017, 114.0360482），朝向 340°、海拔 589 米
- 高程：AWS / Mapzen Terrain Tiles（Terrarium）。香港地區主要為 SRTM／GMTED，courtesy of the U.S. Geological Survey。長洲精細高程：地政總署 5 米 DTM。
- 直升機模型：Sketchfab “[Animated civilian Helicopter](https://sketchfab.com/3d-models/animated-civilian-helicopter-f25c041a8d004eb092e4aa41d1dc33f4)” by [assetfactory](https://sketchfab.com/assetfactory)，[SKETCHFAB Standard](https://sketchfab.com/licenses)。出處來自模型檔內嵌資料，詳見 `model-license.txt`。執行時使用轉換後的 `helicopter-model.js` 與 `textures/`，不需要也不應公開上傳原始 `.glb`。
