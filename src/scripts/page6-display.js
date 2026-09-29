/* 推流页面6（比赛结果）：画面与 page8 共用 match-prediction.js，主标题空值兜底「比赛结果」；
 * 系列赛对局的信息行显示语义标签（如「8进4·胜者组」，后端 tournamentLabels），普通对局只显示时间 */
(function () {
    'use strict';

    window.MatchPredictionPage.mount({
        apiUrl: '/api/page6',
        role: 'page6',
        updateEvent: 'page6:update',
        defaultTitle: '比赛结果',
        useTournamentLabel: true,
        showTimeWithLabel: false,
    });
})();
