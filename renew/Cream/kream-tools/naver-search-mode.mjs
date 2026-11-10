export const NAVER_SHOPPING_RETIREMENT = Object.freeze({
  effectiveAt: '2026-08-01T00:00:00+09:00',
  notice: 'https://developers.naver.com/notice/article/32564',
  migrationNotice: 'https://developers.naver.com/notice/article/32530',
  message: '네이버 쇼핑 검색 API는 2026-07-31 종료(대체 API 없음). 기존 페이지 수집 경로 사용. 저장 응답의 재생·변환만 지원.',
});
export function naverSearchMode({ apiRequested, replay }) { return apiRequested && replay ? 'saved-api-cards' : 'page'; }
