const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>typeof v==='number'?v.toLocaleString('ko-KR')+'원':'—';
export function marginSummary(report){
  const rows=(report?.rows||[]).filter(r=>r.saleMode==='normal');
  if(!rows.length)return '일판 마진 계산 불가';
  return '일판 · '+[['profit','남음'],['loss','손해'],['break_even','본전'],['unknown','계산 불가']].map(([s,l])=>{const n=rows.filter(r=>r.status===s).length;return n?`${l} ${n}`:null;}).filter(Boolean).join(' / ');
}
export function renderMargins(report){
  const rows=report?.rows||[];
  if(!rows.length)return '<h3>마진금 (수익률)</h3><p class="muted">계산 불가 · 매입가와 판매 사이즈가 연결된 자료가 없습니다.</p>';
  return `<h3>마진금 (수익률)</h3><p class="muted">개당 예상 마진 · 최대혜택가 원금액 기준 · 수수료: ${report.settings?.feeSettingsBasis==='no1_defaults_not_user_settings'?'No1 기본값 (사용자 설정 미확인)':'지정값 및 No1 기본값'} · 부가세 ${report.settings?.taxMode?'ON':'OFF'}</p>
  <div class="margin-table-wrap"><table class="margin-table"><thead><tr><th>사이즈 / 기준</th><th>판매 방식</th><th>마진금 (수익률)</th><th>결과</th></tr></thead><tbody>${rows.map(r=>`<tr class="margin-${escape(r.status)}"><td>${escape(r.sourceSize)}<small>${escape(r.color)} · 재고 ${r.stockQuantity===null?'미확인':escape(r.stockQuantity)}<br>매입 ${escape(money(r.purchasePrice))}<br>${r.freshness==='stale'?'오래된 관측':r.freshness==='unknown'?'조회시각 미확인':'최근 관측'}${r.observationMode!=='live'?' · '+escape(r.observationMode):''}</small></td><td>${escape(r.saleModeLabel)}<small>${escape(money(r.salePrice))}${r.hypothetical?'<br>해당 가격에 판매 시':''}</small></td><td><strong>${escape(money(r.marginAmount))}</strong><small>${r.marginRate===null?'—':escape(r.marginRate.toFixed(1))+'%'}</small></td><td>${escape(r.label)}${r.stockQuantity===0?'<small>매입 재고 없음</small>':''}</td></tr>`).join('')}</tbody></table></div>
  <p class="muted">보판 가격 미수집·희망 판매가 미입력은 계산 불가입니다. 배송비·추가 비용과 실제 체결은 확정하지 않습니다.</p>`;
}
