'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createAuth,hashPassword,hashToken}=require('../auth');

const salt='a'.repeat(64);
const user={id:11,username:'pipeoperator',password_salt:salt,password_hash:hashPassword('long-password-for-testing',salt),is_owner:false,is_active:true};
const kitchen={id:12,username:'kitchenstaff',password_salt:salt,password_hash:hashPassword('long-kitchen-password',salt),is_owner:false,is_active:true};
const roles=new Map([[11,new Map([[1,'OPERATOR']])],[12,new Map([[2,'KITCHEN']])]]);
const sessions=new Map();
const users=[user,kitchen];
const pool={
 async query(sql,params=[]){
  if(sql.includes('FROM app_users WHERE username=')){
   const found=users.find(x=>x.username===params[0]&&x.is_active);
   return {rowCount:Number(Boolean(found)),rows:found?[found]:[]};
  }
  if(sql.startsWith('INSERT INTO app_sessions')){
   sessions.set(params[1],{user_id:params[0],expires:Date.now()+12*3600e3});return {rowCount:1,rows:[]};
  }
  if(sql.includes('FROM app_sessions s JOIN app_users u')){
   const s=sessions.get(params[0]);const found=users.find(x=>s&&x.id===s.user_id&&s.expires>Date.now()&&x.is_active);
   return {rowCount:Number(Boolean(found)),rows:found?[{id:found.id,username:found.username,is_owner:found.is_owner}]:[]};
  }
  if(sql.startsWith('DELETE FROM app_sessions')){
   const existed=sessions.delete(params[0]);return {rowCount:Number(existed),rows:[]};
  }
  if(sql.includes('SELECT role FROM app_user_roles')){
   const role=roles.get(params[0])?.get(params[1]);
   return {rowCount:Number(Boolean(role)),rows:role?[{role}]:[]};
  }
  if(sql.includes('SELECT organization_id,role FROM app_user_roles')){
   const a=[...(roles.get(params[0])||new Map())].map(([organization_id,role])=>({organization_id,role}));
   return {rowCount:a.length,rows:a};
  }
  throw Error('Test DB query unimplemented: '+sql);
 }
};

function makeApp(){
 const app=express();app.use(express.json());
 const auth=createAuth(pool);
 app.use('/api/auth',auth.router);
 app.use('/api',auth.requireAuth,auth.csrf);
 app.get('/api/private',(_req,res)=>res.json({ok:true}));
 app.get('/api/org',auth.requireOrg,(req,res)=>res.json({org:req.orgId}));
 app.post('/api/org',auth.requireOrg,auth.requireRole('OPERATOR'),(req,res)=>res.json({ok:true,org:req.orgId}));
 app.patch('/api/kitchen',auth.requireOrg,auth.requireRole('KITCHEN'),(req,res)=>res.json({ok:true}));
 app.use((err,_req,res,_next)=>res.status(500).json({error:String(err.message)}));
 return app;
}
let server,base;
async function request(path,method='GET',body,token,origin){
 const headers={};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(token)headers.Cookie='hl_session='+token;
 if(origin)headers.Origin=origin;
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 return response;
}
async function login(username,password){
 const response=await request('/api/auth/login','POST',{username,password});
 const cookie=response.headers.get('set-cookie')||'';
 return {response,token:/hl_session=([a-f0-9]{64})/.exec(cookie)?.[1]};
}
test('HTTP authentication, role boundaries and session invalidation',async()=>{
 server=makeApp().listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await request('/api/private')).status,401,'unauthenticated API access denied');
  assert.equal((await login('pipeoperator','incorrect')).response.status,401,'invalid login denied');
  const auth=await login('pipeoperator','long-password-for-testing');
  assert.equal(auth.response.status,200,'valid login');
  assert.ok(auth.token,'session issued');
  assert.ok(sessions.has(hashToken(auth.token)),'only session token hash stored');
  assert.equal((await request('/api/private','GET',undefined,auth.token)).status,200);
  assert.equal((await request('/api/org?org_id=1','GET',undefined,auth.token)).status,200);
  assert.equal((await request('/api/org?org_id=2','GET',undefined,auth.token)).status,403,'other business denied');
  assert.equal((await request('/api/org','POST',{organization_id:1},auth.token)).status,403,'CSRF origin required');
  assert.equal((await request('/api/org','POST',{organization_id:1},auth.token,'https://attacker.example')).status,403,'cross origin denied');
  assert.equal((await request('/api/org','POST',{organization_id:1},auth.token,base)).status,200,'authorized mutation succeeds');
  const k=await login('kitchenstaff','long-kitchen-password');
  assert.equal(k.response.status,200);
  assert.equal((await request('/api/org','POST',{organization_id:2},k.token,base)).status,403,'kitchen cannot make accounting changes');
  assert.equal((await request('/api/kitchen','PATCH',{organization_id:2},k.token,base)).status,200,'kitchen allowed workflow action');
  assert.equal((await request('/api/kitchen','PATCH',{organization_id:1},k.token,base)).status,403,'kitchen cannot operate other company');
  assert.equal((await request('/api/auth/logout','POST',{},auth.token)).status,200);
  assert.equal((await request('/api/private','GET',undefined,auth.token)).status,401,'revoked session rejected');
 }finally{server.close();sessions.clear()}
});
