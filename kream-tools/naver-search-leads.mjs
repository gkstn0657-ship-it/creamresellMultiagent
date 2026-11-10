import { NAVER_SHOPPING_RETIREMENT } from '../renew/Cream/kream-tools/naver-search-mode.mjs';
// Do not read credentials or repeatedly call an officially retired endpoint.
console.error(NAVER_SHOPPING_RETIREMENT.message + ' ' + NAVER_SHOPPING_RETIREMENT.notice);
process.exitCode = 4;
