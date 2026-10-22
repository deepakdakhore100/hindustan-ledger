'use strict';
const bundleSize=diameter=>({300:3,450:2,600:1})[Number(diameter)];
const requiredMinutes={DRY_CURING:1440,WATER_CURING:7200};
module.exports={bundleSize,requiredMinutes,attach(router,pool){
 const handle=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{console.error('Advanced operations failed',e.message);res.status(e.status||500).json({error:e.status?e.message:'Operation failed'})});
 const bad=(msg,status=400)=>Object.assign(new Error(msg),{status});
 const org=async(db)=>{const r=await db.query("SELECT id FROM organizations WHERE name='Hindustan Pipes'");if(!r.rowCount)throw bad('Business missing',503);return r.rows[0].id};
 router.get('/pipes/jobs',handle(async(req,res)=>{const id=await org(pool);const r=await pool.query('SELECT j.*,p.diameter_mm,p.end_type FROM production_jobs j JOIN pipe_products p ON p.id=j.product_id AND p.organization_id=j.organization_id WHERE j.organization_id=$1 ORDER BY j.id DESC LIMIT 100',[id]);res.json(r.rows)}));
 router.post('/pipes/jobs',handle(async(req,res)=>{const id=await org(pool),quantity=Number(req.body.quantity),product_id=Number(req.body.product_id);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)throw bad('Quantity must be 1-1000');const p=await pool.query('SELECT id FROM pipe_products WHERE organization_id=$1 AND id=$2 AND active',[id,product_id]);if(!p.rowCount)throw bad('Unknown product');const code='JOB-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase();const r=await pool.query('INSERT INTO production_jobs(organization_id,product_id,quantity,job_code,machine_label,die_label,operator_note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,product_id,quantity,code,String(req.body.machine_label||'').slice(0,80),String(req.body.die_label||'').slice(0,80),String(req.body.operator_note||'').slice(0,500)]);await pool.query("INSERT INTO production_job_history(job_id,to_step,changed_by) VALUES($1,'IRON_FABRICATION',$2)",[r.rows[0].id,req.user?.id||null]);res.status(201).json(r.rows[0])}));
 router.post('/pipes/jobs/:id/advance',handle(async(req,res)=>{const db=await pool.connect();try{await db.query('BEGIN');const id=await org(db),r=await db.query('SELECT * FROM production_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE',[req.params.id,id]);if(!r.rowCount)throw bad('Job not found',404);const job=r.rows[0],next={IRON_FABRICATION:'PRECAST_SETUP',PRECAST_SETUP:'DIE_FILLING',DIE_FILLING:'CAST_COMPLETE'}[job.step];if(!next)throw bad('Job already complete');const note=String(req.body.note||'').slice(0,500);await db.query('UPDATE production_jobs SET step=$1,step_changed_at=now(),operator_note=$2 WHERE id=$3',[next,note,job.id]);await db.query('INSERT INTO production_job_history(job_id,from_step,to_step,note,changed_by) VALUES($1,$2,$3,$4,$5)',[job.id,job.step,next,note,req.user?.id||null]);await db.query('COMMIT');res.json({id:job.id,step:next})}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}));
 router.post('/pipes/jobs/:id/cast-to-batch',handle(async(req,res)=>{
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const id=await org(db);
  const rows=await db.query('SELECT * FROM production_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE',[req.params.id,id]);
  const job=rows.rows[0];if(!job)throw bad('Job not found',404);
  if(job.batch_id)throw bad('Job already converted to curing batch',409);
  if(job.step!=='CAST_COMPLETE')throw bad('Finish iron, precast and die-filling stages first');
  const recipe=(await db.query('SELECT raw_material_id,qty_per_pipe FROM pipe_recipes WHERE organization_id=$1 AND product_id=$2',[id,job.product_id])).rows;
  if(!recipe.length)throw bad('Verified pipe recipe required before casting');
  const code='PB-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
  const inserted=await db.query("INSERT INTO production_batches(organization_id,product_id,batch_code,quantity,stage,notes) VALUES($1,$2,$3,$4,'DRY_CURING',$5) RETURNING *",[id,job.product_id,code,job.quantity,'Fabrication job '+job.job_code]);
  const batch=inserted.rows[0];
  for(const part of recipe){
   const used=Math.round(Number(part.qty_per_pipe)*Number(job.quantity)*1000)/1000;
   if(!Number.isFinite(used)||used<=0)throw bad('Invalid material quantity');
   const stock=await db.query('UPDATE raw_materials SET quantity_on_hand=quantity_on_hand-$1 WHERE id=$2 AND organization_id=$3 AND quantity_on_hand >= $1 RETURNING id',[used,part.raw_material_id,id]);
   if(!stock.rowCount)throw bad('Insufficient material '+part.raw_material_id);
   await db.query("INSERT INTO raw_material_movements(organization_id,raw_material_id,quantity_delta,reason,reference) VALUES($1,$2,$3,'PRODUCTION',$4)",[id,part.raw_material_id,-used,code]);
   await db.query('INSERT INTO batch_material_usage(organization_id,batch_id,raw_material_id,quantity_used) VALUES($1,$2,$3,$4)',[id,batch.id,part.raw_material_id,used]);
  }
  await db.query("INSERT INTO batch_stage_history(organization_id,batch_id,to_stage) VALUES($1,$2,'DRY_CURING')",[id,batch.id]);
  await db.query('UPDATE production_jobs SET batch_id=$1 WHERE id=$2',[batch.id,job.id]);
  await db.query('COMMIT');res.status(201).json({batch_id:batch.id,batch_code:code,stage:'DRY_CURING'});
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }));
 router.get('/pipes/analytics',handle(async(req,res)=>{const id=await org(pool);const [stages,consumption,warehouse,jobs]=await Promise.all([
 pool.query('SELECT p.diameter_mm,p.end_type,b.stage,SUM(b.quantity)::int AS pipes FROM production_batches b JOIN pipe_products p ON p.id=b.product_id WHERE b.organization_id=$1 GROUP BY p.diameter_mm,p.end_type,b.stage ORDER BY p.diameter_mm,p.end_type,b.stage',[id]),
 pool.query("SELECT date_trunc('week',m.created_at)::date AS week,r.name,r.unit,SUM(-m.quantity_delta) AS consumed FROM raw_material_movements m JOIN raw_materials r ON r.id=m.raw_material_id AND r.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.reason='PRODUCTION' AND m.created_at>=now()-interval '90 days' GROUP BY 1,2,3 ORDER BY 1 DESC,2",[id]),
 pool.query('SELECT p.diameter_mm,p.end_type,z.name AS zone,SUM(w.quantity)::int AS pipes FROM warehouse_lots w JOIN production_batches b ON b.id=w.batch_id JOIN pipe_products p ON p.id=b.product_id JOIN warehouse_zones z ON z.id=w.zone_id WHERE w.organization_id=$1 GROUP BY p.diameter_mm,p.end_type,z.name ORDER BY p.diameter_mm,z.name',[id]),
 pool.query('SELECT step,COUNT(*)::int AS jobs,SUM(quantity)::int AS pipes FROM production_jobs WHERE organization_id=$1 GROUP BY step',[id])
 ]);res.json({stages:stages.rows,weekly_consumption:consumption.rows,warehouse:warehouse.rows,production_jobs:jobs.rows})}));
 router.get('/pipes/bundles',handle(async(req,res)=>{const id=await org(pool);const r=await pool.query('SELECT b.bundle_code,b.pipe_quantity,b.is_partial,w.lot_code,p.diameter_mm,p.end_type,z.name AS zone FROM warehouse_bundles b JOIN warehouse_lots w ON w.id=b.lot_id JOIN production_batches x ON x.id=w.batch_id JOIN pipe_products p ON p.id=x.product_id JOIN warehouse_zones z ON z.id=w.zone_id WHERE b.organization_id=$1 ORDER BY b.id DESC LIMIT 200',[id]);res.json(r.rows)}));
 router.post('/pipes/lots/:id/generate-bundles',handle(async(req,res)=>{const db=await pool.connect();try{await db.query('BEGIN');const id=await org(db);const l=await db.query('SELECT w.*,p.diameter_mm FROM warehouse_lots w JOIN production_batches b ON b.id=w.batch_id JOIN pipe_products p ON p.id=b.product_id WHERE w.id=$1 AND w.organization_id=$2 FOR UPDATE OF w',[req.params.id,id]);if(!l.rowCount)throw bad('Warehouse lot not found',404);const lot=l.rows[0],size=bundleSize(lot.diameter_mm);const existing=await db.query('SELECT count(*)::int AS n FROM warehouse_bundles WHERE lot_id=$1',[lot.id]);if(existing.rows[0].n)throw bad('Bundles already generated for this lot',409);let remaining=Number(lot.quantity),index=0;while(remaining){index++;const qty=Math.min(size,remaining);await db.query('INSERT INTO warehouse_bundles(organization_id,lot_id,bundle_code,bundle_index,pipe_quantity,is_partial) VALUES($1,$2,$3,$4,$5,$6)',[id,lot.id,lot.lot_code+'-B'+String(index).padStart(3,'0'),index,qty,qty<size]);remaining-=qty}await db.query('COMMIT');res.status(201).json({bundles:index,lot:lot.lot_code,capacity:size})}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}));
 router.get('/pipes/finished-goods',handle(async(req,res)=>{const id=await org(pool);res.json((await pool.query('SELECT * FROM finished_goods_catalog WHERE organization_id=$1 ORDER BY category,name',[id])).rows)}));
 router.post('/pipes/finished-goods',handle(async(req,res)=>{const id=await org(pool),{sku,name,category}=req.body;if(!['PAVING_BLOCK','JOINTER'].includes(category)||!String(sku||'').trim()||!String(name||'').trim())throw bad('SKU, name and valid category required');const r=await pool.query('INSERT INTO finished_goods_catalog(organization_id,sku,name,category) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,sku) DO UPDATE SET name=EXCLUDED.name RETURNING *',[id,String(sku).trim().slice(0,50),String(name).trim().slice(0,120),category]);res.status(201).json(r.rows[0])}));
 }};
