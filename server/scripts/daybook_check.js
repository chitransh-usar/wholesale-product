const Module=require("module");const {Pool}=require("pg");
const dbPath=require.resolve("../src/config/db");
const tp=new Pool({connectionString:`postgres://postgres@127.0.0.1:5433/${process.argv[2]||"qa_daybook_check"}`});
const st=new Module(dbPath,null);st.exports=tp;st.loaded=true;require.cache[dbPath]=st;
const db=require("../src/controllers/dayBookController");
const oc=require("../src/controllers/orderController");
const pc=require("../src/controllers/productController");
const mk=()=>{const r={statusCode:0,body:null};r.status=c=>(r.statusCode=c,r);r.json=b=>(r.body=b,r);return r;};
let f=0;const ck=(p,l,e)=>{if(!p)f++;console.log(`  ${p?"PASS":"FAIL"}  ${l}${e!==undefined?"   "+JSON.stringify(e):""}`);};
(async()=>{
 const s=Date.now().toString(36).slice(-6),d=String(Date.now()).slice(-7);
 const o=(await tp.query(`INSERT INTO users (first_name,last_name,email,password_hash,phone,role) VALUES ('S','H',$1,'x',$2,'seller') RETURNING id`,[`s-${s}@x.com`,`74${d}`])).rows[0].id;
 await tp.query(`INSERT INTO wholesaler_profiles (user_id,company_name,gstin,city,warehouse_state) VALUES ($1,$2,'27AAAPA1234A1Z5','Bhiwandi','Maharashtra')`,[o,`S ${s}`]);
 await tp.query(`INSERT INTO invoice_settings (user_id,prefix) VALUES ($1,$2)`,[o,`S${s}/`]);
 const pty=(await tp.query(`INSERT INTO parties (wholesaler_id,name,city,state,phone) VALUES ($1,$2,'Surat','Gujarat',$3) RETURNING id`,[o,`Ramesh ${s}`,`98${d}`])).rows[0].id;
 await pc.addProduct({user:{id:o,role:"seller"},body:{name:`Cloth ${s}`,category:"T",price:100,moq:1,stock:500,shippingDays:2,unit:"mtr",visibility:"public"}},mk());
 const li=(await tp.query(`SELECT id FROM supplier_inventory WHERE supplier_id=$1`,[o])).rows[0].id;

 const today=new Date().toISOString().slice(0,10);
 const ask=async(from,to)=>{const r=mk();
   await db.getDayBook({user:{id:o,role:"seller"},query:{from,to}},r);return r;};

 console.log("\nA. A day whose only activity is an order the trader typed in");
 const mo=mk();
 await oc.createManualOrder({user:{id:o,role:"seller"},body:{partyId:pty,
   lines:[{itemName:`Cloth ${s}`,quantity:40,rate:100,unit:"mtr",productId:li}]}},mo);
 ck(mo.statusCode===201,"the order was taken",mo.body?.order_number||mo.body?.message);
 const r1=await ask(today,today);
 ck(r1.statusCode===200,"the day book answered",r1.body?.message);
 console.log("     kinds today:",JSON.stringify((r1.body?.entries||[]).map(e=>e.kind)));
 ck((r1.body?.entries||[]).length>0,"the day he took an order is not an empty day");

 console.log("\nB. Shipping it puts the bill beside the order, and counts once");
 const adv=async(id,s)=>{const r=mk();
   await oc.updateOrderStatus({user:{id:o,role:"seller"},params:{orderId:id},body:{status:s}},r);return r;};
 for (const step of ["processing","packed","ready_for_pickup","shipped"]) await adv(mo.body.id,step);
 const rb=await ask(today,today);
 const kinds=(rb.body?.entries||[]).map(e=>e.kind);
 console.log("     kinds today:",JSON.stringify(kinds));
 ck(kinds.includes("order"),"the order is still there");
 ck(kinds.includes("sale")&&kinds.includes("invoice"),"and the sale and the bill are beside it");
 ck(Number(rb.body?.money?.sold)===4000,
   "sold counts the sale once, and not the order as well",rb.body?.money);

 console.log("\nC. And a database that has no credit notes at all");
 await tp.query("DROP TABLE IF EXISTS credit_note_items");
 await tp.query("DROP TABLE IF EXISTS credit_notes");
 // schemaExtras caches, so clear it the way a fresh process would see it.
 const ir=require.resolve("../src/repositories/invoiceRepository");
 delete require.cache[ir];
 const dbPath2=require.resolve("../src/controllers/dayBookController");
 delete require.cache[dbPath2];
 const db2=require("../src/controllers/dayBookController");
 const r2=mk();
 await db2.getDayBook({user:{id:o,role:"seller"},query:{from:today,to:today}},r2);
 ck(r2.statusCode===200,"a database without credit notes still gets its day book",r2.body?.message);

 console.log(f?`\n${f} FAILED\n`:"\nall good\n");await tp.end();process.exit(f?1:0);
})().catch(e=>{console.error("THREW",e.message);process.exit(1);});
