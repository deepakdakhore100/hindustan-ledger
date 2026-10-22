'use strict';
const root='/api/operations/';
const el=id=>document.getElementById(id);
const state={materials:[],products:[],zones:[],menu:[]};
function notify(message,error=false){const n=el('notice');n.textContent=message;n.style.display='block';n.className=error?'danger':'';window.scrollTo({top:0,behavior:'smooth'});}
async function api(path,options={}){const r=await fetch(root+path,{headers:{'Content-Type':'application/json'},...options});let d;try{d=await r.json()}catch{throw Error('Invalid server response')}if(!r.ok)throw Error(d.error||'Server error');return d}
async function action(fn){try{await fn()}catch(e){notify(e.message,true)}}
function td(tr,value){const x=document.createElement('td');x.textContent=String(value??'');tr.appendChild(x);return x}
function renderRows(id,records,render){const target=el(id);target.replaceChildren();if(!records.length){const tr=document.createElement('tr');td(tr,'No records yet');target.appendChild(tr);return}for(const a of records){const tr=document.createElement('tr');render(tr,a);target.appendChild(tr)}}
function fill(id,rows,label){const x=el(id);x.replaceChildren();for(const item of rows){const opt=document.createElement('option');opt.value=item.id;opt.textContent=label(item);x.appendChild(opt)}}
async function pipes(){
 const [materials,products,batches,zones,warehouse]=await Promise.all([api('pipes/materials'),api('pipes/products'),api('pipes/batches'),api('pipes/zones'),api('pipes/warehouse')]);Object.assign(state,{materials,products,zones});
 renderRows('materials',materials,(t,m)=>{td(t,m.name);td(t,m.quantity_on_hand);td(t,m.unit)});
 fill('stockMaterial',materials,m=>m.name+' ('+m.unit+')');fill('pipeProduct',products,p=>p.diameter_mm+'mm '+p.end_type);
 renderRows('batches',batches,(t,b)=>{td(t,b.batch_code);td(t,b.diameter_mm+'mm '+b.end_type);td(t,b.quantity);td(t,b.stage);const cell=td(t,'');
 if(b.stage!=='WAREHOUSE'){const btn=document.createElement('button');btn.textContent='Advance';btn.addEventListener('click',()=>action(async()=>{const body={};if(b.stage==='READY'){const zone=window.prompt('Warehouse zone ID: '+zones.map(x=>x.id+'='+x.name).join(', '));if(!zone)return;body.zone_id=Number(zone)}await api('pipes/batches/'+b.id+'/advance',{method:'POST',body:JSON.stringify(body)});notify('Batch stage updated');await pipes()}));cell.appendChild(btn)}});
 renderRows('warehouse',warehouse,(t,w)=>{td(t,w.lot_code);td(t,w.batch_code);td(t,w.zone);td(t,w.diameter_mm+'mm '+w.end_type);td(t,w.quantity)});
}
async function pos(){const [menu,orders]=await Promise.all([api('pos/menu'),api('pos/orders')]);state.menu=menu;renderRows('menu',menu,(t,m)=>{td(t,m.name);td(t,m.category);td(t,'₹'+m.price)});
 fill('orderItem',menu.filter(x=>x.available),x=>x.name+' ₹'+x.price);
 renderRows('orders',orders,(t,o)=>{td(t,o.order_no);td(t,(o.items||[]).map(x=>x.quantity+' × '+x.name).join(', '));td(t,o.channel);td(t,'₹'+o.total_amount);td(t,o.status);const c=td(t,'');
 const next={NEW:'PREPARING',PREPARING:'READY',READY:'COMPLETED'}[o.status];if(next){const b=document.createElement('button');b.textContent='Mark '+next;b.addEventListener('click',()=>action(async()=>{await api('pos/orders/'+o.id+'/status',{method:'PATCH',body:JSON.stringify({status:next})});notify('Order status updated');await pos()}));c.appendChild(b)}})}
el('pipesTab').onclick=()=>{el('pipes').classList.add('active');el('pos').classList.remove('active');el('pipesTab').className='';el('posTab').className='secondary';action(pipes)};
el('posTab').onclick=()=>{el('pos').classList.add('active');el('pipes').classList.remove('active');el('posTab').className='';el('pipesTab').className='secondary';action(pos)};
el('stockForm').onsubmit=e=>{e.preventDefault();action(async()=>{await api('pipes/materials/'+el('stockMaterial').value+'/stock',{method:'POST',body:JSON.stringify({direction:el('stockDirection').value,quantity:Number(el('stockQuantity').value),reference:el('stockReference').value})});notify('Stock movement saved');el('stockForm').reset();await pipes()})};
el('batchForm').onsubmit=e=>{e.preventDefault();action(async()=>{await api('pipes/batches',{method:'POST',body:JSON.stringify({product_id:Number(el('pipeProduct').value),quantity:Number(el('pipeQuantity').value),notes:el('pipeNotes').value})});notify('Production batch created');el('batchForm').reset();await pipes()})};
el('menuForm').onsubmit=e=>{e.preventDefault();action(async()=>{await api('pos/menu',{method:'POST',body:JSON.stringify({name:el('dishName').value,category:el('dishCategory').value,price:Number(el('dishPrice').value)})});notify('Menu item saved');el('menuForm').reset();await pos()})};
el('orderForm').onsubmit=e=>{e.preventDefault();action(async()=>{await api('pos/orders',{method:'POST',body:JSON.stringify({channel:el('orderChannel').value,table_label:el('tableLabel').value,items:[{menu_item_id:Number(el('orderItem').value),quantity:Number(el('orderQuantity').value)}]})});notify('Order sent to kitchen');el('orderForm').reset();await pos()})};
action(pipes);
