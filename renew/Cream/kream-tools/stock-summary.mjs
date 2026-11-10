// Pure parsing: UI quantity is an observed value, never a warehouse stock count.
export function stockSummary(dump) {
  const probe = dump.stockProbe;
  const rows = Array.isArray(probe?.results) ? probe.results.filter((r) => r && typeof r.size === 'string').map((r) => ({
    ...r, size: r.size.slice(0, 100), state: ['available', 'soldout', 'limit', 'unknown'].includes(r.state) ? r.state : 'unknown',
    maxQty: Number.isSafeInteger(r.maxQty) && r.maxQty > 0 ? r.maxQty : null,
    message: String(r.message || '').slice(0, 900),
  })) : [];
  if (dump.blocked || dump.failed || /blocked|captcha|login|site-skipped/.test(probe?.reason || '')) {
    for (const r of rows) { r.state = 'unknown'; r.message = probe?.reason || '페이지 차단/수집 실패'; }
    if (!rows.length) rows.push({ size: '*', state: 'unknown', maxQty: null, message: '페이지 차단/수집 실패' });
  }
  const format = (r) => {
    const status = { available: '선택 가능(UI)', soldout: '품절', limit: '수량 제한(UI)', unknown: '미확인' }[r.state];
    const qty = r.maxQty == null ? '' : `, 관찰 최대 ${r.maxQty}개(실재고 아님)`;
    return `${r.size}: ${status}${qty}${r.message ? ` — ${r.message}` : ''}`;
  };
  const advertised = (dump.text || '').match(/구매\s*가능\s*사이즈[ \t:：]*([^\n]{1,150})/);
  const advertisedNote = advertised ? `판매처 가용 사이즈 표기: ${advertised[1].trim()} (선택·수량 미검증)` : '';
  return {
    rows,
    text: rows.length ? rows.map(format).join(' · ') + (probe?.complete === false ? ` · 부분 확인(${probe.reason || 'unknown'})` : '') + (advertisedNote ? ` · ${advertisedNote}` : '') : advertisedNote,
    available: rows.filter((r) => r.state === 'available' || (r.state === 'limit' && r.maxQty > 0)).map((r) => r.size),
    soldout: rows.filter((r) => r.state === 'soldout').map((r) => r.size),
    allSoldout: probe?.enumerationComplete === true && rows.length > 0 && rows.every((r) => r.state === 'soldout'),
    uncertain: !rows.length || rows.some((r) => r.state === 'unknown') || probe?.complete !== true,
  };
}
