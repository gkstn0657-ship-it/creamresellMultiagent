export const POPULAR_SORT = 'popular_score';
export function isKreamListUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['kream.co.kr','www.kream.co.kr'].includes(url.hostname) && !url.username && !url.password &&
      (url.pathname === '/search' || /^\/categories\/\d+(?:\/\d+)*\/?$/.test(url.pathname));
  } catch { return false; }
}
export function buildKreamListUrl(input) {
  const value = String(input || '').trim(); if (!value) throw new Error('검색어 또는 카테고리 URL이 필요합니다');
  let url;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
    if (!isKreamListUrl(value)) throw new Error('KREAM HTTPS 검색·카테고리 URL만 사용할 수 있습니다');
    url = new URL(value);
  } else {
    url = new URL('https://kream.co.kr/search'); url.searchParams.set('keyword', value); url.searchParams.set('tab', 'products');
  }
  url.searchParams.set('sort', POPULAR_SORT); url.hash = ''; return url.href;
}
