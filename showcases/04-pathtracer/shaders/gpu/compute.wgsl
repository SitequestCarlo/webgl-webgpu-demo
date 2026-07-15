// compute.wgsl – Path Tracer Compute-Shader (WebGPU, Showcase 04)
// Identische Szene wie pathtracer.glsl, aber mit Compute-Vorteilen:
//   - Persistenter RNG-Zustand pro Pixel (Xorshift32 im Storage Buffer)
//   - Mehr Bounces (bis 16, wählbar via GUI)
//   - HDR-Akkumulation ohne LDR-Bias
struct Params { resolution: vec2<u32>, frameIndex: u32, maxBounces: u32, camPos: vec4<f32>, camFwd: vec4<f32>, camRight: vec4<f32>, camUp: vec4<f32> }
@group(0) @binding(0) var<uniform>            params: Params;
@group(0) @binding(1) var<storage, read_write> accum:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> rngBuf: array<u32>;  // Persistenter RNG!

fn nextRng(idx: u32) -> f32 { var x=rngBuf[idx]; x^=x<<13u; x^=x>>17u; x^=x<<5u; rngBuf[idx]=x; return f32(x)*(1.0/4294967296.0); }

fn cosineSample(N: vec3<f32>, idx: u32) -> vec3<f32> {
    let r1=nextRng(idx); let r2=nextRng(idx); let phi=6.28318530*r1; let sq=sqrt(r2);
    let T=normalize(select(cross(N,vec3<f32>(1,0,0)),cross(N,vec3<f32>(0,1,0)),abs(N.x)<0.9));
    let B=cross(N,T); return sq*(cos(phi)*T+sin(phi)*B)+sqrt(1.0-r2)*N;
}

struct Hit { t: f32, n: vec3<f32>, albedo: vec3<f32> }
// Szene-Intersection (Wände + Boxen) – identisch mit WebGL-Version
fn hitYPlane(ro:vec3<f32>,rd:vec3<f32>,y:f32,x0:f32,x1:f32,z0:f32,z1:f32,tmax:f32)->f32{if(abs(rd.y)<1e-6){return -1.0;}let t=(y-ro.y)/rd.y;if(t<0.001||t>tmax){return -1.0;}let p=ro+t*rd;return select(-1.0,t,p.x>=x0&&p.x<=x1&&p.z>=z0&&p.z<=z1);}
fn hitXPlane(ro:vec3<f32>,rd:vec3<f32>,x:f32,y0:f32,y1:f32,z0:f32,z1:f32,tmax:f32)->f32{if(abs(rd.x)<1e-6){return -1.0;}let t=(x-ro.x)/rd.x;if(t<0.001||t>tmax){return -1.0;}let p=ro+t*rd;return select(-1.0,t,p.y>=y0&&p.y<=y1&&p.z>=z0&&p.z<=z1);}
fn hitZPlane(ro:vec3<f32>,rd:vec3<f32>,z:f32,x0:f32,x1:f32,y0:f32,y1:f32,tmax:f32)->f32{if(abs(rd.z)<1e-6){return -1.0;}let t=(z-ro.z)/rd.z;if(t<0.001||t>tmax){return -1.0;}let p=ro+t*rd;return select(-1.0,t,p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1);}
fn hitAABB(ro:vec3<f32>,rd:vec3<f32>,bmin:vec3<f32>,bmax:vec3<f32>,tmax:f32)->f32{let inv=1.0/rd;let t0=(bmin-ro)*inv;let t1=(bmax-ro)*inv;let tlo=min(t0,t1);let thi=max(t0,t1);let te=max(max(tlo.x,tlo.y),tlo.z);let tx=min(min(thi.x,thi.y),thi.z);if(tx<=max(te,0.001)||te>=tmax){return -1.0;}let t=select(tx,te,te>0.001);return select(-1.0,t,t<tmax);}
fn aabbN(ro:vec3<f32>,rd:vec3<f32>,t:f32,bmin:vec3<f32>,bmax:vec3<f32>)->vec3<f32>{let p=ro+t*rd;let c=(bmin+bmax)*0.5;let hh=(bmax-bmin)*0.5;let d=abs((p-c)/hh);if(d.x>=d.y&&d.x>=d.z){return vec3<f32>(sign((p-c).x),0,0);}if(d.y>=d.z){return vec3<f32>(0,sign((p-c).y),0);}return vec3<f32>(0,0,sign((p-c).z));}

