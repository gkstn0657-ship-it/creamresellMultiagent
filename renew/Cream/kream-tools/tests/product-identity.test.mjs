import test from 'node:test';
import assert from 'node:assert/strict';
import {productIdentityCompatible} from '../product-identity.mjs';

test('short numeric Patagonia style cannot match fabric with the same code',() => {
  assert.equal(productIdentityCompatible('파타고니아 라이트웨이트 신칠라 스냅-T 플리스 블랙','선염 해지원단 무지 스트라이프원단 그레이 25551','25551'),false);
  assert.equal(productIdentityCompatible('파타고니아 라이트웨이트 신칠라 스냅-T 플리스 블랙','Patagonia Lightweight Synchilla Snap-T Fleece 25551','25551'),true);
});
