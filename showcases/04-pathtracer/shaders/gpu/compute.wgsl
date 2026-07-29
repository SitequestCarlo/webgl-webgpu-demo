// compute.wgsl - Rendering-Vergleich (WebGPU, Showcase 04)
// EIN Compute-Shader, drei Modi (via params.camPos.w):
//   0 = Whitted-Raytracing : direkte Beleuchtung + harte Schatten + Spiegel/Glas-Rekursion,
//                            KEIN indirektes diffuses Licht (schwarze Ecken).
//   1 = Path Tracing (naiv): volle GI, Licht nur zufaellig getroffen -> stark verrauscht.
//   2 = Path Tracing (NEE)  : volle GI + direkte Lichtstichprobe -> sauberes direktes Licht,
//                            sichtbarer Unterschied ist genau das indirekte GI.
// Szene: Cornell Box + Halbkugel-Lampe (Decke) + Spiegel-Kugel + Glas-Kugel.
// Material: 0=Diffus, 1=Spiegel, 2=Glas, 3=Lichtquelle (emissiv).

struct Params { resolution: vec2<u32>, frameIndex: u32, maxBounces: u32, camPos: vec4<f32>, camFwd: vec4<f32>, camRight: vec4<f32>, camUp: vec4<f32> }
@group(0) @binding(0) var<uniform>            params: Params;
@group(0) @binding(1) var<storage, read_write> accum:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> rngBuf: array<u32>;

const PI: f32 = 3.14159265359;
// Halbkugel-Lampe
const LC: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);   // Zentrum (auf Deckenhoehe)
const LR: f32 = 0.35;                              // Radius
const LE: vec3<f32> = vec3<f32>(4.0);              // Emissions-Radianz

fn nextRng(idx: u32) -> f32 { var x=rngBuf[idx]; x^=x<<13u; x^=x>>17u; x^=x<<5u; rngBuf[idx]=x; return f32(x)*(1.0/4294967296.0); }

fn cosineSample(N: vec3<f32>, idx: u32) -> vec3<f32> {
    let r1=nextRng(idx); let r2=nextRng(idx); let phi=6.28318530*r1; let sq=sqrt(r2);
    let T=normalize(select(cross(N,vec3<f32>(1,0,0)),cross(N,vec3<f32>(0,1,0)),abs(N.x)<0.9));
    let B=cross(N,T); return sq*(cos(phi)*T+sin(phi)*B)+sqrt(1.0-r2)*N;
}
fn schlick(cosT: f32, ior: f32) -> f32 { var r0=(1.0-ior)/(1.0+ior); r0*=r0; return r0+(1.0-r0)*pow(1.0-cosT,5.0); }

struct Hit { t: f32, n: vec3<f32>, albedo: vec3<f32>, mat: u32 }

fn hitSphere(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: f32, tmax: f32) -> f32 {
    let oc=ro-c; let b=dot(oc,rd); let d=b*b-dot(oc,oc)+r*r;
    if (d < 0.0) { return -1.0; }
    let sq=sqrt(d); var t=-b-sq;
    if (t < 0.001) { t=-b+sq; }
    return select(-1.0, t, t>0.001&&t<tmax);
}
fn hitYPlane(ro:vec3<f32>,rd:vec3<f32>,y:f32,x0:f32,x1:f32,z0:f32,z1:f32,tmax:f32)->f32{if(abs(rd.y)<1e-6){return -1.0;}let t=(y-ro.y)/rd.y;if(t<0.001||t>tmax){return -1.0;}let p=ro+t*rd;return select(-1.0,t,p.x>=x0&&p.x<=x1&&p.z>=z0&&p.z<=z1);}
fn hitXPlane(ro:vec3<f32>,rd:vec3<f32>,x:f32,y0:f32,y1:f32,z0:f32,z1:f32,tmax:f32)->f32{if(abs(rd.x)<1e-6){return -1.0;}let t=(x-ro.x)/rd.x;if(t<0.001||t>tmax){return -1.0;}let p=ro+t*rd;return select(-1.0,t,p.y>=y0&&p.y<=y1&&p.z>=z0&&p.z<=z1);}
fn hitZPlane(ro:vec3<f32>,rd:vec3<f32>,z:f32,x0:f32,x1:f32,y0:f32,y1:f32,tmax:f32)->f32{if(abs(rd.z)<1e-6){return -1.0;}let t=(z-ro.z)/rd.z;if(t<0.001||t>tmax){return -1.0;}let p=ro+t*rd;return select(-1.0,t,p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1);}

