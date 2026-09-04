import { createHash } from "node:crypto";
import { parseCsv } from "../externalSystems/csvIngestion";
import { GoogleGeocoder } from "../geography/googleGeocoder";
import { registerTenantImportProvider } from "../saas/tenantImportProviders";
import type { TenantImportRequest, TenantImportResult } from "../../shared/tenantImports";
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
export function previewCustomerCsv(payload:string){
 const rows=parseCsv(payload);if(rows.length>100)throw new Error("Import up to 100 customers at a time.");
 const seen=new Set<string>();
 return rows.map((raw,index)=>{
  const entries=Object.entries(raw);const get=(...keys:string[])=>entries.find(([k])=>keys.includes(norm(k)))?.[1]?.trim()??"";
  const name=get("name","customername","fullname","customer")||[get("firstname"),get("lastname")].filter(Boolean).join(" ");
  const street=get("address","streetaddress","street","address1"),city=get("city"),state=get("state","province"),postal=get("zip","zipcode","postalcode","postal");
  const address=[street,city,state,postal].filter(Boolean).join(", ");
  const email=get("email","emailaddress"),phone=get("phone","phonenumber","mobile");
  const identity=get("customerid","id")||email.toLowerCase()||phone.replace(/\D/g,"")||`${name.toLowerCase()}|${address.toLowerCase()}`;
  const externalId=createHash("sha256").update(identity).digest("hex");
  let unresolved:string|null=null;
  if(!name)unresolved="Customer name missing";
  else if(!street || !/\d/.test(street))unresolved="Street address unresolved";
  else if(!email&&!phone&&!get("customerid","id")&&!city&&!/\b[A-Z]{2}\b|\b\d{5}\b/.test(street))unresolved="Address needs city/state or customer identity";
  const duplicate=seen.has(externalId);seen.add(externalId);
  return {rowNumber:index+2,name,address,email:email||null,phone:phone||null,externalId,unresolved,duplicate};
 });
}
export class CustomerCsvProvider {
 readonly key="goldline_customer_csv";
 readonly capabilities={customers:true,orders:false,connectionMode:"csv" as const};
 async validateConnection(){}
 async importBatch(input:TenantImportRequest):Promise<TenantImportResult>{
  const rows=previewCustomerCsv(input.payload),capturedAt=new Date().toISOString();
  const customers:NonNullable<TenantImportResult["normalizedCustomers"]>=[];const errors:TenantImportResult["errors"]=[];
  for(const row of rows){
   if(row.duplicate)continue;
   if(!row.name){errors.push({rowNumber:row.rowNumber,message:row.unresolved!});continue;}
   const geography=row.unresolved?null:await new GoogleGeocoder().geocode(row.address);
   const resolved=geography?.status==="success";
   if(!resolved)errors.push({rowNumber:row.rowNumber,message:row.unresolved||"Address retained for review; no holding placed."});
   customers.push({externalId:row.externalId,name:row.name,email:row.email,phone:row.phone,sourceCapturedAt:capturedAt,facts:{address:row.address,sourceFileName:input.sourceFileName,provenance:"imported_evidence",geography:resolved?geography:null,addressStatus:resolved?"resolved":"unresolved"}});
  }
  return {providerKey:this.key,importedCustomers:customers.length,importedOrders:0,skippedRecords:rows.length-customers.length,completedWithErrors:errors.length>0,errors,normalizedCustomers:customers,normalizedOrders:[]};
 }
}
registerTenantImportProvider(new CustomerCsvProvider());
