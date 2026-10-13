import * as zca from 'zca-js';
console.log('zca exports:', Object.keys(zca));
if (zca.Zalo) {
  console.log('Zalo proto:', Object.getOwnPropertyNames(zca.Zalo.prototype));
}
if (zca.API) {
  console.log('API proto:', Object.getOwnPropertyNames(zca.API.prototype));
}
