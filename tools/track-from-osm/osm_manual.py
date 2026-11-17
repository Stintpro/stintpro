# Uso: python3 -I tools/track-from-osm/osm_manual.py <workdir> <slug> <lat_meta> <lon_meta> <osm|rev> <way_id>[,<way_id>...]
# Une los ways en el orden dado (cada uno en su orden OSM), recorta en la meta y
# escribe <slug>.csv (2 vueltas sintéticas a velocidad constante).
import json,sys,math
W,slug,la,lo,dr,ids=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4]),sys.argv[5],[int(x) for x in sys.argv[6].split(',')]
d=json.load(open(W+'/osm.json'));by={e['id']:e for e in d['elements']}
k=math.cos(math.radians(la));M=111320
xy=lambda a,b:complex(b*M*k,a*M);ll=lambda z:(z.imag/M,z.real/(M*k))
P=[]
for i in ids:
    for q in by[i]['geometry']:
        z=xy(q['lat'],q['lon'])
        if not P or abs(P[-1]-z)>0.01: P.append(z)
if abs(P[0]-P[-1])<0.5: P=P[:-1]
else: sys.exit('los tramos no cierran la vuelta: %.1f m'%abs(P[0]-P[-1]))
if dr=='rev': P=P[::-1]
fl=xy(la,lo);best=None
for i in range(len(P)):
    a,b=P[i],P[(i+1)%len(P)];dd=b-a;t=max(0,min(1,((fl-a)*dd.conjugate()).real/abs(dd)**2));pr=a+dd*t
    if best is None or abs(fl-pr)<best[0]: best=(abs(fl-pr),i,pr,dd)
dist,i,pr,dd=best
print('meta a %.1f m del eje, rumbo %.0f°, vuelta %.0f m'%(dist,(90-math.degrees(math.atan2(dd.imag,dd.real)))%360,sum(abs(P[j]-P[j-1]) for j in range(len(P)))))
loop=[pr]+P[i+1:]+P[:i+1]+[pr];pts=[]
for j in range(len(loop)-1):
    L=abs(loop[j+1]-loop[j]);n=max(1,int(L))
    for s in range(n): pts.append(loop[j]+(loop[j+1]-loop[j])*s/n)
v=14.0;tt=0.0
with open(W+'/'+slug+'.csv','w') as f:
    f.write('Time,Latitude,Longitude,Lap\n');f.write('%.3f,%.7f,%.7f,1\n'%(tt,*ll(pts[-1])));tt+=1/v
    for lap in (2,3):
        for p in pts: f.write('%.3f,%.7f,%.7f,%d\n'%(tt,*ll(p),lap));tt+=1/v
    f.write('%.3f,%.7f,%.7f,4\n'%(tt,*ll(pts[0])))
