import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFromDump, compareModel } from '../model-evidence.mjs';
test('inline and multiline KREAM labels preserve the full model', () => {
  assert.equal(modelFromDump({ text: '상품\n모델번호 J2-091-9B50700-A9341-999/U99\n발매가' }), 'J2-091-9B50700-A9341-999/U99');
  assert.equal(modelFromDump({ text: '모델번호\n9B00002-M1241-034\n색상' }), '9B00002-M1241-034');
});
test('same generic garment names cannot override different Moncler style identifiers', () => {
  const r = compareModel('J2-091-9B50700-A9341-999/U99', '몽클레르 로고 패딩 울 가디건 9B00002M1241', '몽클레어');
  assert.equal(r.status, 'mismatch');
});
test('missing model/color stays unconfirmed; exact option-independent code can match', () => {
  assert.equal(compareModel('9B00002-M1241-034', '몽클레르 9B00002M1241', '몽클레어').status, 'unconfirmed');
  assert.equal(compareModel('9B00002-M1241-034', '몽클레르 9B00002 M1241 034', '몽클레어').status, 'matched');
  assert.equal(compareModel('', '몽클레르 9B00002 M1241 034', '몽클레어').status, 'unconfirmed');
});
