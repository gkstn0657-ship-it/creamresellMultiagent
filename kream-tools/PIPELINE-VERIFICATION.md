# 실제 다중 브랜드 경로 검증

루트 `kream-tools`의 다중 브랜드 파서는 과거에 KREAM 원문에 있는 모델번호를 버리고 상품명 토큰으로 매칭했다. 실제 리포트의 KREAM 314483은 `J2-091-9B50700-A9341-999/U99`인데 판매처 제목 `9B00002M1241`과 연결돼 있었다. 이 건은 모델 불일치로 제외하고 기존 추정 이익을 표시하지 않는다. `9B00002-M1241-034`에 해당하는 KREAM 상품을 확인한 것은 아니다.

- `parse-multi.mjs`: KREAM 덤프의 모델번호 원문 보존.
- `make-n-jobs-multi.mjs`: 새 실행에서 품번이 있으면 품번을 포함해 검색. `n-eligible.json`에도 보존. 기존 작업·덤프는 재사용하므로 재수집은 새 실행폴더에서 시작한다.
- `parse-naver-multi.mjs`: 확인된 다른 모델은 매칭에서 제외. 대형몰 후보 선별은 정확 품번 일치가 필요하다.
- `validate-sourcing.mjs`: 루트의 실제 결과를 `renew/Cream`의 공통 필수 검증으로 연결한다. 원본 시각을 유지한 덤프 사본과 감사 결과는 실행폴더의 `validated/`에 저장한다.
- `build-report-html.mjs`: 매번 공통 검증을 실행한 뒤 검증된 매입 후보 수를 표시한다. 관찰·참고 매칭과 구분하며, 확인된 오매칭은 제외 탭에 남긴다.

```powershell
node kream-tools/validate-sourcing.mjs kream-runs/20261108
node kream-tools/build-report-html.mjs kream-runs/20261108
```

2026-11-08 기존 95행을 공통 검증에 연결한 결과는 매입 후보 0행, 사람 검토 94행, 제외 1행이다. 수익성이 확인된 매입 제안이 확보됐다는 의미가 아니다. 상세 옵션·재고·실구매가·판매자·비용 정책 근거를 채워야 한다. 자동 추출·검증·독립 정답표에 관한 계약은 `renew/Cream/kream-tools/AGENTS-README.md`를 따른다.

## 인기순 수집

브라우저의 현재 URL을 확인하지 못해 이번 작업에서 사용자의 실제 Chrome 정렬은 바꾸지 못했다. 아래 코드는 다음 수집용이며 실사이트 변경 완료를 뜻하지 않는다.

두 확장 폴더의 버전은 0.4.8이다. 실제 사용하는 확장을 새로고침해야 새 코드가 적용된다. 코드와 테스트는 정렬 URL만 믿지 않고 화면의 `추천순` 메뉴를 열어 `인기순`을 선택한 뒤 선택된 라벨이 인기순인지 확인한다. 결과는 덤프의 `kreamSort`에 저장된다. 모호함·차단·선택 확인 실패 시 인기순으로 인정하지 않는다.

사용자가 실제 화면에서 확인한 `sort=popular_score`를 현재 수집 URL에 적용했다. 이전 코드의 `sort=popular`는 잘못된 가정이었다. 키워드 검색과 카테고리 URL 입력 모두 popular_score로 생성하고 카테고리 경로·기존 필터는 유지한다. 이 주소가 별도 REST API라는 근거는 확인하지 않았다.

```powershell
node kream-tools/collect-ids.mjs <새실행폴더> jobs "몽클레어"
node kream-tools/collect-ids.mjs <새실행폴더> jobs "https://kream.co.kr/categories/50/24?sort=popular_score"
# 확장이 수집한 다음
node kream-tools/collect-ids.mjs <새실행폴더> extract 30 --include-explored
```

`k50-id-evidence.json`에 목록 URL·sortParameter(popular_score)·실제 선택 라벨·확인시각·캡처시각·캡처 링크 내 순서를 저장한다. popular_score URL과 화면 확인이 모두 있는 덤프만 ID 추출에 사용한다. 캡처 링크 내 순서는 공식 판매량 순위가 아니다. 이번 21개 브랜드의 과거 목록에는 이 근거가 없어 인기순 수집이라고 보증할 수 없다.
