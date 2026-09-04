import { useState } from "react";
import { trpc } from "@/lib/trpc";
export function CustomerImport({onContinue,busy}:{onContinue:()=>void;busy:boolean}){
 const [file,setFile]=useState<{name:string;payload:string}|null>(null);
 const preview=trpc.system.goldlineOnboarding.previewImport.useMutation();
 const commit=trpc.system.goldlineOnboarding.importCustomers.useMutation();
 const utils=trpc.useUtils();
 const pending=busy||preview.isPending||commit.isPending;
 return <section className="gl-customer-import"><h2>Got a customer list? Drop it in.</h2><p>Optional. Bring up to 100 customers in a CSV. Unresolved addresses stay off the map.</p>
 <label>Customer CSV<input type="file" accept=".csv,text/csv" disabled={pending} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>500000){e.target.setCustomValidity("Choose a CSV smaller than 500 KB.");e.target.reportValidity();return;}const payload=await f.text();setFile({name:f.name,payload});commit.reset();preview.mutate({payload});}}/></label>
 {preview.data&&<div className="gl-import-preview"><p>{preview.data.length} rows · {preview.data.filter(r=>r.duplicate).length} duplicates · {preview.data.filter(r=>r.unresolved).length} need review</p><ul>{preview.data.slice(0,8).map(r=><li key={r.rowNumber}>{r.name||"Missing name"} — {r.duplicate?"duplicate":r.unresolved||r.address}</li>)}</ul></div>}
 {(preview.error||commit.error)&&<p role="alert">{preview.error?.message||commit.error?.message}</p>}
 {commit.data&&<p role="status">{commit.data.importedCustomers} customer records saved. {commit.data.errors.length} addresses need review.</p>}
 <div className="gl-import-actions">{file&&preview.data&&!commit.data&&<button disabled={pending} onClick={()=>commit.mutate({payload:file.payload,fileName:file.name},{onSuccess:()=>utils.system.goldlineOnboarding.state.invalidate()})}>{commit.isPending?"IMPORTING…":"IMPORT THESE CUSTOMERS"}</button>}<button disabled={pending} onClick={onContinue}>{busy?"ASSEMBLING…":commit.data?"REVEAL MY WORLD":"SKIP & REVEAL MY WORLD"}</button></div>
 </section>;
}
