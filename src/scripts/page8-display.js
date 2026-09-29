/* 推流页面8（比赛预告）：画面与 page6 共用 match-prediction.js，主标题空值兜底「比赛预告」 */
(function () {
    'use strict';

    window.MatchPredictionPage.mount({
        apiUrl: '/api/page8',
        role: 'page8',
        updateEvent: 'page8:update',
        defaultTitle: '比赛预告',
    });
})();