fn scene(ro:vec3<f32>,rd:vec3<f32>)->Hit{var h:Hit;h.t=1e20;h.albedo=vec3<f32>(0);var t:f32;t=hitYPlane(ro,rd,-1.0,-1.0,1.0,-1.0,1.0,h.t);if(t>0.0){h.t=t;h.n=vec3<f32>(0,1,0);h.albedo=vec3<f32>(0.73);}t=hitZPlane(ro,rd,-1.0,-1.0,1.0,-1.0,1.0,h.t);if(t>0.0){h.t=t;h.n=vec3<f32>(0,0,1);h.albedo=vec3<f32>(0.73);}t=hitXPlane(ro,rd,-1.0,-1.0,1.0,-1.0,1.0,h.t);if(t>0.0){h.t=t;h.n=vec3<f32>(1,0,0);h.albedo=vec3<f32>(0.65,0.05,0.05);}t=hitXPlane(ro,rd,1.0,-1.0,1.0,-1.0,1.0,h.t);if(t>0.0){h.t=t;h.n=vec3<f32>(-1,0,0);h.albedo=vec3<f32>(0.12,0.45,0.15);}let b1min=vec3<f32>(-0.65,-1.0,-0.85);let b1max=vec3<f32>(-0.1,0.3,-0.2);t=hitAABB(ro,rd,b1min,b1max,h.t);if(t>0.0){h.t=t;h.n=aabbN(ro,rd,t,b1min,b1max);h.albedo=vec3<f32>(0.73);}let b2min=vec3<f32>(0.1,-1.0,-0.85);let b2max=vec3<f32>(0.65,-0.4,-0.2);t=hitAABB(ro,rd,b2min,b2max,h.t);if(t>0.0){h.t=t;h.n=aabbN(ro,rd,t,b2min,b2max);h.albedo=vec3<f32>(0.73);}return h;}

fn sky(rd:vec3<f32>)->vec3<f32>{let s=clamp(rd.y*0.5+0.5,0.0,1.0);return mix(vec3<f32>(0.85,0.82,0.75),vec3<f32>(0.45,0.68,1.0),s*s);}

fn pathTrace(ro_in:vec3<f32>,rd_in:vec3<f32>,pixIdx:u32)->vec3<f32>{
    var tp=vec3<f32>(1.0);var ro=ro_in;var rd=rd_in;
    for(var i=0u;i<params.maxBounces;i++){
        let h=scene(ro,rd);if(h.t>=1e20){return tp*sky(rd);}
        tp*=h.albedo;
        if(i>=3u){let q=max(h.albedo.r,max(h.albedo.g,h.albedo.b));if(nextRng(pixIdx)>q){return vec3<f32>(0.0);}tp/=q;}  // Russian Roulette
        ro=ro+h.t*rd+h.n*0.001;rd=cosineSample(h.n,pixIdx);
    }
    return tp*sky(rd);
}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
    let W=params.resolution.x;let H=params.resolution.y;
    if(gid.x>=W||gid.y>=H){return;}
    let idx=gid.y*W+gid.x;
    if(params.frameIndex==0u){rngBuf[idx]=idx*1664525u+1013904223u;}  // RNG-Init
    let jx=nextRng(idx)-0.5;let jy=nextRng(idx)-0.5;
    let uv=vec2<f32>((f32(gid.x)+jx-0.5*f32(W))/f32(H),(0.5*f32(H)-f32(gid.y)-jy)/f32(H));
    let rd=normalize(params.camFwd.xyz*1.2+uv.x*params.camRight.xyz+uv.y*params.camUp.xyz);
    accum[idx]+=vec4<f32>(pathTrace(params.camPos.xyz,rd,idx),1.0);  // HDR-Akkumulation
}
