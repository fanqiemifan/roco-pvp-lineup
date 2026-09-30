/* 推流页面8（比赛预告）：画面与 page6 共用 match-prediction.js，主标题空值兜底「比赛预告」；
 * 与 page6 一致显示系列赛语义标签（tournamentLabels），并额外与时间胶囊并排（showTimeWithLabel） */
(function () {
    'use strict';

    window.MatchPredictionPage.mount({
        apiUrl: '/api/page8',
        role: 'page8',
        updateEvent: 'page8:update',
        defaultTitle: '比赛预告',
        useTournamentLabel: true,
        showTimeWithLabel: true,
    });
})();