fn scene(ro: vec3<f32>, rd: vec3<f32>) -> Hit {
    var h: Hit; h.t=1e20; h.mat=0u; h.albedo=vec3<f32>(0);
    var t: f32;
    t=hitYPlane(ro,rd,-1.0,-1.0,1.0,-1.0,1.0,h.t); if(t>0.0){h.t=t;h.n=vec3<f32>(0,1,0); h.albedo=vec3<f32>(0.73);            h.mat=0u;}
    t=hitZPlane(ro,rd,-1.0,-1.0,1.0,-1.0,1.0,h.t); if(t>0.0){h.t=t;h.n=vec3<f32>(0,0,1); h.albedo=vec3<f32>(0.73);            h.mat=0u;}
    t=hitXPlane(ro,rd,-1.0,-1.0,1.0,-1.0,1.0,h.t); if(t>0.0){h.t=t;h.n=vec3<f32>(1,0,0); h.albedo=vec3<f32>(0.65,0.05,0.05); h.mat=0u;}
    t=hitXPlane(ro,rd, 1.0,-1.0,1.0,-1.0,1.0,h.t); if(t>0.0){h.t=t;h.n=vec3<f32>(-1,0,0);h.albedo=vec3<f32>(0.12,0.45,0.15); h.mat=0u;}
    t=hitYPlane(ro,rd, 1.0,-1.0,1.0,-1.0,1.0,h.t); if(t>0.0){h.t=t;h.n=vec3<f32>(0,-1,0);h.albedo=vec3<f32>(0.8);            h.mat=0u;}
    // Halbkugel-Lampe (untere Haelfte)
    {
        let oc=ro-LC; let b=dot(oc,rd); let disc=b*b-dot(oc,oc)+LR*LR;
        if (disc > 0.0) {
            let sq=sqrt(disc); let ta=-b-sq; let tb=-b+sq; var tl=-1.0;
            if (ta>0.001 && (ro.y+ta*rd.y)<1.0)      { tl=ta; }
            else if (tb>0.001 && (ro.y+tb*rd.y)<1.0) { tl=tb; }
            if (tl>0.001 && tl<h.t) { h.t=tl; let p=ro+tl*rd; h.n=normalize(p-LC); h.albedo=vec3<f32>(1.0); h.mat=3u; }
        }
    }
    let mc=vec3<f32>(-0.45,-0.56,-0.65); t=hitSphere(ro,rd,mc,0.44,h.t); if(t>0.0){h.t=t;h.n=normalize(ro+t*rd-mc);h.albedo=vec3<f32>(0.9,0.9,0.85);h.mat=1u;}
    let gc=vec3<f32>(0.40,-0.65,-0.15); t=hitSphere(ro,rd,gc,0.35,h.t); if(t>0.0){h.t=t;h.n=normalize(ro+t*rd-gc);h.albedo=vec3<f32>(0.95,0.95,1.0);h.mat=2u;}
    return h;
}

// Schatten-Ray: true wenn NICHT-Licht-Geometrie den Weg blockiert (Lampe ignoriert)
fn occluded(P: vec3<f32>, wi: vec3<f32>, maxDist: f32) -> bool {
    var t: f32;
    t=hitYPlane(P,wi,-1.0,-1.0,1.0,-1.0,1.0,maxDist); if(t>0.0){return true;}
    t=hitZPlane(P,wi,-1.0,-1.0,1.0,-1.0,1.0,maxDist); if(t>0.0){return true;}
    t=hitXPlane(P,wi,-1.0,-1.0,1.0,-1.0,1.0,maxDist); if(t>0.0){return true;}
    t=hitXPlane(P,wi, 1.0,-1.0,1.0,-1.0,1.0,maxDist); if(t>0.0){return true;}
    let mc=vec3<f32>(-0.45,-0.56,-0.65); t=hitSphere(P,wi,mc,0.44,maxDist); if(t>0.0){return true;}
    let gc=vec3<f32>(0.40,-0.65,-0.15); t=hitSphere(P,wi,gc,0.35,maxDist); if(t>0.0){return true;}
    return false;
}

// Direkte Beleuchtung an diffusem Punkt P. hard=true -> fester Lichtpunkt (harte Schatten, Whitted).
// hard=false -> zufaellige Stichprobe auf der Halbkugel (weiche Schatten, NEE).
fn directLight(P: vec3<f32>, N: vec3<f32>, albedo: vec3<f32>, hard: bool, idx: u32) -> vec3<f32> {
    var Ls: vec3<f32>; var Ln: vec3<f32>;
    if (hard) {
        Ls = LC + vec3<f32>(0.0, -LR, 0.0);   // Boden-Mittelpunkt der Kuppel
        Ln = vec3<f32>(0.0, -1.0, 0.0);
    } else {
        let z = -nextRng(idx);                 // untere Halbkugel (y in [-1,0])
        let phi = 6.28318530 * nextRng(idx);
        let r2 = sqrt(max(0.0, 1.0 - z*z));
        let dir = vec3<f32>(r2*cos(phi), z, r2*sin(phi));
        Ls = LC + LR * dir; Ln = dir;
    }
    let toL = Ls - P; let dist = length(toL); let wi = toL / dist;
    let cosSurf = max(dot(N, wi), 0.0);
    let cosLight = max(dot(Ln, -wi), 0.0);
    if (cosSurf <= 0.0 || cosLight <= 0.0) { return vec3<f32>(0.0); }
    if (occluded(P + N*0.001, wi, dist - 0.002)) { return vec3<f32>(0.0); }
    let area = 2.0 * PI * LR * LR;             // Flaeche der unteren Halbkugel
    let G = cosSurf * cosLight / (dist * dist);
    return (albedo / PI) * LE * G * area;
}

