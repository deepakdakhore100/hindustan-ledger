'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {hashPassword,hashToken,checkPassword}=require('../auth');
test('password hashing is salted and verifies correctly',()=>{
 const a='a'.repeat(64),b='b'.repeat(64),pass='LongEnoughPassword-2026';
 const h=hashPassword(pass,a);
 assert.equal(h.length,128);
 assert.notEqual(h,hashPassword(pass,b));
 assert.equal(checkPassword(pass,a,h),true);
 assert.equal(checkPassword('wrongpass',a,h),false);
});
test('token hashes are deterministic and no plaintext retained',()=>{
 const token='a'.repeat(64);const h=hashToken(token);
 assert.equal(h.length,64);assert.notEqual(h,token);assert.equal(hashToken(token),h);
});
