import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve('kream-runs/sourcing-five-20261108'); fs.mkdirSync(dir, { recursive: true });
const preferences = { targetCount: 5, maxPurchasePrice: 1000000, minMarketPrice: 0, preferNaverStores: true, allowNaverStores: true,
  feeRate: 0.06, sellerFixedFee: 2500, feeVatRate: 0.10, feeCap: 300000, outboundShipping: 3000, packingCost: 1000,
  minCashProfit: 0, minBatchProfit: 10000, stressPriceDrop: 0.05, costPolicyConfirmed: true,
  purchaseMode: 'multiple-units', totalBudget: null, totalBudgetUnlimited: true, quantitiesToCompare: [1, 3, 5, 10, 20, 50],
  naverBenefits: { membership: true, paymentMethods: ['npay-money', 'naver-hyundai-card'], cardEdition: null,
    remainingMonthlyLimits: null, includeUnverifiedPointsInCashProfit: false, optimizeMixedPayments: true },
  costPolicySource: 'https://kream.co.kr/faq?category=all&list=true', costPolicyVersion: '2026-03-02 / 일반 Level 1 / 사용자 수수료율 6%',
  assumptions: ['사용자 예산 상품당 100만원 이하', '사용자 6%는 공식 일반 Level 1의 VAT 별도 등급 수수료로 보수 해석', '별도 기본수수료 2500원 및 VAT 10% 반영', '검수센터 발송 3000원·포장 1000원은 보수적 가정', '포인트는 조건·한도 확인 전 수익에 합산하지 않음'] };
fs.writeFileSync(path.join(dir, 'agent-policy.json'), JSON.stringify(preferences, null, 2));
// The current multi-brand run uses the same user preferences. Preserve unrelated settings.
const activePolicyFile = path.resolve('kream-runs/20261108/agent-policy.json');
const existing = fs.existsSync(activePolicyFile) ? JSON.parse(fs.readFileSync(activePolicyFile, 'utf8')) : {};
if (fs.existsSync(activePolicyFile) && !fs.existsSync(activePolicyFile + '.before-batch.bak')) fs.copyFileSync(activePolicyFile, activePolicyFile + '.before-batch.bak');
fs.writeFileSync(activePolicyFile, JSON.stringify({ ...existing, ...preferences }, null, 2));
const html = fs.readFileSync('bookmarks_26. 6. 11..html', 'utf8');
const stores = [...html.matchAll(/<A[^>]+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi)].filter((m) => /^https:\/\/(?:smartstore|brand)\.naver\.com\//.test(m[1])).map((m) => ({ url: m[1], name: m[2] }));
fs.writeFileSync(path.join(dir, 'bookmarked-naver-stores.json'), JSON.stringify(stores, null, 2));
console.log(JSON.stringify({ dir, preference: preferences, stores: stores.slice(0, 25), totalBookmarkedStores: stores.length }, null, 2));
