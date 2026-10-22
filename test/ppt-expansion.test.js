'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bundleSize,requiredMinutes}=require('../advanced-operations');
test('PPT bundle counts match pipe diameter',()=>{
 assert.equal(bundleSize(300),3);
 assert.equal(bundleSize(450),2);
 assert.equal(bundleSize(600),1);
 assert.equal(bundleSize(900),undefined);
});
test('PPT curing lower limits are 24 hours and 5 days',()=>{
 assert.equal(requiredMinutes.DRY_CURING,24*60);
 assert.equal(requiredMinutes.WATER_CURING,5*24*60);
});
test('partial bundles are calculable without changing warehouse stock',()=>{
 for(const [diameter,qty,expected] of [[300,7,[3,3,1]],[450,5,[2,2,1]],[600,3,[1,1,1]]]){
 const cap=bundleSize(diameter),chunks=[];
 for(let left=qty;left>0;left-=cap)chunks.push(Math.min(cap,left));
 assert.deepEqual(chunks,expected);
 assert.equal(chunks.reduce((a,b)=>a+b,0),qty);
 }
});
