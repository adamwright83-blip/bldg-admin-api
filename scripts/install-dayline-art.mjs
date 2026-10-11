#!/usr/bin/env node
/** Install original Goldline runtime PNGs. Does NOT enable the preview flag. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const inputZip=process.argv[2];
if(!inputZip||!fs.existsSync(inputZip)){console.error("Usage: node scripts/install-dayline-art.mjs /path/to/goldline_dayline_runtime_assets.zip");process.exit(2);}
const prefix="public/goldline/dayline-v1/";
const names=[
"background/world-clean.png",
"objects/pickup.png","objects/dropoff.png","objects/sales.png","objects/growth.png","objects/marketing.png",
"avatar/idle.png","avatar/walk-00.png","avatar/walk-01.png","avatar/walk-02.png","avatar/walk-03.png","avatar/walk-04.png",
"states/pickup-closed.png","states/pickup-open.png","states/dropoff-closed.png","states/dropoff-open.png",
"states/sales-closed.png","states/sales-open.png","states/growth-closed.png","states/growth-open.png",
"states/marketing-closed.png","states/marketing-open.png",
"scenery/foreground-cutouts-atlas.png","chapter/chapter-locked.png","chapter/chapter-unlocked.png"];
const full=names.map(n=>prefix+n);
const available=new Set(execFileSync("unzip",["-Z","-1",inputZip],{encoding:"utf8",maxBuffer:1024*1024}).split(/\r?\n/).filter(Boolean));
const missing=full.filter(n=>!available.has(n));
if(missing.length)throw Error("Missing images: "+missing.join(", "));
const unexpected=[...available].filter(n=>n.endsWith(".png")&&!full.includes(n));
if(unexpected.length)throw Error("Unexpected images: "+unexpected.join(", "));
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const root=process.cwd(), pending=[];
for(const name of full){
 const bytes=execFileSync("unzip",["-p",inputZip,name],{maxBuffer:12*1024*1024});
 if(bytes.length<33||!bytes.subarray(0,8).equals(signature)||bytes.toString("ascii",12,16)!=="IHDR")throw Error("Invalid PNG: "+name);
 const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
 if(w<90||h<90||w>8192||h>8192)throw Error("Unexpected dimensions: "+name);
 const destination=path.resolve(root,name);
 if(!destination.startsWith(path.resolve(root,prefix)))throw Error("Unsafe path: "+name);
 pending.push({name,destination,bytes,w,h,digest:crypto.createHash("sha256").update(bytes).digest("hex")});
}
for(const p of pending){
 fs.mkdirSync(path.dirname(p.destination),{recursive:true});
 fs.writeFileSync(p.destination,p.bytes);
 console.log(p.name+" "+p.w+"x"+p.h+" sha256:"+p.digest);
}
console.log("Installed "+pending.length+" PNG assets. Do not enable preview before user art approval.");
