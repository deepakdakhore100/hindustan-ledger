'use strict';
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {hashPassword}=require('../auth');
async function main(){
 const username=String(process.env.STAFF_USERNAME||'').trim().toLowerCase();
 const password=String(process.env.STAFF_PASSWORD||'');
 const org=String(process.env.STAFF_ORGANIZATION||'');
 const role=String(process.env.STAFF_ROLE||'').toUpperCase();
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
 if(!/^[a-z0-9._-]{3,80}$/.test(username)||password.length<14||password.length>512)throw Error('Valid username and password length >=14 required');
 if(!['ADMIN','OPERATOR','KITCHEN'].includes(role))throw Error('STAFF_ROLE must be ADMIN, OPERATOR or KITCHEN');
 if(!['Hindustan Pipes','BBQ Pav Bhaji Chain'].includes(org))throw Error('STAFF_ORGANIZATION must match existing business name');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const o=await client.query('SELECT id FROM organizations WHERE name=$1',[org]);
  if(!o.rowCount)throw Error('Business not found');
  const salt=crypto.randomBytes(32).toString('hex');
  const user=await client.query('INSERT INTO app_users(username,password_salt,password_hash) VALUES($1,$2,$3) RETURNING id',[username,salt,hashPassword(password,salt)]);
  await client.query('INSERT INTO app_user_roles(user_id,organization_id,role) VALUES($1,$2,$3)',[user.rows[0].id,o.rows[0].id,role]);
  await client.query('COMMIT');console.log('Staff user created: '+username+' ('+role+' / '+org+')');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release();await pool.end()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
