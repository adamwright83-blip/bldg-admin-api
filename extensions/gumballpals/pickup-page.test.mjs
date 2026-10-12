import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { pickupPage } from "./pickup-page.js";
const address="42 Example St // Apt#7 // Los Angeles // CA 90000";
const expected={leaseUntil:new Date(Date.now()+120000).toISOString(),storeLabel:"Example Laundry",externalOrderId:"101",customerName:"Avery Example",address:"42 Example St, Apt#7, Los Angeles, CA 90000",scheduledDate:"2026-10-12",windowStart:"07:00",windowEnd:"10:00",notes:null};
function fixture({count=1,detail=false}={}) {
 return `<title>Example Laundry | CleanCloud</title><a onclick="show('pickup')">Pickups</a><a onclick="show('detail')">Detail</a>
 <div id="online_page"><div><h4>Orders</h4><p id="pu_o_c">${count}</p></div><div id="awaiting_dc_pickup"><table id="awaiting_dc_pickup_table"><thead><tr>${["ID","Placed","Customer","Route #","Contact","Order","Pcs","Notes","Pickup","Total",""] .map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody id="awaiting_dc_pickup_body"><tr id="DCpickup_101" class="dcPickup_row"><td>101</td><td>10/11/26</td><td>Avery Example</td><td>1</td><td>Delivery<br>${address}<br>555-555-0100<br>test@example.test</td><td></td><td>5</td><td></td><td>10/12/26<br>7am-10am</td><td>$0</td><td><a onclick="markPickup('101')">Collected</a></td></tr></tbody></table></div></div>
 <div id="awaiting_detail_box" style="display:none"><table><tbody id="awaiting_detail_body">${detail?'<tr id="det_101"><td>101</td><td></td><td></td><td>Avery Example</td></tr>':""}</tbody></table></div>
 <script>window.calls=0; function show(which){document.getElementById('awaiting_dc_pickup').style.display=which==='pickup'?'block':'none'; document.getElementById('awaiting_detail_box').style.display=which==='detail'?'block':'none';} function markPickup(id){window.calls++;document.getElementById('DCpickup_'+id).remove();document.querySelector('#pu_o_c').textContent='0';document.getElementById('awaiting_detail_body').innerHTML='<tr id="det_'+id+'"><td>'+id+'</td><td></td><td></td><td>Avery Example</td></tr>';}</script>`;
}
async function pageFor(options,work) {
 const browser=await chromium.launch({headless:true});
 try {const page=await browser.newPage();await page.route("https://cleancloudapp.com/store",route=>route.fulfill({contentType:"text/html",body:fixture(options)}));await page.goto("https://cleancloudapp.com/store");await page.addScriptTag({content:`window.pickupPage=${pickupPage.toString()}`});return await work(page);}finally{await browser.close();}
}
const run=(page,mode,expectedValue)=>page.evaluate(({mode,expectedValue})=>window.pickupPage(mode,expectedValue),{mode,expectedValue});
test("reads complete pickup rows, dates and addresses without importing contact credentials",()=>pageFor({},async page=>{
 const result=await run(page,"capture",{storeLabel:"Example Laundry"});assert.equal(result.ok,true);assert.deepEqual(result.value.rows,[expected].map(({storeLabel,leaseUntil,...row})=>row));assert.equal(JSON.stringify(result).includes("test@example.test"),false);assert.equal(await page.evaluate(()=>window.calls),0);
}));
test("incomplete grid and wrong customer stop before Collected",async()=>{
 await pageFor({count:2},async page=>{const result=await run(page,"capture",null);assert.equal(result.ok,false);assert.match(result.error,/complete pickup/);assert.equal(await page.evaluate(()=>window.calls),0);});
 await pageFor({},async page=>{const result=await run(page,"collect",{...expected,customerName:"Other Customer"});assert.equal(result.ok,false);assert.equal(await page.evaluate(()=>window.calls),0);});
});
test("Collected targets exactly one order and Detail supplies positive verification",()=>pageFor({},async page=>{
 assert.equal((await run(page,"verify",expected)).value.verified,false);
 assert.equal((await run(page,"collect",expected)).ok,true);
 const receipt=(await run(page,"verify",expected)).value;
 assert.equal(receipt.verified,true);assert.equal(receipt.detailRowId,"det_101");assert.equal(await page.evaluate(()=>window.calls),1);
}));
test("a preexisting Detail receipt verifies without another Collected click",()=>pageFor({detail:true},async page=>{
 assert.equal((await run(page,"verify",expected)).value.verified,true);assert.equal(await page.evaluate(()=>window.calls),0);
}));

test("a command resumed after sleep cannot send Collected with an expired lease",()=>pageFor({},async page=>{
 const result=await run(page,"collect",{...expected,leaseUntil:"2000-01-01T00:00:00Z"});assert.equal(result.ok,false);assert.equal(await page.evaluate(()=>window.calls),0);
}));
