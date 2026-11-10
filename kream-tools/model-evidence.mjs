function exactCode(model, title) {
  const compact = String(model || '').replace(/[\s\-_/.]/g, ''), esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return compact && new RegExp('(?<![A-Z0-9])' + [...compact].map(esc).join('[\\s\\-_/.]*') + '(?![A-Z0-9])', 'i').test(String(title || ''));
}
export function modelFromDump(dump) {
  const m = String(dump?.text || '').match(/(?:^|\n)모델번호[ \t]*(?:\n[ \t]*)?([^\n]+)/);
  return m && /[A-Z0-9]/i.test(m[1]) ? m[1].trim() : '';
}
export function compareModel(model, sellerTitle, brand = '') {
  if (!model) return { status: 'unconfirmed', reason: 'KREAM 품번 원문 미확인' };
  if (exactCode(model, sellerTitle)) return { status: 'matched', reason: '품번 일치, 옵션·가격·재고 추가 검증 필요' };
  // Moncler style identifiers distinguish different garments even when generic titles overlap.
  if (/몽클레[어르]|moncler/i.test(brand)) {
    const expected = model.match(/\d[A-Z]\d{5}/i)?.[0]?.toUpperCase();
    const found = [...String(sellerTitle).matchAll(/\d[A-Z]\d{5}/gi)].map((m) => m[0].toUpperCase());
    if (expected && found.length && !found.includes(expected)) return { status: 'mismatch', reason: `다른 모델: KREAM ${expected} / 판매처 ${found.join('·')}` };
  }
  return { status: 'unconfirmed', reason: `정확 품번 확인 필요: KREAM ${model}` };
}
