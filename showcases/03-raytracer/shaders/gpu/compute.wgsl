// =============================================================================
// compute.wgsl – WebGPU Compute Raytracer (Showcase 03)
// Jeder Compute-Invocation = ein Pixel. Schreibt in Akkumulations-Buffer.
// Persistenter RNG-Zustand pro Pixel für progressives Anti-Aliasing.
// =============================================================================

struct Params { resolution: vec2<u32>, frameIndex: u32, _pad: u32, camPos: vec4<f32>, camFwd: vec4<f32>, camRight: vec4<f32>, camUp: vec4<f32> }
@group(0) @binding(0) var<uniform>            params: Params;
@group(0) @binding(1) var<storage, read_write> accum:  array<vec4<f32>>;

// Wang-Hash RNG (zustandslos, basiert auf Pixel-Index + Frame)
fn hash(n: u32) -> f32 { let x=n*1664525u+1013904223u; return f32(x)/4294967296.0; }

struct Hit { t: f32, n: vec3<f32>, mat: u32, albedo: vec3<f32> }

fn hitSphere(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: f32, tmax: f32) -> f32 {
    let oc=ro-c; let b=dot(oc,rd); let d=b*b-dot(oc,oc)+r*r;
    if(d<0.0){return -1.0;}
    let sq=sqrt(d); var t=-b-sq;
    if(t<0.001||t>tmax){t=-b+sq;}
    return select(-1.0, t, t>0.001&&t<tmax);
}

fn sceneHit(ro: vec3<f32>, rd: vec3<f32>) -> Hit {
    var h: Hit; h.t=1e20; h.mat=0u;
    if(abs(rd.y)>1e-4){let tb=(-1.0-ro.y)/rd.y; if(tb>0.001&&tb<h.t){h.t=tb;h.n=vec3<f32>(0,1,0);h.mat=4u;let p=ro+tb*rd;let cb=(floor(p.x)+floor(p.z))%2.0<1.0;h.albedo=select(vec3<f32>(0.3),vec3<f32>(0.9),cb);}}
    let t1=hitSphere(ro,rd,vec3<f32>(-1.1,-0.5,-0.5),0.5,h.t); if(t1>0.0){h.t=t1;h.n=normalize(ro+t1*rd-vec3<f32>(-1.1,-0.5,-0.5));h.mat=2u;h.albedo=vec3<f32>(0.9,0.9,0.85);}
    let t2=hitSphere(ro,rd,vec3<f32>(0.0,-0.5,0.0),0.5,h.t);  if(t2>0.0){h.t=t2;h.n=normalize(ro+t2*rd-vec3<f32>(0.0,-0.5,0.0));h.mat=3u;h.albedo=vec3<f32>(0.95,0.95,1.0);}
    let t3=hitSphere(ro,rd,vec3<f32>(1.1,-0.5,-0.5),0.5,h.t);  if(t3>0.0){h.t=t3;h.n=normalize(ro+t3*rd-vec3<f32>(1.1,-0.5,-0.5));h.mat=1u;h.albedo=vec3<f32>(0.85,0.2,0.15);}
    return h;
}

fn schlick(c: f32, ior: f32) -> f32 { var r0=(1.0-ior)/(1.0+ior); r0*=r0; return r0+(1.0-r0)*pow(1.0-c,5.0); }
fn sky(rd: vec3<f32>) -> vec3<f32> { let t=0.5*(rd.y+1.0); return mix(vec3<f32>(1.0,0.98,0.94),vec3<f32>(0.47,0.67,0.92),t); }
fn directLight(pos: vec3<f32>, N: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
    let lp=vec3<f32>(2.0,3.5,2.0); let L=normalize(lp-pos); var NdL=max(dot(N,L),0.0);
    let sh=sceneHit(pos+N*0.002,L); if(sh.t<length(lp-pos)){NdL=0.0;}
    return albedo*vec3<f32>(1.0,0.97,0.90)*5.0*NdL/dot(lp-pos,lp-pos)+albedo*0.05;
}

fn trace(ro_in: vec3<f32>, rd_in: vec3<f32>) -> vec3<f32> {
    var color=vec3<f32>(0.0); var throughput=vec3<f32>(1.0); var ro=ro_in; var rd=rd_in;
    for(var b=0u; b<7u; b++){
        let h=sceneHit(ro,rd);
        if(h.t>=1e20){color+=throughput*sky(rd);break;}
        let pos=ro+h.t*rd; let inside=dot(h.n,rd)>0.0; let N=select(h.n,-h.n,inside);
        if(h.mat==1u||h.mat==4u){color+=throughput*directLight(pos,N,h.albedo);break;}
        else if(h.mat==2u){color+=throughput*directLight(pos,N,h.albedo)*0.04;throughput*=h.albedo;rd=reflect(rd,N);ro=pos+N*0.002;}
        else {
            let ior=select(1.5,1.0/1.5,inside); let cosI=abs(dot(N,-rd)); let fr=schlick(cosI,ior);
            let refr=refract(rd,N,ior);
            if(length(refr)<0.001||fr>0.95){rd=reflect(rd,N);ro=pos+N*0.002;}
            else{throughput*=h.albedo;rd=normalize(refr);ro=pos-N*0.002;}
        }
    }
    return color;
}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let W=params.resolution.x; let H=params.resolution.y;
    if(gid.x>=W||gid.y>=H){return;}
    let idx=gid.y*W+gid.x;
    let seed=idx*1973u+params.frameIndex*9277u;
    // Jitter für Anti-Aliasing (progressive Akkumulation)
    let jx=hash(seed)-0.5; let jy=hash(seed+1u)-0.5;
    let uv=vec2<f32>((f32(gid.x)+jx-0.5*f32(W))/f32(H),(0.5*f32(H)-f32(gid.y)-jy)/f32(H));
    let rd=normalize(params.camFwd.xyz*1.5+uv.x*params.camRight.xyz+uv.y*params.camUp.xyz);
    accum[idx]+=vec4<f32>(trace(params.camPos.xyz,rd),1.0);  // HDR-Akkumulation
}