fn pathTrace(ro_in: vec3<f32>, rd_in: vec3<f32>, idx: u32, mode: u32) -> vec3<f32> {
    var L = vec3<f32>(0.0);
    var tp = vec3<f32>(1.0);
    var ro = ro_in; var rd = rd_in;
    var specular = true;   // Primaerstrahl zaehlt als spekular (Lampe sichtbar)
    for (var i = 0u; i < params.maxBounces; i++) {
        let h = scene(ro, rd);
        if (h.t >= 1e20) { break; }

        // Lichtquelle getroffen
        if (h.mat == 3u) {
            // Whitted + naiv: immer sichtbar. NEE: nur ueber spekularen/Primaerpfad (kein Doppelzaehlen).
            if (mode != 2u || specular) { L += tp * LE; }
            break;
        }

        let pos = ro + h.t * rd;
        var N = h.n;
        let inside = dot(N, rd) > 0.0;
        if (inside) { N = -N; }

        if (h.mat == 1u) {
            // Spiegel
            tp *= h.albedo; rd = reflect(rd, N); ro = pos + N*0.001; specular = true; continue;
        }
        if (h.mat == 2u) {
            // Glas
            tp *= h.albedo;
            let ior = select(1.0/1.5, 1.5, inside);
            let refr = refract(rd, N, ior);
            let fr = schlick(abs(dot(N,-rd)), ior);
            if (length(refr) < 0.001 || fr > 0.98) { rd = reflect(rd, N); ro = pos + N*0.001; }
            else { rd = normalize(refr); ro = pos - N*0.001; }
            specular = true; continue;
        }

        // Diffus
        if (mode == 0u) {
            // Whitted: direkte Beleuchtung (harte Schatten), KEIN indirektes Licht
            L += tp * directLight(pos, N, h.albedo, true, idx);
            break;
        } else if (mode == 2u) {
            // NEE: direkte Lichtstichprobe + indirekter Bounce
            L += tp * directLight(pos, N, h.albedo, false, idx);
            tp *= h.albedo;
            if (i >= 3u) { let q=max(h.albedo.r,max(h.albedo.g,h.albedo.b)); if(nextRng(idx)>q){break;} tp/=q; }
            rd = cosineSample(N, idx); ro = pos + N*0.001; specular = false; continue;
        } else {
            // Naiv: nur indirekter Bounce, Licht wird zufaellig getroffen
            tp *= h.albedo;
            if (i >= 3u) { let q=max(h.albedo.r,max(h.albedo.g,h.albedo.b)); if(nextRng(idx)>q){break;} tp/=q; }
            rd = cosineSample(N, idx); ro = pos + N*0.001; specular = false; continue;
        }
    }
    return L;
}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let W=params.resolution.x; let H=params.resolution.y;
    if (gid.x>=W||gid.y>=H) { return; }
    let idx=gid.y*W+gid.x;
    if (params.frameIndex==0u) { rngBuf[idx]=idx*1664525u+1013904223u; }
    let mode = u32(params.camPos.w + 0.5);
    // Mehrere Samples pro Frame: fuellt das Bild schneller (v.a. der naive Pfad wird sichtbar)
    let spp = 4u;
    var sum = vec3<f32>(0.0);
    for (var s = 0u; s < spp; s++) {
        let jx=nextRng(idx)-0.5; let jy=nextRng(idx)-0.5;
        let uv=vec2<f32>((f32(gid.x)+jx-0.5*f32(W))/f32(H),(0.5*f32(H)-f32(gid.y)-jy)/f32(H));
        let rd=normalize(params.camFwd.xyz*1.2+uv.x*params.camRight.xyz+uv.y*params.camUp.xyz);
        var c=pathTrace(params.camPos.xyz,rd,idx,mode);
        // Firefly-Clamping: einzelne helle Ausreisser-Samples begrenzen (weniger Grieseln)
        let m=max(c.r,max(c.g,c.b));
        if (m > 5.0) { c *= 5.0/m; }
        sum += c;
    }
    accum[idx]+=vec4<f32>(sum, f32(spp));
}