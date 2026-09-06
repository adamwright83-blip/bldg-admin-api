#!/usr/bin/env python3
"""Render geography-locked territory references, masks, vectors and QA plates."""
from __future__ import annotations
import io, json, math, os, pathlib, subprocess, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(sys.argv[1]).resolve()
MANIFEST = json.loads((ROOT / "_authoritative-manifest.json").read_text())
AA = 4

def polygons(projected):
    return [projected["coordinates"]] if projected["type"] == "Polygon" else projected["coordinates"]

def bounds(projected):
    pts = [p for poly in polygons(projected) for ring in poly for p in ring]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)

def pct_to_geo(x, y):
    pr = MANIFEST["projection"]
    lon = pr["west"] + x / 100 * (pr["east"] - pr["west"])
    north = math.log(math.tan(math.pi/4 + math.radians(pr["north"])/2))
    south = math.log(math.tan(math.pi/4 + math.radians(pr["south"])/2))
    my = north - y / 100 * (north - south)
    lat = math.degrees(2 * math.atan(math.exp(my)) - math.pi/2)
    return lon, lat

def canvas_for(b):
    l,t,r,bottom=b; w=max(r-l,.01); h=max(bottom-t,.01)
    bleed_x=w*.10; bleed_y=h*.10
    l=max(0,l-bleed_x); r=min(100,r+bleed_x); t=max(0,t-bleed_y); bottom=min(100,bottom+bleed_y)
    ratio=(r-l)/(bottom-t)
    if ratio >= 1:
        height=1024; width=min(3072, max(1024, round(height*ratio)))
    else:
        width=1024; height=min(3072, max(1024, round(width/ratio)))
    return (l,t,r,bottom), (width,height), round(min(width/(r-l),height/(bottom-t))*.10*min(w,h))

def local_point(p, bbox, size, scale=1):
    l,t,r,b=bbox; w,h=size
    return ((p[0]-l)/(r-l)*w*scale, (p[1]-t)/(b-t)*h*scale)

def mask_image(projected,bbox,size):
    hi=Image.new("L",(size[0]*AA,size[1]*AA),0); d=ImageDraw.Draw(hi)
    for poly in polygons(projected):
        d.polygon([local_point(p,bbox,size,AA) for p in poly[0]],fill=255)
        for hole in poly[1:]: d.polygon([local_point(p,bbox,size,AA) for p in hole],fill=0)
    return hi.resize(size,Image.Resampling.LANCZOS)

def outline_svg(projected,bbox,size):
    paths=[]
    for poly in polygons(projected):
        parts=[]
        for ring in poly:
            pts=[local_point(p,bbox,size) for p in ring]
            parts.append("M "+" L ".join(f"{x:.3f} {y:.3f}" for x,y in pts)+" Z")
        paths.append(" ".join(parts))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size[0]} {size[1]}"><path d="{" ".join(paths)}" fill="white" fill-rule="evenodd" stroke="black" stroke-width="2"/></svg>\n'

def geometry_centroid(geometry):
    """Area-weighted GeoJSON centroid; interior rings subtract from exteriors."""
    weighted_x=weighted_y=area_total=0.0
    for poly in polygons(geometry):
        for ring_index,ring in enumerate(poly):
            cross_sum=cx=cy=0.0
            for a,b in zip(ring,ring[1:]):
                cross=a[0]*b[1]-b[0]*a[1]; cross_sum+=cross
                cx+=(a[0]+b[0])*cross; cy+=(a[1]+b[1])*cross
            if abs(cross_sum)<1e-15: continue
            area=abs(cross_sum/2) * (1 if ring_index==0 else -1)
            ring_cx=cx/(3*cross_sum); ring_cy=cy/(3*cross_sum)
            weighted_x+=ring_cx*area; weighted_y+=ring_cy*area; area_total+=area
    if abs(area_total)<1e-15: raise RuntimeError("zero-area geometry")
    return weighted_x/area_total,weighted_y/area_total

def fetch_reference(bbox,size,dest):
    left,top,right,bottom=bbox
    west,north=pct_to_geo(left,top); east,south=pct_to_geo(right,bottom)
    params=urllib.parse.urlencode({"bbox":f"{west},{south},{east},{north}","bboxSR":"4326","imageSR":"4326","size":f"{size[0]},{size[1]}","format":"png32","transparent":"false","f":"image"})
    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export?"+params
    subprocess.run(["curl","-L","--fail","--silent","--show-error","--retry","3","--max-time","120",url,"-o",str(dest)],check=True)
    with Image.open(dest) as im:
        if im.size != size: raise RuntimeError(f"reference size {im.size} != {size}")

