'use strict';
const crypto=require('node:crypto');
const express=require('express');
const COOKIE='hl_session';
const parseCookie=(header='')=>Object.fromEntries(String(header).split(';').map(p=>p.trim().split('=')).filter(p=>p.length===2));
const hashPassword=(password,salt)=>crypto.scryptSync(password,salt,64).toString('hex');
const hashToken=token=>crypto.createHash('sha256').update(token).digest('hex');
const checkPassword=(password,salt,hash)=>{const expected=Buffer.from(hash,'hex');const actual=Buffer.from(hashPassword(password,salt),'hex');return expected.length===actual.length && crypto.timingSafeEqual(expected,actual)};
const roles={ADMIN:3,OPERATOR:2,KITCHEN:1};
function createAuth(pool){
 const router=express.Router();
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 const cookieOpts=()=>'; Path=/; HttpOnly; SameSite=Strict'+(process.env.NODE_ENV==='production'?'; Secure':'');
 const setCookie=(res,token,age)=>res.setHeader('Set-Cookie',COOKIE+'='+token+cookieOpts()+'; Max-Age='+age);
 const attempts=new Map();
 function throttle(ip){const key=String(ip||'unknown');const n=Date.now(),v=attempts.get(key)||{count:0,until:n+15*60*1000};if(n>v.until){attempts.delete(key);return false}return v.count>=10}
 function failed(ip){const key=String(ip||'unknown'),n=Date.now(),v=attempts.get(key)||{count:0,until:n+15*60*1000};v.count++;attempts.set(key,v);if(attempts.size>10000)attempts.clear()}
 router.post('/login',wrap(async(req,res)=>{
  const username=String(req.body?.username||'').toLowerCase().trim();
  const password=req.body?.password;
  if(throttle(req.ip))return res.status(429).json({error:'Too many attempts. Try later'});
  if(!/^[a-z0-9._-]{3,80}$/.test(username)||typeof password!=='string'||password.length>512){failed(req.ip);return res.status(401).json({error:'Invalid credentials'})}
  const found=await pool.query('SELECT id,username,password_salt,password_hash,is_owner FROM app_users WHERE username=$1 AND is_active=true',[username]);
  const user=found.rows[0];
  if(!user||!checkPassword(password,user.password_salt,user.password_hash)){failed(req.ip);return res.status(401).json({error:'Invalid credentials'})}
  attempts.delete(String(req.ip||'unknown'));
  const token=crypto.randomBytes(32).toString('hex');
  await pool.query("INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '12 hours')",[user.id,hashToken(token)]);
  setCookie(res,token,43200);res.json({username:user.username,is_owner:user.is_owner});
 }));
 router.post('/logout',wrap(async(req,res)=>{
  const token=parseCookie(req.headers.cookie)[COOKIE];
  if(token)await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[hashToken(token)]);
  setCookie(res,'',0);res.json({ok:true});
 }));
 async function requireAuth(req,res,next){
  try{
   const token=parseCookie(req.headers.cookie)[COOKIE];
   if(!token||!/^[a-f0-9]{64}$/.test(token))return res.status(401).json({error:'Login required'});
   const r=await pool.query("SELECT u.id,u.username,u.is_owner FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active=true",[hashToken(token)]);
   if(!r.rowCount)return res.status(401).json({error:'Session expired'});
   req.user=r.rows[0];next();
  }catch(e){next(e)}
 }
 function csrf(req,res,next){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  if(req.path==='/api/auth/login'||req.path==='/api/auth/logout')return next();
  const origin=req.headers.origin;
  const host=req.headers.host;
  if(!origin||!host)return res.status(403).json({error:'Same-origin request required'});
  let expected;try{expected=new URL(origin)}catch{return res.status(403).json({error:'Invalid origin'})}
  if(expected.host!==host||!['http:','https:'].includes(expected.protocol))return res.status(403).json({error:'Invalid origin'});
  next();
 }
 async function requireOrg(req,res,next){
  try{
   const id=Number(req.params.orgId||req.query.org_id||req.body?.organization_id);
   if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'Valid organization required'});
   if(req.user.is_owner){req.orgId=id;return next()}
   const r=await pool.query('SELECT role FROM app_user_roles WHERE user_id=$1 AND organization_id=$2',[req.user.id,id]);
   if(!r.rowCount)return res.status(403).json({error:'No organization access'});
   req.orgId=id;req.orgRole=r.rows[0].role;next();
  }catch(e){next(e)}
 }
 function requireRole(required){return (req,res,next)=>{
  if(req.user?.is_owner||roles[req.orgRole]>=roles[required])return next();
  res.status(403).json({error:'Insufficient permissions'});
 }}
 router.get('/me',requireAuth,wrap(async(req,res)=>{
  const r=await pool.query('SELECT organization_id,role FROM app_user_roles WHERE user_id=$1',[req.user.id]);
  res.json({username:req.user.username,is_owner:req.user.is_owner,roles:r.rows});
 }));
 return {router,requireAuth,requireOrg,requireRole,csrf};
}
module.exports={createAuth,hashPassword,hashToken,checkPassword};
