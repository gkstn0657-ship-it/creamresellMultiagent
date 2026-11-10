# No1 우선 선별 경로

새 상품 후보의 **식별자와 판매처 URL**이 확보되면 다음 순서로 처리한다.

1. No1 시세 비교 UI에서 KREAM ID, 모델, 사이즈별 즉시판매가와 30일 예상 거래량을 읽는다.
2. No1 재고 조회 UI에서 동일 모델의 무신사 상품 URL, 색상, 옵션, 재고, 최대혜택가를 읽는다. 현재 연결기는 무신사 상품 URL만 지원한다.
3. KREAM 수수료, 발송비, 포장비를 적용해 허용 매입가와 **낙관적 예상 수익**을 계산한다. No1 화면의 수동 매입가 기본값 50,000원과 표시 마진은 사용하지 않는다.
4. 재고가 없거나 최대혜택가가 허용 매입가를 넘는 옵션은 `low_potential`로 기록한다. 그 외 옵션은 `needs_fallback`으로 기록한다. 후보 승인은 이 단계에서 하지 않는다.
5. No1이 제공하지 못한 실결제가, 할인 적용 조건, 판매자, 배송비와 원천 갱신 시각이 없는 재고 확인을 기존 확장/릴레이의 판매처 페이지 작업으로 보낸다. No1 시세가 오래됐거나 모델·ID가 불일치하면 KREAM 거래 내역도 기존 방식으로 수집한다.

입력 파일은 `no1-first-seeds-v1` JSON이다. `items[]`의 각 상품에 `kreamId`, `kreamModel`, `sourceModel`, `sourceUrl`, `sourceColor`, `options[]`를 넣는다. 양쪽 모델 문자열이 같으면 `model` 하나로 쓸 수 있다. 서로 다르면 이 상품에 대해 확인한 `identityMappingVerified: true`와 20자 이상의 `identityBasis`가 필요하다. 옵션에는 KREAM `size`와 무신사 `sourceOption`을 구분해 넣는다. `sourceColor`도 무신사 화면의 정확한 표기를 사용한다. 일반적인 모델번호 접미사 제거 규칙으로 상품을 합치지 않는다.

```json
{
  "version": "no1-first-seeds-v1",
  "items": [{
    "kreamId": "123456",
    "kreamModel": "EXAMPLE-123-BK",
    "sourceModel": "EXAMPLE-123",
    "identityMappingVerified": true,
    "identityBasis": "해당 상품의 No1 KREAM 링크와 판매처 색상·옵션을 직접 대조한 근거",
    "sourceUrl": "https://www.musinsa.com/products/1234567",
    "sourceColor": "BLACK",
    "options": [{"size": "M", "sourceOption": "M(095)", "sourceColor": "BLACK"}]
  }]
}
```

실측으로 짝을 확인한 한 상품은 [no1-first-seeds.example.json](no1-first-seeds.example.json)에 있다. KREAM `1120286`의 `NBNPG41033-19` 블랙 L과 무신사 `7481180`의 `NBNPG41033` `(19)BLACK` `L(100)`이다. [실측 응답](no1-mcp-prototype/live-matched-product-result.json)에서 No1 시세 기준 시각은 13:44 KST로 조회 시각보다 오래돼 유효 시세로 채택되지 않았고, 재고는 40개·최대혜택가 370,280원이지만 실결제가는 아니다. 이 결과로 수익 후보를 만들지 않았다.

새 실행 폴더와 유효한 비용 정책 JSON을 준비한 뒤 실행한다.

```powershell
node automation/no1-first-runner.mjs --seeds=<seeds.json> --policy=<agent-policy.json> --out=<new-dir> --live --collect-fallback
```

결과는 `no1-first-input.json`, `no1-first-plan.json`, `jobs.json`, `dump-*.json`, `fallback-collection.json`에 남는다. `--collect-fallback`을 빼면 기존 수집 작업은 계획만 한다. No1 UI가 최소화되거나 식별 검증이 실패하면 해당 값은 사용하지 않고 필요한 필드를 기존 수집으로 보낸다. No1 자체의 화면 데이터 기준 시각이 10분을 넘으면 시세를 신선한 값으로 취급하지 않는다. 재고 조회 화면에는 원천 데이터 갱신 시각이 없어 최종 재고 확인이 필요하다.

현재 `automation/loop.mjs`의 기존 완료 사이클은 이 경로와 별개다. No1 순차 조회와 부족 필드 수집은 새 입력 파일을 쓰는 별도 실행 경로로 구현했다. 상품 ID와 판매처 URL을 자동 생성하는 No1 목록 내보내기는 아직 확인되지 않았다. 따라서 새 상품 발견에는 가벼운 목록 탐색이나 기존 후보 목록이 필요하다. 수집된 덤프를 최종 후보로 자동 승격하거나 HTML/XLSX로 만드는 단계는 이 경로에 연결되지 않았다.
