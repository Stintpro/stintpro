# keep_profile.py <old.json> <new.json>: si la forma coincide (mismo inicio y sentido),
# pasa al nuevo los perfiles de tiempo medidos y el pitLane del viejo.
import json,sys,math
o=json.load(open(sys.argv[1]));n=json.load(open(sys.argv[2]))
def norm(P):
    xs=[p[0] for p in P];ys=[p[1] for p in P];cx=sum(xs)/len(xs);cy=sum(ys)/len(ys)
    s=math.sqrt(sum((x-cx)**2+(y-cy)**2 for x,y in P)/len(P));return [((x-cx)/s,(y-cy)/s) for x,y in P]
a=norm(o['points']);b=norm(n['points'])
err=math.sqrt(sum((p[0]-q[0])**2+(p[1]-q[1])**2 for p,q in zip(a,b))/len(a))
print('diferencia de forma viejo/nuevo (mismo índice): %.3f'%err)
if err<0.15 and len(a)==len(b):
    for k in ('normal','inverso'):
        op=o['profiles'].get(k)
        if op and 'UNIFORME' not in op.get('source',''):
            src=op['source'] if op['source'].endswith(' · geometría OSM') else op['source']+' · geometría OSM'
            n['profiles'][k]={'timeFrac':op['timeFrac'],'source':src}
    if o.get('pitLane'): n['pitLane']=o['pitLane']
    print('perfiles medidos y pitLane conservados:',[k for k,v in n['profiles'].items() if v])
    open(sys.argv[2],'w').write(json.dumps(n,separators=(',',':'))+'\n')
else:
    print('NO coincide: me quedo con el perfil uniforme')
