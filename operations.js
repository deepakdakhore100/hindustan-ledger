const express = require('express');
const router = express.Router();
const pipeOrg = "Hindustan Pipes", posOrg = "BBQ Pav Bhaji Chain";

module.exports = function operations(pool, auth) {
  router.use(async(req,res,next)=>{
    try{
      const name=req.path.startsWith('/pipes/')?pipeOrg:req.path.startsWith('/pos/')?posOrg:null;
      if(!name)return res.status(404).json({error:'Unknown module'});
      const r=await pool.query('SELECT id FROM organizations WHERE name=$1',[name]);
      if(!r.rowCount)return res.status(503).json({error:'Business not configured'});
      req.body=req.body||{};
      req.body.organization_id=r.rows[0].id;
      req.params.orgId=r.rows[0].id;
      req.query.org_id=String(r.rows[0].id);
      await auth.requireOrg(req,res,()=>auth.requireRole(
        (name===posOrg && req.method==='PATCH')?'KITCHEN':(req.method==='GET'?'KITCHEN':'OPERATOR')
      )(req,res,next));
    }catch(e){next(e)}
  });
  const wrap = fn => (req,res) => Promise.resolve(fn(req,res)).catch(e => {
    console.error('Operations request failed',e);
    res.status(e.status || 500).json({error: e.status ? e.message : 'Operation failed'});
  });
  const fail = (status,message) => Object.assign(new Error(message),{status});
  const orgId = async (db,name) => {
    const r=await db.query('SELECT id FROM organizations WHERE name=$1',[name]);
    if(!r.rowCount) throw fail(404,'Organization not configured: '+name);
    return r.rows[0].id;
  };
  const positive = (x,label) => {
    const n=Number(x); if(!Number.isFinite(n)||n<=0) throw fail(400,label+' must be positive');return n;
  };
  const money = x => Math.round((Number(x)+Number.EPSILON)*100)/100;
  const qty3 = x => Math.round((Number(x)+Number.EPSILON)*1000)/1000;
  router.get('/pipes/materials',wrap(async(req,res)=>{
    const id=await orgId(pool,pipeOrg);
    res.json((await pool.query('SELECT id,code,name,unit,quantity_on_hand,reorder_level,unit_cost FROM raw_materials WHERE organization_id=$1 ORDER BY name',[id])).rows);
  }));
  router.post('/pipes/materials/:id/stock',wrap(async(req,res)=>{
    const qty=Number(req.body.quantity), direction=req.body.direction;
    if(!Number.isFinite(qty)||qty<=0||!['IN','OUT'].includes(direction)) throw fail(400,'Enter a positive quantity and IN/OUT');
    const delta=direction==='IN'?qty:-qty;
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const id=await orgId(client,pipeOrg);
      const r=await client.query('UPDATE raw_materials SET quantity_on_hand=quantity_on_hand+$1 WHERE id=$2 AND organization_id=$3 AND quantity_on_hand+$1>=0 RETURNING *',[delta,req.params.id,id]);
      if(!r.rowCount) throw fail(400,'Material not found or insufficient stock');
      await client.query("INSERT INTO raw_material_movements(organization_id,raw_material_id,quantity_delta,reason,reference) VALUES($1,$2,$3,'ADJUSTMENT',$4)",[id,req.params.id,delta,String(req.body.reference||'Manual stock entry').slice(0,120)]);
      await client.query('COMMIT');res.status(201).json(r.rows[0]);
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }));
  router.get('/pipes/products',wrap(async(req,res)=>{
    const id=await orgId(pool,pipeOrg);
    res.json((await pool.query('SELECT id,diameter_mm,end_type,unit_price FROM pipe_products WHERE organization_id=$1 AND active ORDER BY diameter_mm,end_type',[id])).rows);
  }));
  router.get('/pipes/recipes',wrap(async(req,res)=>{
    const id=await orgId(pool,pipeOrg);
    res.json((await pool.query('SELECT r.product_id,r.raw_material_id,r.qty_per_pipe,m.name AS material_name,m.unit,p.diameter_mm,p.end_type FROM pipe_recipes r JOIN raw_materials m ON m.id=r.raw_material_id JOIN pipe_products p ON p.id=r.product_id WHERE r.organization_id=$1 ORDER BY p.diameter_mm,p.end_type,m.name',[id])).rows);
  }));
  router.put('/pipes/products/:id/recipe',wrap(async(req,res)=>{
    const items=req.body.items;
    if(!Array.isArray(items)||!items.length||items.length>30) throw fail(400,'Provide 1–30 materials for recipe');
    const seen=new Set();
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const id=await orgId(client,pipeOrg);
      const product=(await client.query('SELECT id FROM pipe_products WHERE id=$1 AND organization_id=$2 FOR UPDATE',[req.params.id,id])).rows[0];
      if(!product) throw fail(404,'Product not found');
      const parts=[];
      for(const item of items){
        const materialId=Number(item.raw_material_id), qty=Number(item.qty_per_pipe);
        if(!Number.isSafeInteger(materialId)||!Number.isFinite(qty)||qty<=0||qty>100000||Math.abs(qty*1000-Math.round(qty*1000))>0.000001||seen.has(materialId)) throw fail(400,'Invalid or duplicate material in recipe');
        seen.add(materialId);
        const m=await client.query('SELECT id FROM raw_materials WHERE id=$1 AND organization_id=$2',[materialId,id]);
        if(!m.rowCount) throw fail(400,'Material not in Hindustan Pipes');
        parts.push({materialId,qty});
      }
      await client.query('DELETE FROM pipe_recipes WHERE organization_id=$1 AND product_id=$2',[id,product.id]);
      for(const p of parts) await client.query('INSERT INTO pipe_recipes(organization_id,product_id,raw_material_id,qty_per_pipe) VALUES($1,$2,$3,$4)',[id,product.id,p.materialId,p.qty]);
      await client.query('COMMIT');res.json({product_id:product.id,materials:parts.length});
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }));
  router.get('/pipes/batches',wrap(async(req,res)=>{
    const id=await orgId(pool,pipeOrg);
    res.json((await pool.query('SELECT b.id,b.batch_code,b.quantity,b.stage,b.started_at,b.stage_changed_at,p.diameter_mm,p.end_type FROM production_batches b JOIN pipe_products p ON p.id=b.product_id AND p.organization_id=b.organization_id WHERE b.organization_id=$1 ORDER BY b.id DESC LIMIT 100',[id])).rows);
  }));
  router.post('/pipes/batches',wrap(async(req,res)=>{
    const qty=positive(req.body.quantity,'Quantity');
    if(!Number.isSafeInteger(qty)||qty>1000) throw fail(400,'Batch quantity must be a whole number from 1 to 1000');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const id=await orgId(client,pipeOrg);
      const product=(await client.query('SELECT id FROM pipe_products WHERE id=$1 AND organization_id=$2 AND active',[req.body.product_id,id])).rows[0];
      if(!product) throw fail(400,'Invalid pipe product');
      const recipe=(await client.query('SELECT raw_material_id,qty_per_pipe FROM pipe_recipes WHERE organization_id=$1 AND product_id=$2',[id,product.id])).rows;
      if(!recipe.length) throw fail(400,'Configure a per-pipe material recipe before production');
      const code='PB-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
      const batch=(await client.query("INSERT INTO production_batches(organization_id,product_id,batch_code,quantity,stage,notes) VALUES($1,$2,$3,$4,'DRY_CURING',$5) RETURNING *",[id,product.id,code,qty,String(req.body.notes||'').slice(0,500)])).rows[0];
      for(const r of recipe){
        const used=qty3(Number(r.qty_per_pipe)*qty);
        if(used<=0) throw fail(400,'Material recipe quantity too small');
        const stock=await client.query('UPDATE raw_materials SET quantity_on_hand=quantity_on_hand-$1 WHERE id=$2 AND organization_id=$3 AND quantity_on_hand >= $1 RETURNING id',[used,r.raw_material_id,id]);
        if(!stock.rowCount) throw fail(400,'Insufficient inventory for material '+r.raw_material_id);
        await client.query('INSERT INTO raw_material_movements(organization_id,raw_material_id,quantity_delta,reason,reference) VALUES($1,$2,$3,$4,$5)',[id,r.raw_material_id,-used,'PRODUCTION',code]);
        await client.query('INSERT INTO batch_material_usage(organization_id,batch_id,raw_material_id,quantity_used) VALUES($1,$2,$3,$4)',[id,batch.id,r.raw_material_id,used]);
      }
      await client.query("INSERT INTO batch_stage_history(organization_id,batch_id,to_stage) VALUES($1,$2,'DRY_CURING')",[id,batch.id]);
      await client.query('COMMIT');res.status(201).json(batch);
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }));
  router.post('/pipes/batches/:id/advance',wrap(async(req,res)=>{
    const stages=['DRY_CURING','WATER_CURING','READY','WAREHOUSE'];
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const id=await orgId(client,pipeOrg);
      const r=await client.query('SELECT * FROM production_batches WHERE id=$1 AND organization_id=$2 FOR UPDATE',[req.params.id,id]);
      if(!r.rowCount) throw fail(404,'Batch not found');
      const batch=r.rows[0], idx=stages.indexOf(batch.stage);
      if(idx<0||idx===stages.length-1) throw fail(400,'Batch already in final stage');
      const next=stages[idx+1];
      if(next==='WAREHOUSE'){
        const zone=(await client.query('SELECT id FROM warehouse_zones WHERE id=$1 AND organization_id=$2',[req.body.zone_id,id])).rows[0];
        if(!zone) throw fail(400,'Choose a warehouse zone');
        await client.query('INSERT INTO warehouse_lots(organization_id,batch_id,zone_id,lot_code,quantity) VALUES($1,$2,$3,$4,$5)',[id,batch.id,zone.id,'WH-'+batch.batch_code,batch.quantity]);
      }
      await client.query('UPDATE production_batches SET stage=$1,stage_changed_at=NOW() WHERE id=$2',[next,batch.id]);
      await client.query('INSERT INTO batch_stage_history(organization_id,batch_id,from_stage,to_stage) VALUES($1,$2,$3,$4)',[id,batch.id,batch.stage,next]);
      await client.query('COMMIT');res.json({batch_id:batch.id,stage:next});
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }));
  router.get('/pipes/zones',wrap(async(req,res)=>{
    const id=await orgId(pool,pipeOrg);
    res.json((await pool.query('SELECT id,code,name FROM warehouse_zones WHERE organization_id=$1 ORDER BY code',[id])).rows);
  }));
  router.get('/pipes/warehouse',wrap(async(req,res)=>{
    const id=await orgId(pool,pipeOrg);
    res.json((await pool.query('SELECT w.lot_code,w.quantity,z.name AS zone,b.batch_code,p.diameter_mm,p.end_type FROM warehouse_lots w JOIN warehouse_zones z ON z.id=w.zone_id JOIN production_batches b ON b.id=w.batch_id JOIN pipe_products p ON p.id=b.product_id WHERE w.organization_id=$1 ORDER BY w.id DESC',[id])).rows);
  }));
  router.get('/pos/menu',wrap(async(req,res)=>{
    const id=await orgId(pool,posOrg);
    res.json((await pool.query('SELECT id,name,category,price,available FROM pos_menu_items WHERE organization_id=$1 ORDER BY category,name',[id])).rows);
  }));
  router.post('/pos/menu',wrap(async(req,res)=>{
    const id=await orgId(pool,posOrg);
    const name=String(req.body.name||'').trim(), category=String(req.body.category||'Main').slice(0,80),price=Number(req.body.price);
    if(!name||name.length>120||!Number.isFinite(price)||price<0) throw fail(400,'Name and nonnegative price required');
    const r=await pool.query('INSERT INTO pos_menu_items(organization_id,name,category,price) VALUES($1,$2,$3,$4) RETURNING *',[id,name,category,money(price)]);
    res.status(201).json(r.rows[0]);
  }));
  router.get('/pos/orders',wrap(async(req,res)=>{
    const id=await orgId(pool,posOrg);
    res.json((await pool.query("SELECT o.*,COALESCE(json_agg(json_build_object('name',i.name_snapshot,'quantity',i.quantity,'price',i.unit_price)) FILTER(WHERE i.id IS NOT NULL),'[]'::json) AS items FROM pos_orders o LEFT JOIN pos_order_items i ON i.order_id=o.id AND i.organization_id=o.organization_id WHERE o.organization_id=$1 GROUP BY o.id ORDER BY o.id DESC LIMIT 100",[id])).rows);
  }));
  router.post('/pos/orders',wrap(async(req,res)=>{
    const items=req.body.items,channel=req.body.channel;
    if(!Array.isArray(items)||!items.length||items.length>50||!['DINE_IN','TAKEAWAY','ONLINE_MANUAL'].includes(channel)) throw fail(400,'Valid channel and 1–50 items required');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const id=await orgId(client,posOrg);
      let totalCents=0;const lines=[];
      for(const item of items){
        const qty=positive(item.quantity,'Item quantity');
        if(!Number.isInteger(qty)||qty>500) throw fail(400,'Item quantity must be an integer up to 500');
        const menu=(await client.query('SELECT id,name,price FROM pos_menu_items WHERE organization_id=$1 AND id=$2 AND available',[id,item.menu_item_id])).rows[0];
        if(!menu) throw fail(400,'Menu item not found or unavailable');
        const lineCents=Math.round(Number(menu.price)*100)*qty;
        totalCents+=lineCents;lines.push({menu,qty,lineCents});
      }
      if(totalCents>1000000000) throw fail(400,'Order total too high');
      const no='POS-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
      const order=(await client.query('INSERT INTO pos_orders(organization_id,order_no,channel,table_label,subtotal,total_amount,payment_method,notes) VALUES($1,$2,$3,$4,$5,$5,$6,$7) RETURNING *',[id,no,channel,String(req.body.table_label||'').slice(0,40),totalCents/100,'UNPAID',String(req.body.notes||'').slice(0,500)])).rows[0];
      for(const l of lines) await client.query('INSERT INTO pos_order_items(organization_id,order_id,menu_item_id,name_snapshot,quantity,unit_price,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,order.id,l.menu.id,l.menu.name,l.qty,l.menu.price,l.lineCents/100]);
      await client.query('COMMIT');res.status(201).json(order);
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }));
  router.patch('/pos/orders/:id/status',wrap(async(req,res)=>{
    const transitions={NEW:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['COMPLETED'],COMPLETED:[],CANCELLED:[]};
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const id=await orgId(client,posOrg);
      const r=await client.query('SELECT * FROM pos_orders WHERE id=$1 AND organization_id=$2 FOR UPDATE',[req.params.id,id]);
      if(!r.rowCount) throw fail(404,'Order not found');
      if(!transitions[r.rows[0].status].includes(req.body.status)) throw fail(400,'Invalid order status transition');
      const out=await client.query('UPDATE pos_orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[req.body.status,req.params.id]);
      await client.query('COMMIT');res.json(out.rows[0]);
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }));
  return router;
};
