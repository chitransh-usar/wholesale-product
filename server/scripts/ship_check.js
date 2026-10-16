const Module=require("module");const {Pool}=require("pg");
const dbPath=require.resolve("../src/config/db");
const tp=new Pool({connectionString:`postgres://postgres@127.0.0.1:5433/${process.argv[2] || "qa_ship"}`});
const st=new Module(dbPath,null);st.exports=tp;st.loaded=true;require.cache[dbPath]=st;
const oc=require("../src/controllers/orderController");
const pc=require("../src/controllers/productController");
const mk=()=>{const r={statusCode:0,body:null};r.status=c=>(r.statusCode=c,r);r.json=b=>(r.body=b,r);return r;};
let f=0;const ck=(p,l,e)=>{if(!p)f++;console.log(`  ${p?"PASS":"FAIL"}  ${l}${e!==undefined?"   "+JSON.stringify(e):""}`);};
const adv=async(o,id,s,extra={})=>{const r=mk();
  await oc.updateOrderStatus({user:{id:o,role:"seller"},params:{orderId:id},body:{status:s,...extra}},r);return r;};
(async()=>{
 process.stdout.write("");
 const s=Date.now().toString(36).slice(-6),d=String(Date.now()).slice(-7);
 const o=(await tp.query(`INSERT INTO users (first_name,last_name,email,password_hash,phone,role) VALUES ('S','H',$1,'x',$2,'seller') RETURNING id`,[`s-${s}@x.com`,`74${d}`])).rows[0].id;
 await tp.query(`INSERT INTO wholesaler_profiles (user_id,company_name,gstin,city,warehouse_state) VALUES ($1,$2,'27AAAPA1234A1Z5','Bhiwandi','Maharashtra')`,[o,`S ${s}`]);
 await tp.query(`INSERT INTO invoice_settings (user_id,prefix) VALUES ($1,$2)`,[o,`S${s}/`]);
 const pty=(await tp.query(`INSERT INTO parties (wholesaler_id,name,city,state,phone) VALUES ($1,$2,'Surat','Gujarat',$3) RETURNING id`,[o,`Ramesh ${s}`,`98${d}`])).rows[0].id;
 const add=mk();
 await pc.addProduct({user:{id:o,role:"seller"},body:{name:`Cloth ${s}`,category:"T",price:100,moq:1,stock:500,shippingDays:2,unit:"mtr",visibility:"public"}},add);
 const li=(await tp.query(`SELECT si.id FROM supplier_inventory si WHERE si.supplier_id=$1`,[o])).rows[0].id;
 const book=async()=>Number((await tp.query(`SELECT COALESCE(SUM(quantity),0) n FROM stock_ledger WHERE wholesaler_id=$1 AND product_id=$2`,[o,li])).rows[0].n);

 console.log("\n1. A manual order is accepted the moment it exists");
 const r=mk();
 await oc.createManualOrder({user:{id:o,role:"seller"},body:{partyId:pty,
   deliveryAddress:"14 Ring Road, Surat", contactPhone:"9812345678",
   theirReference:"THEIR/99",
   lines:[{itemName:`Cloth ${s}`,quantity:40,rate:100,unit:"mtr",productId:li}]}},r);
 ck(r.statusCode===201,"taken",r.body?.message);
 ck(r.body?.status==="supplier_accepted","starts accepted, so the ordinary spine works",r.body?.status);
 const id=r.body.id;
 ck(await book()===500,"nothing has moved: an order is a promise",await book());

 const det=mk();
 await oc.getOrderById({user:{id:o,role:"seller"},params:{orderId:id}},det);
 const D=det.body?.order||det.body;
 ck(D?.buyer_name===`Ramesh ${s}`,"the detail page names the customer, not a blank",D?.buyer_name);
 ck(!!D?.first_item,"and names the goods from order_items",D?.first_item);
 ck(!!D?.supplier_name,"and still finds the wholesaler",D?.supplier_name);
 ck(!!D?.delivery_address,"and carries the address it was given",D?.delivery_address);
 ck(D?.contact_phone==="9812345678","and the phone",D?.contact_phone);

 // An order left at pending, the way ones created before manual orders were
 // written in as accepted still sit. It must not be stranded.
 const stuck=(await tp.query(
   "INSERT INTO orders (supplier_id,party_id,buyer_id,source,order_number,quantity,subtotal,total_amount,amount_paid,remaining_amount,status,payment_status) VALUES ($1,$2,NULL,'manual',$3,1,100,100,0,100,'pending','pending') RETURNING id",
   [o,pty,`SO/OLD/${s}`])).rows[0].id;
 const unstick=await adv(o,stuck,"supplier_accepted");
 ck(unstick.body?.success===true,
   "an order stuck at pending can be accepted, rather than sitting for ever",
   unstick.body?.message);

 console.log("\n2. Down the spine to shipped");
 for (const step of ["processing","packed","ready_for_pickup"]) {
   const x=await adv(o,id,step);
   ck(x.body?.success===true||x.statusCode===200,`to ${step}`,x.body?.message);
 }
 const shipRes=await adv(o,id,"shipped");
 ck(shipRes.body?.success===true,"to shipped",shipRes.body?.message);

 console.log("\n3. Shipping raised the bill, and the sale under it");
 const sh=shipRes.body?.shipped||{};
 ck(!!sh.saleNumber,"a sale was written",sh.saleNumber);
 ck(!!sh.invoiceNumber,"and a TAX INVOICE, because the goods left",sh.invoiceNumber);
 ck(!sh.challanNumber,"and NO challan, which is the s.31(1)(a) default",sh.challanNumber);
 ck(await book()===460,"40 metres left the book",await book());
 const billed=(await tp.query(`SELECT quantity,quantity_billed FROM order_items WHERE order_id=$1`,[id])).rows[0];
 ck(Number(billed.quantity_billed)===Number(billed.quantity),"the order line is fully billed",billed);

 console.log("\n4. Shipping twice does not bill twice");
 const inv1=Number((await tp.query(`SELECT COUNT(*)::int n FROM invoices WHERE supplier_id=$1`,[o])).rows[0].n);
 const {shipOrder}=require("../src/services/shipOrder");
 await shipOrder(id,o,{});
 const inv2=Number((await tp.query(`SELECT COUNT(*)::int n FROM invoices WHERE supplier_id=$1`,[o])).rows[0].n);
 ck(inv1===inv2,"still one bill",{inv1,inv2});
 ck(await book()===460,"and the stock did not move again",await book());

 console.log("\n5. A Rule 55 reason ships on a challan instead");
 const r2=mk();
 await oc.createManualOrder({user:{id:o,role:"seller"},body:{partyId:pty,
   lines:[{itemName:`Cloth ${s}`,quantity:10,rate:100,unit:"mtr",productId:li}]}},r2);
 for (const step of ["processing","packed","ready_for_pickup"]) await adv(o,r2.body.id,step);
 const ship2=await adv(o,r2.body.id,"shipped",{challanReason:"job_work"});
 const sh2=ship2.body?.shipped||{};
 ck(!!sh2.challanNumber,"a challan was raised",sh2.challanNumber);
 ck(!sh2.invoiceNumber,"and no invoice, because he said it is job work",sh2.invoiceNumber);

 console.log(f?`\n${f} FAILED\n`:"\nall good\n");await tp.end();process.exit(f?1:0);
})().catch(e=>{console.error("THREW",e.message);process.exit(1);});
