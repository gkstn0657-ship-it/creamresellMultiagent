// The ranking feed has no product category per row. Exclude only clear
// non-resale goods before a source is assigned; exact KREAM/POIZON matching
// remains the authority for products that pass this inexpensive screen.
const nonResaleGoods=/(?:샴푸|트리트먼트|클렌징|헤어\s*에센스|헤어\s*토닉|스케일링|리무버|홈케어|상품권|기프트\s*카드|초코맛|딸기맛|단백질\s*(?:음료|쉐이크)|\b\d+(?:\.\d+)?\s*(?:ml|mL|리터)\b)/i;

export function likelyResaleCandidate(product){
 return typeof product?.productName==='string'&&!nonResaleGoods.test(product.productName);
}
