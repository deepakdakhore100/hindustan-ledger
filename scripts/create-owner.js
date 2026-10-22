'use strict';
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {hashPassword}=require('../auth');
async function main(){
 const username=String(process.env.ADMIN_USERNAME||'').trim().toLowerCase();
 const password=String(process.env.ADMIN_PASSWORD||'');
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 if(!/^[a-z0-9._-]{3,80}$/.test(username))throw Error('ADMIN_USERNAME must be 3–80 lowercase letters, digits or ._-');
 if(password.length<14||password.length>512)throw Error('ADMIN_PASSWORD must be 14–512 characters');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  const salt=crypto.randomBytes(32).toString('hex');
  const hash=hashPassword(password,salt);
  const result=await pool.query("INSERT INTO app_users(username,password_salt,password_hash,is_owner) VALUES($1,$2,$3,true) ON CONFLICT(username) DO NOTHING RETURNING id",[username,salt,hash]);
  if(!result.rowCount)throw Error('Username already exists. No changes made.');
  process.stdout.write('Owner created successfully. Remove ADMIN_PASSWORD from your environment.\n');
 }finally{await pool.end()}
}
main().catch(err=>{console.error(err.message);process.exitCode=1});
