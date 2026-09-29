/* 推流页面8（比赛预告）：画面与 page6 共用 match-prediction.js，主标题留空时隐藏 */
(function () {
    'use strict';

    window.MatchPredictionPage.mount({
        apiUrl: '/api/page8',
        role: 'page8',
        updateEvent: 'page8:update',
        defaultTitle: '',
    });
})();
