# 资源路径索引

| 路径前缀 | 映射目录 | 说明 |
|---------|---------|------|
| /scripts/ | src/scripts/ | 前端脚本 |
| /styles/ | src/styles/ | 前端样式 |
| /assets/ | src/assets/ | UI 资源 |
| /antd-assets/ | dist/antd-assets/ | Vite 构建产物（管理后台） |
| /resources/ | resources/ | 游戏资源（精灵、数据、缩略图） |
| /img/ | resources/sprites-img/ | 精灵图片 |
| /resources/sprites-260-630-webm/ | resources/sprites-260-630-webm/ | MVP 结算（page4）精灵动态 webm，命名 `{pet_id}_{name}.webm` |
| /img-2/ | resources/sprites-alt/ | 备用精灵图片 |
| /json/ | resources/data/ | JSON 数据文件 |
| /runtime/ | runtime/cache/ | 运行时生成的图片（头像、截图、page8 自定义壁纸 page8-wallpaper.jpg） |
| /image/ | src/assets/ui/ | UI 图片 |
| /font/ | src/assets/fonts/ | 字体文件 |
| /api/avatar/left-avatar.png | runtime/cache/ | 左侧头像图片 |
| /api/avatar/right-avatar.png | runtime/cache/ | 右侧头像图片 |
| /api/page8/wallpaper | runtime/cache/page8-wallpaper.jpg | page8 自定义壁纸上传接口 |

# 页面路由索引

| 路径 | 页面 | 说明 |
|------|------|------|
| / | index.html | 推流载体页（按 stage 配置加载对应页面） |
| /roco-pvp-page1.html | roco-pvp-page1.html | 推流页面1（Overlay 比分栏） |
| /roco-pvp-page2.html | roco-pvp-page2.html | 推流页面2（全局阵容展示） |
| /roco-pvp-page3.html | roco-pvp-page3.html | 推流页面3（头像比分阵容） |
| /roco-pvp-page4.html | roco-pvp-page4.html | 推流页面4（MVP 结算画面，公开免鉴权；由后台「结算画面」切屏控制） |
| /roco-pvp-page5.html | roco-pvp-page5.html | 登场/胜率排行页 |
| /roco-pvp-page6.html | roco-pvp-page6.html | 比赛结果展示页 |
| /roco-pvp-page7.html | roco-pvp-page7.html | 对局推送展示页（直播推流可选画面） |
| /roco-pvp-page8.html | roco-pvp-page8.html | 比赛预告展示页（公开免鉴权，不进直播推流可选画面，仅在页面预览展示） |
| /roco-pvp-page9.html | roco-pvp-page9.html | 团队积分榜展示页（直播推流可选画面） |
| /roco-pvp-page10.html | roco-pvp-page10.html | 推流页面10（胜者结算画面，直播推流可选画面） |
| /roco-pvp-page11.html | roco-pvp-page11.html | 选手介绍页（page11/12/13 共用，`?mode=left/right/versus` 区分三种画面） |
| /float.html | float.html | 桌面阵容悬浮窗 |
| /float-menu.html | float-menu.html | 更换精灵菜单 |
| /float-nextgame.html | float-nextgame.html | 「下场对局」选择菜单（300×320 popup，float.js 打开） |
| /login.html | login-antd 构建产物 | 登录页面 |
| /admin.html、/admin-antd.html | admin-antd 构建产物 | 管理后台 |