def render_one(t):
    dest=ROOT/t["territoryId"]; dest.mkdir(parents=True,exist_ok=True)
    bbox,size,bleed=canvas_for(bounds(t["projectedGeometry"]))
    fetch_reference(bbox,size,dest/"reference.png")
    mask_image(t["projectedGeometry"],bbox,size).save(dest/"mask.png")
    (dest/"outline.svg").write_text(outline_svg(t["projectedGeometry"],bbox,size))
    centroid_lon,centroid_lat=geometry_centroid(t["realGeometry"])
    meta={"territoryId":t["territoryId"],"name":t["name"],"sourceType":t["sourceType"],"parentTerritory":t["parentTerritory"],"boundaryBasis":t["boundaryBasis"],
      "atlasBBoxPct":{"left":bbox[0],"top":bbox[1],"width":bbox[2]-bbox[0],"height":bbox[3]-bbox[1]},"canvas":{"width":size[0],"height":size[1]},"bleedPx":bleed,
      "atlasPolygon":t["projectedGeometry"],"realGeometry":t["realGeometry"],"centroid":{"latitude":centroid_lat,"longitude":centroid_lon},
      "projection":MANIFEST["projection"],"canonicalTowers":t["towers"],"customerLocationCount":len(t["customers"]),"customerDataStatus":MANIFEST["customerDataStatus"],
      "referenceSource":{"type":"real_geography_tracing_plate","service":"Esri World Street Map","productionArtwork":False},"geometrySource":"real WGS84 geometry projected through projectLatLngToLanternAtlas; atlasPolygonOverride excluded"}
    (dest/"metadata.json").write_text(json.dumps(meta,indent=2)+"\n")
    return {"territoryId":t["territoryId"],"name":t["name"],"atlasBBoxPct":meta["atlasBBoxPct"],"canvas":meta["canvas"],"customerLocationCount":len(t["customers"]),"canonicalTowers":[x["id"] for x in t["towers"]]}

errors=[]; index=[]
with ThreadPoolExecutor(max_workers=6) as pool:
    futures={pool.submit(render_one,t):t for t in MANIFEST["territories"]}
    for future in as_completed(futures):
        try: index.append(future.result())
        except Exception as e: errors.append({"territoryId":futures[future]["territoryId"],"error":str(e)})
if errors: raise SystemExit(json.dumps(errors,indent=2))
index.sort(key=lambda x:x["territoryId"])

qa=ROOT/"_qa"; qa.mkdir(exist_ok=True)
W,H=1920,1080
debug=Image.new("RGBA",(W,H),(12,24,38,255)); reg=Image.new("RGBA",(W,H),(247,244,229,255))
dd=ImageDraw.Draw(debug,"RGBA"); dr=ImageDraw.Draw(reg,"RGBA")
palette=[(35,190,255,105),(255,183,40,105),(172,91,255,105),(48,211,126,105)]
for i,t in enumerate(MANIFEST["territories"]):
    color=palette[i%len(palette)]
    for poly in polygons(t["projectedGeometry"]):
        outer=[(p[0]/100*W,p[1]/100*H) for p in poly[0]]
        dd.polygon(outer,fill=color,outline=(255,255,255,210),width=2)
        dr.line(outer,fill=(25,88,130,200),width=2,joint="curve")
        for hole in poly[1:]:
            hp=[(p[0]/100*W,p[1]/100*H) for p in hole]; dd.polygon(hp,fill=(12,24,38,255)); dr.polygon(hp,fill=(247,244,229,255))
for c in MANIFEST["customerClassifications"]:
    pr=MANIFEST["projection"]; x=(c["longitude"]-pr["west"])/(pr["east"]-pr["west"])*W
    n=math.log(math.tan(math.pi/4+math.radians(pr["north"])/2)); s=math.log(math.tan(math.pi/4+math.radians(pr["south"])/2)); y=(n-math.log(math.tan(math.pi/4+math.radians(c["latitude"])/2)))/(n-s)*H
    dr.ellipse((x-4,y-4,x+4,y+4),fill=(255,153,0,255),outline="black")
for tower in MANIFEST["towers"]:
    pr=MANIFEST["projection"]; x=(tower["longitude"]-pr["west"])/(pr["east"]-pr["west"])*W
    n=math.log(math.tan(math.pi/4+math.radians(pr["north"])/2)); s=math.log(math.tan(math.pi/4+math.radians(pr["south"])/2)); y=(n-math.log(math.tan(math.pi/4+math.radians(tower["latitude"])/2)))/(n-s)*H
    dr.ellipse((x-10,y-10,x+10,y+10),fill=(255,0,180,255),outline="black",width=2); dr.text((x+13,y-8),tower["id"],fill="black")
debug.save(qa/"all-territories-debug-1920x1080.png"); reg.save(qa/"customer-and-tower-registration-1920x1080.png")
qa_summary={"territoryPackageCount":len(index),"failedOrInvalidGeometries":errors,"customerDataStatus":MANIFEST["customerDataStatus"],"customerPointsChecked":len(MANIFEST["customerClassifications"]),"towerClassifications":MANIFEST["towers"],"intentionalParentChildOverlap":[{"parent":"downtown","child":"arts-district"}],"atlasPolygonOverridesUsed":False,"referenceProvider":"Esri World Street Map (internal tracing only)"}
(qa/"territory-index.json").write_text(json.dumps({"qa":qa_summary,"territories":index},indent=2)+"\n")
(ROOT/"_authoritative-manifest.json").unlink()
print(json.dumps(qa_summary,indent=2))
