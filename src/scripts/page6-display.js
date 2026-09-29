/* 推流页面6（比赛结果）：画面与 page8 共用 match-prediction.js，主标题空值兜底「比赛结果」 */
(function () {
    'use strict';

    window.MatchPredictionPage.mount({
        apiUrl: '/api/page6',
        role: 'page6',
        updateEvent: 'page6:update',
        defaultTitle: '比赛结果',
    });
})();
