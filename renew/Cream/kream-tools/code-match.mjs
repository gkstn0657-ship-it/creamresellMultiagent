// 모델·색상 코드 대조 (2026-11-07 기준 변경): 크림 모델번호(예: 801563051-A0029)가 판매처 제목에 "정확히" 있어야 일치.
//  exact   : 그대로 포함 (대소문자 무시)
//  spacing : 띄어쓰기·구분자(공백 - _ / .)만 다름 → 일치로 보되 특별표시 (예: "801563051 A0029")
//  false   : 색상 코드가 다르거나 없음, 또는 모델 코드 불일치 → 제외
// 앞뒤가 다른 영숫자로 이어지면(더 긴 코드의 일부) 일치로 보지 않는다.
const SEP = '[\\s\\-_/.]*';
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function splitModel(model) {
  const m = String(model || '').trim().toUpperCase(); const i = m.lastIndexOf('-');
  return i < 0 ? { full: m, style: m, color: '' } : { full: m, style: m.slice(0, i), color: m.slice(i + 1) };
}
const loose = (code) => new RegExp('(?<![A-Z0-9])' + [...code.replace(/[\s\-_/.]/g, '')].map(esc).join(SEP) + '(?![A-Z0-9])');
// 판매처 상품 페이지 제목에 같은 모델 코드 + "다른" 색상 코드가 붙어 있으면 그 색상 코드를 돌려준다(없으면 null)
export function otherColor(model, title) {
  const { style, color } = splitModel(model); if (!color) return null; const T = String(title || '').toUpperCase();
  const m = T.match(new RegExp(loose(style).source.replace(/\(\?!\[A-Z0-9\]\)$/, '') + SEP + '([A-Z]\\d{4}|[A-Z]\\d[A-Z]\\d{2})(?![A-Z0-9])'));
  return m && m[1] !== color ? m[1] : null;
}
export function codeMatch(model, title) {
  const { full, style, color } = splitModel(model); const T = String(title || '').toUpperCase();
  if (!full) return { key: false, code: false, note: '크림 모델번호 없음' };
  const key = loose(style).test(T);
  if (new RegExp('(?<![A-Z0-9])' + esc(full) + '(?![A-Z0-9])').test(T)) return { key: true, code: 'exact', note: '' };
  const m = T.match(loose(full));
  if (m) return { key: true, code: 'spacing', note: `코드 띄어쓰기 차이: 판매처 "${m[0]}" / 크림 "${full}"` };
  if (!key) return { key: false, code: false, note: '모델 코드 불일치' };
  return { key: true, code: false, note: color ? `색상 코드 불일치·미표기(크림 ${color})` : '코드 불일치' };
}

// 판매처 배송비 문구 → 원 단위 숫자. '무료'=0, '3,000원'=3000, 해석 불가(조건부 무료·'N원 이상 무료' 등)=null(미확인)
export function parseShip(raw) {
  const s = String(raw || '').trim(); if (!s) return null;
  if (/^무료/.test(s)) return 0; if (/^[\d,]+원?\s*이상/.test(s)) return null;
  const d = s.replace(/,/g, '').match(/\d+/); return d ? Number(d[0]) : null;
}

// 판매처 페이지 글자에서 "최대 적립 포인트" 원 단위 숫자를 뽑는다.
// 우선순위: "포인트 최대 N,NNN원" > "최대 N,NNN원 적립" > "N% 적립"(가격*N/100으로 계산, 비율이면 ratio=N 반환)
// 결과: { won: 정수 원 또는 null, ratio: 백분율 또는 null, raw: 근거 문장(최대 80자) }
export function parsePoints(text, price) {
  const T = String(text || '');
  const won = (m) => Number(String(m[1]).replace(/,/g, ''));
  let m = T.match(/포인트\s*최대\s*([\d,]+)\s*원/) || T.match(/최대\s*적립\s*([\d,]+)\s*원/) || T.match(/최대\s*([\d,]+)\s*원\s*(?:적립|포인트)/);
  if (m) { const raw = T.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10).replace(/\s+/g, ' ').slice(0, 80); return { won: won(m), ratio: null, raw }; }
  m = T.match(/적립\s*([\d]+)\s*%/) || T.match(/([\d]+)\s*%\s*적립/) || T.match(/충전결제\s*시\s*([\d.]+)\s*%\s*적립/);
  if (m && price) { const r = Number(m[1]); const raw = T.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10).replace(/\s+/g, ' ').slice(0, 80); return { won: Math.round(price * r / 100), ratio: r, raw }; }
  return { won: null, ratio: null, raw: '' };
}
