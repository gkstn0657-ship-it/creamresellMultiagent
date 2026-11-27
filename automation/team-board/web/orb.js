// A particle surface and its short neural connections surround the luminous core.
(() => {
  "use strict";
  const host = document.getElementById("orb");
  if (!host) return;

  const moods = {
    // RGB, rotation speed and intensity. The surface keeps the original multicolour grain.
    idle:       {rgb:[170,154,236], speed:.45, light:.22},
    ready:      {rgb:[171,166,249], speed:.66, light:.40},
    worker:     {rgb:[88,224,242],  speed:1.35, light:.85},
    contractor: {rgb:[123,197,255], speed:1.60, light:.78},
    sourcing:   {rgb:[106,230,195], speed:1.12, light:.83},
    reviewer:   {rgb:[193,154,254], speed:.84, light:.72},
    auditor:    {rgb:[245,205,145], speed:.65, light:.66},
    blocked:    {rgb:[249,166,105], speed:.18, light:.48},
    done:       {rgb:[150,224,191], speed:.32, light:.32},
    offline:    {rgb:[133,145,167], speed:0, light:.08},
  };

  // Directional surface displacement travels through the same shell as the core and halo.
  function bindSurface(material, uniforms) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = "uniform vec4 currents; uniform float clockPhase; uniform float restCompression;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>", `#include <begin_vertex>
          vec3 n = normalize(position + vec3(.0001));
          float inhale = sin(clockPhase * 2.2 - abs(dot(n,vec3(2.4,3.6,-1.6))));
          float lobes = (n.x*n.x - n.y*n.y) * sin(clockPhase*1.5) + 2.0*n.x*n.y*cos(clockPhase*1.5);
          float inspect = .5 + .5*cos(clockPhase*1.6 + 2.6*abs(n.x));
          float closeWave = .5 + .5*cos(clockPhase*2.1 + 2.1*abs(n.z));
          transformed.y *= 1.0 - .22*restCompression;
          transformed *= 1.0 + currents.x*.095*inhale + currents.y*.15*lobes
                             + currents.z*.09*inspect - currents.w*.12*closeWave;`);
    };
  }

  function webglScene(canvas, context) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.position.z = 23.5;
    const renderer = new THREE.WebGLRenderer({canvas, context, alpha:true, antialias:true});
    const mainGroup = new THREE.Group();
    scene.add(mainGroup);

    // Soft circular fuzzy glow particle canvas texture
    function createEtherealParticleTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.2, 'rgba(230, 215, 255, 0.95)');
      gradient.addColorStop(0.45, 'rgba(150, 110, 255, 0.55)');
      gradient.addColorStop(0.75, 'rgba(34, 211, 238, 0.2)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      const texture = new THREE.CanvasTexture(canvas);
      return texture;
    }

    const particleTexture = createEtherealParticleTexture();
    const globeRadius = 6.2;

    // 1. Cosmic Earth Continent Particles (High visibility, glowing ethereal colours)
    const dotCount = 5200;
    const dotGeo = new THREE.BufferGeometry();
    const dotPos = new Float32Array(dotCount * 3);
    const dotCols = new Float32Array(dotCount * 3);
    const aiNodes = [];

    for (let i = 0; i < dotCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      const lat = (Math.PI / 2) - phi;
      const continentNoise = Math.sin(lat * 3.2 + Math.cos(theta * 2.0)) * 0.65
                           + Math.sin(lat * 5.8 + theta * 1.5) * 0.35
                           + Math.sin(lat * 10.0) * 0.1;
      const isLand = continentNoise > -0.12;

      const altitude = isLand
        ? (Math.random() * 0.45 - 0.1)
        : (Math.random() * 0.25 - 0.3);
      const r = globeRadius + altitude;

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      dotPos[i * 3] = x;
      dotPos[i * 3 + 1] = y;
      dotPos[i * 3 + 2] = z;
      if (isLand && aiNodes.length < 90 && Math.random() > .82) {
        aiNodes.push(new THREE.Vector3(x,y,z));
      }

      if (isLand) {
        const rnd = Math.random();
        if (rnd > 0.85) {
          // Golden Starlight Pulse
          dotCols[i * 3] = 1.0;
          dotCols[i * 3 + 1] = 0.9;
          dotCols[i * 3 + 2] = 0.45;
        } else if (rnd > 0.45) {
          // Astral Violet / Neon Lavender
          dotCols[i * 3] = 0.75;
          dotCols[i * 3 + 1] = 0.42;
          dotCols[i * 3 + 2] = 1.0;
        } else {
          // Celestial Aqua / Cyan
          dotCols[i * 3] = 0.15;
          dotCols[i * 3 + 1] = 0.85;
          dotCols[i * 3 + 2] = 1.0;
        }
      } else {
        // Oceanic Deep Indigo Mist
        dotCols[i * 3] = 0.15;
        dotCols[i * 3 + 1] = 0.25;
        dotCols[i * 3 + 2] = 0.65;
      }
    }

    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    dotGeo.setAttribute('color', new THREE.BufferAttribute(dotCols, 3));

    const dotMat = new THREE.PointsMaterial({
      size: 0.52,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const earthPoints = new THREE.Points(dotGeo, dotMat);
    mainGroup.add(earthPoints);

    const linePositions = [];
    for (let i=0; i<aiNodes.length; i++) {
      for (let j=i+1; j<aiNodes.length; j++) {
        const start = aiNodes[i], end = aiNodes[j], distance = start.distanceTo(end);
        if (distance <= 1.2 || distance >= 3.4) continue;
        const mid = start.clone().add(end).normalize().multiplyScalar(globeRadius*1.08 + Math.random()*.3);
        linePositions.push(start.x,start.y,start.z,mid.x,mid.y,mid.z,mid.x,mid.y,mid.z,end.x,end.y,end.z);
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color:0xa78bfa, transparent:true, opacity:.4, blending:THREE.AdditiveBlending, depthWrite:false
    });
    const neuralCurves = new THREE.LineSegments(lineGeo,lineMat);
    mainGroup.add(neuralCurves);

    // Spherical Aura Mist Cloud (Enveloping Earth into a dreamlike luminous orb)
    const haloCount = 2200;
    const haloGeo = new THREE.BufferGeometry();
    const haloPos = new Float32Array(haloCount * 3);
    const haloCols = new Float32Array(haloCount * 3);

    for (let i = 0; i < haloCount; i++) {
      const dist = globeRadius * (0.92 + Math.random() * 0.42);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      haloPos[i * 3] = dist * Math.sin(phi) * Math.cos(theta);
      haloPos[i * 3 + 1] = dist * Math.sin(phi) * Math.sin(theta);
      haloPos[i * 3 + 2] = dist * Math.cos(phi);

      const rnd = Math.random();
      if (rnd > 0.55) {
        haloCols[i * 3] = 0.72;
        haloCols[i * 3 + 1] = 0.38;
        haloCols[i * 3 + 2] = 0.98;
      } else if (rnd > 0.2) {
        haloCols[i * 3] = 0.15;
        haloCols[i * 3 + 1] = 0.75;
        haloCols[i * 3 + 2] = 0.95;
      } else {
        haloCols[i * 3] = 0.95;
        haloCols[i * 3 + 1] = 0.45;
        haloCols[i * 3 + 2] = 0.8;
      }
    }

    haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
    haloGeo.setAttribute('color', new THREE.BufferAttribute(haloCols, 3));

    const haloMat = new THREE.PointsMaterial({
      size: 0.75,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const haloOrb = new THREE.Points(haloGeo, haloMat);
    mainGroup.add(haloOrb);

    // Inner Luminous Intelligence Singularity Core
    const coreCount = 600;
    const coreGeo = new THREE.BufferGeometry();
    const corePos = new Float32Array(coreCount * 3);
    const coreCols = new Float32Array(coreCount * 3);

    for (let i = 0; i < coreCount; i++) {
      const r = Math.pow(Math.random(), 1.5) * 2.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      corePos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      corePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      corePos[i * 3 + 2] = r * Math.cos(phi);

      const isGold = Math.random() > 0.4;
      coreCols[i * 3] = isGold ? 1.0 : 0.7;
      coreCols[i * 3 + 1] = isGold ? 0.85 : 0.4;
      coreCols[i * 3 + 2] = isGold ? 0.4 : 1.0;
    }
    coreGeo.setAttribute('position', new THREE.BufferAttribute(corePos, 3));
    coreGeo.setAttribute('color', new THREE.BufferAttribute(coreCols, 3));

    const coreMat = new THREE.PointsMaterial({
      size: 0.65,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const corePlasma = new THREE.Points(coreGeo, coreMat);
    mainGroup.add(corePlasma);

    // Outer Floating Cosmic Stardust Fog
    const stardustCount = 1000;
    const stardustGeo = new THREE.BufferGeometry();
    const stardustPos = new Float32Array(stardustCount * 3);
    const stardustCols = new Float32Array(stardustCount * 3);

    for (let i = 0; i < stardustCount; i++) {
      const r = globeRadius * (1.15 + Math.random() * 0.95);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      stardustPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      stardustPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      stardustPos[i * 3 + 2] = r * Math.cos(phi);

      stardustCols[i * 3] = 0.55 + Math.random() * 0.4;
      stardustCols[i * 3 + 1] = 0.45 + Math.random() * 0.45;
      stardustCols[i * 3 + 2] = 0.98;
    }
    stardustGeo.setAttribute('position', new THREE.BufferAttribute(stardustPos, 3));
    stardustGeo.setAttribute('color', new THREE.BufferAttribute(stardustCols, 3));

    const stardustMat = new THREE.PointsMaterial({
      size: 0.45,
      map: particleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const stardustCloud = new THREE.Points(stardustGeo, stardustMat);
    mainGroup.add(stardustCloud);

    const uniforms = {currents:{value:new THREE.Vector4()}, clockPhase:{value:0}, restCompression:{value:0}};
    for (const material of [dotMat, lineMat, haloMat]) bindSurface(material, uniforms);

    return {
      resize(width, height, ratio) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(ratio);
        renderer.setSize(width, height, false);
      },
      draw(seconds, x, y, signal) {
        const {rgb, light, pulse, collect, divided, verify, audit} = signal;
        uniforms.currents.value.set(collect, divided, verify, audit);
        uniforms.clockPhase.value = seconds;
        uniforms.restCompression.value = signal.rest;
        const breathing = Math.sin(seconds * 1.32);
        lineMat.color.setRGB(rgb[0]/255, rgb[1]/255, rgb[2]/255);
        haloMat.color.copy(lineMat.color);
        lineMat.opacity = .16 + light*.24 + breathing*light*.10 + pulse*.25;
        dotMat.color.setRGB(.77 + rgb[0]/1110, .77 + rgb[1]/1110, .77 + rgb[2]/1110);
        haloMat.opacity = .35 + light * .25 + pulse * .15;
        dotMat.opacity = .72 + light * .21;
        coreMat.opacity = .48 + light * .36 + pulse * .14;
        earthPoints.rotation.y = neuralCurves.rotation.y = seconds * 0.10;
        haloOrb.rotation.y = -seconds * 0.05;
        haloOrb.rotation.x = seconds * 0.025;
        stardustCloud.rotation.y = seconds * 0.04;
        corePlasma.scale.setScalar(.94 + light * .13 + breathing * light * .11 + pulse * .24);
        corePlasma.rotation.y = -seconds * 0.30;
        haloOrb.scale.setScalar(.98 + Math.sin(seconds * .96) * light * .045 + pulse * .055);
        mainGroup.rotation.set(-y * 0.26, x * 0.38, 0);
        renderer.render(scene, camera);
      },
    };
  }

  // Project a luminous particle shell even on machines without a WebGL context.
  function canvasScene(canvas) {
    const ctx = canvas.getContext("2d");
    const colors = ["132,139,255","117,224,255","204,151,255","247,217,153"];
    const sprites = colors.map((color) => {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 32;
      const paint = sprite.getContext("2d");
      const glow = paint.createRadialGradient(16,16,0,16,16,16);
      glow.addColorStop(0, "rgba(" + color + ",1)");
      glow.addColorStop(.22, "rgba(" + color + ",.70)");
      glow.addColorStop(1, "rgba(" + color + ",0)");
      paint.fillStyle = glow;
      paint.fillRect(0,0,32,32);
      return sprite;
    });
    const points = Array.from({length:1750}, (_, i) => {
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const halo = i > 1420;
      const orbit = halo ? 1.06 + Math.random() * .40 : .96 + Math.random() * .055;
      const y = Math.cos(phi);
      const terrain = Math.sin(y * 6 + Math.cos(theta * 2)) + Math.sin(theta * 2.4 + y * 4) * .55;
      const tint = terrain < -.2 ? 0 : i % 14 === 0 ? 3 : i % 3 ? 2 : 1;
      return {x:orbit*Math.sin(phi)*Math.cos(theta), y:y*orbit, z:orbit*Math.sin(phi)*Math.sin(theta), tint, halo};
    });
    const nodes = points.slice(0,80);
    const edges = [];
    for (const [i,node] of nodes.entries()) {
      for (const other of nodes.slice(i+1)) {
        const distance=Math.hypot(node.x-other.x,node.y-other.y,node.z-other.z);
        if (distance>.18 && distance<.49) edges.push([node,other]);
      }
    }
    let width, height;
    return {
      resize(w, h, ratio) {
        width=w; height=h;
        canvas.width=Math.round(w*ratio); canvas.height=Math.round(h*ratio);
        ctx.setTransform(ratio,0,0,ratio,0,0);
      },
      draw(seconds, mouseX, mouseY, signal) {
        ctx.clearRect(0,0,width,height);
        const cx=width/2, cy=height/2, radius=Math.min(height*.37,width*.33);
        const turn=seconds*.09+mouseX*.38, tilt=-mouseY*.26;
        const a=Math.cos(turn), b=Math.sin(turn), c=Math.cos(tilt), d=Math.sin(tilt);
        const haze=ctx.createRadialGradient(cx,cy,0,cx,cy,radius*1.3);
        const tint = signal.rgb.map(Math.round).join(",");
        haze.addColorStop(0,"rgba("+tint+"," + (.10 + signal.light*.15 + signal.pulse*.16) + ")");
        haze.addColorStop(.58,"rgba(85,102,192,.12)");
        haze.addColorStop(.79,"rgba("+tint+"," + (.12 + signal.light*.12) + ")");
        haze.addColorStop(1,"rgba(91,85,185,0)");
        ctx.fillStyle=haze;
        ctx.fillRect(cx-radius*1.3,cy-radius*1.3,radius*2.6,radius*2.6);
        ctx.globalCompositeOperation="lighter";
        const sinLobes = Math.sin(seconds*1.5), cosLobes = Math.cos(seconds*1.5);
        for(const point of points) {
          const x = a*point.x+b*point.z, z = a*point.z-b*point.x;
          const y = c*point.y-d*z, depth = (c*z+d*point.y+1)*.5;
          const expand = 1 + signal.collect*.095*Math.sin(seconds*2.2 - Math.abs(point.x*2.4+point.y*3.6-point.z*1.6))
            + signal.divided*.15*((point.x*point.x-point.y*point.y)*sinLobes + 2*point.x*point.y*cosLobes)
            + signal.verify*.09*(.5+.5*Math.cos(seconds*1.6+2.6*Math.abs(point.x)))
            - signal.audit*.12*(.5 + .5*Math.cos(seconds*2.1 + 2.1*Math.abs(point.z)));
          const size = radius*(point.halo?.026:.050)*(.6+Math.max(0,depth)*.5);
          ctx.globalAlpha = (point.halo?.38:Math.max(.13,Math.min(.88,depth*.7+.16))) * (.76 + signal.light*.20);
          point.px = cx+x*radius*expand;
          point.py = cy+y*radius*expand*(1-.22*signal.rest);
          ctx.drawImage(sprites[point.tint],point.px-size/2,point.py-size/2,size,size);
        }
        ctx.strokeStyle="rgb("+tint+")"; ctx.globalAlpha=.22+signal.light*.14; ctx.lineWidth=.65;
        ctx.beginPath();
        for (const [start,end] of edges) { ctx.moveTo(start.px,start.py); ctx.lineTo(end.px,end.py); }
        ctx.stroke();
        ctx.globalAlpha=1;
        ctx.globalCompositeOperation="source-over";
      },
    };
  }

  let engine;
  let canvas = document.createElement("canvas");
  if (window.THREE) {
    try {
      const options = {alpha:true, antialias:true, powerPreference:"low-power"};
      const context = canvas.getContext("webgl2",options) || canvas.getContext("webgl",options);
      if (context) engine = webglScene(canvas, context);
    } catch {}
  }
  if (!engine) {
    canvas = document.createElement("canvas");
    engine = canvasScene(canvas);
  }
  host.append(canvas);
  const overlay = document.createElement("canvas");
  overlay.setAttribute("aria-hidden", "true");
  host.append(overlay);
  const paint = overlay.getContext("2d");
  const TAU = Math.PI*2;
  let width = 0, height = 0, lanes = [];
  let satellites = [];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let mood = moods.offline;
  const target = {collect:0, divided:0, verify:0, audit:0};
  const signal = {...target, rest:0, rgb:[...mood.rgb], speed:mood.speed, light:mood.light, pulse:0};
  let visible = true, frame = 0, previous = null, elapsed = 0, signature = "";
  let targetX=0, targetY=0, x=0, y=0;

  function satelliteFor(id) {
    // Derive each orbit from the work ID so inserting/removing another work
    // or handing the same card to a colleague never repositions its satellite.
    let hash = 2166136261;
    for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0),16777619);
    function sample() {
      hash ^= hash >>> 16; hash = Math.imul(hash,0x45d9f3b); hash ^= hash >>> 16;
      return (hash >>> 0)/4294967296;
    }
    return {phase:TAU*sample(),speed:.32+.42*sample(),tilt:(sample()-.5)*1.55,
      radius:1.08+.20*sample(),minor:.47+.38*sample(),tint:Math.round(172+70*sample())};
  }

  function drawActivity(t) {
    paint.clearRect(0,0,width,height);
    if (!lanes.length && signal.verify<.01 && !satellites.length) return;
    const radius = Math.min(height*.37,width*.33);
    paint.save();
    paint.translate(width/2,height/2);
    paint.globalCompositeOperation="lighter";
    paint.lineCap="round";
    for (const [index,lane] of lanes.entries()) {
      const direction=lane.naver ? -1 : 1;
      const angle=(t*(lane.inspect ? .67 : 1.35)*direction + lane.offset)%TAU;
      const sx=radius*(1.08 + index*.035), sy=radius*(lane.inspect ? .42 : .64);
      paint.save();
      paint.rotate((lane.naver ? .82 : -.55) + index*.20);
      paint.strokeStyle=lane.naver ? "rgb(113,239,186)" : "rgb(115,210,253)";
      paint.globalAlpha=.17;
      paint.lineWidth=.9;
      paint.beginPath(); paint.ellipse(0,0,sx,sy,0,0,TAU); paint.stroke();
      for (let i=0;i<13;i++) {
        const a=angle-direction*(13-i)*.093, b=a+direction*.098;
        paint.lineWidth=.8+i*.12; paint.globalAlpha=.09+i*.055;
        paint.beginPath(); paint.ellipse(0,0,sx,sy,0,Math.min(a,b),Math.max(a,b)); paint.stroke();
      }
      paint.restore();
    }
    if (signal.verify>.01) {
      paint.globalAlpha=(.56+.06*Math.cos(t*.95))*signal.verify;
      paint.strokeStyle="rgb(200,178,255)"; paint.lineWidth=1.5;
      paint.beginPath(); paint.ellipse(0,0,radius,radius*.15,0,0,TAU); paint.stroke();
    }
    for (const satellite of satellites) {
      const a=satellite.phase + t*satellite.speed;
      const ox=radius*satellite.radius*Math.cos(a), oy=radius*satellite.minor*Math.sin(a);
      const c=Math.cos(satellite.tilt), s=Math.sin(satellite.tilt);
      paint.fillStyle="hsl("+satellite.tint+" 100% 88%)";
      paint.shadowColor=paint.fillStyle; paint.shadowBlur=9; paint.globalAlpha=.96;
      paint.beginPath(); paint.arc(c*ox-s*oy,s*ox+c*oy,2.9,0,TAU); paint.fill();
    }
    paint.restore();
  }

  host.addEventListener("board-activity", ({detail}) => {
    const sources = detail.sources || [];
    const ids = [...new Set(detail.workIds || [])];
    const key = JSON.stringify([detail.mode,detail.roles,ids,sources]);
    if (key === signature && !detail.pulse) return;
    signature = key;
    host.dataset.activity = detail.mode;
    host.dataset.count = String(detail.count);
    mood = moods[detail.mode] || moods.idle;
    const hasRole = role => detail.roles.includes(role);
    target.collect = Number(sources.some(s=>s.phase==="collect") || hasRole("worker") || hasRole("contractor"));
    target.divided = Number(detail.count > 1);
    target.verify = Number(sources.some(s=>s.phase==="verify") || hasRole("reviewer"));
    target.audit = Number(sources.some(s=>s.phase==="audit") || hasRole("auditor"));
    lanes = sources.filter(s=>["collect","verify","audit"].includes(s.phase)).slice(0,4).map((s,i)=>({
      naver:String(s.id).startsWith("naver:"), inspect:s.phase!=="collect", offset:i*2.31+.8,
    }));
    if (detail.count>1 && !lanes.length) {
      lanes=detail.roles.slice(0,3).map((role,i)=>({naver:false,inspect:role==="reviewer"||role==="auditor",offset:i*2.31+.8}));
    }
    satellites = ids.map(satelliteFor);
    host.dataset.motion = Object.keys(target).filter(k=>target[k]).join(" ") || detail.mode;
    host.dataset.streams = String(lanes.length);
    host.dataset.satellites = String(satellites.length);
    if (detail.pulse && detail.count && visible && !document.hidden && !reduced.matches) signal.pulse = 1;
    if (reduced.matches) previous=null;
    schedule();
  });

  function render(now) {
    frame = 0;
    if (document.hidden || !visible) { previous = null; return; }
    if (previous === null || now - previous >= 32) {
      const dt = previous === null ? 0 : Math.min((now-previous)/1000,.12);
      previous = now;
      const blend = reduced.matches ? 1 : 1 - Math.exp(-dt*3);
      for (let i=0; i<3; i++) signal.rgb[i] += (mood.rgb[i] - signal.rgb[i]) * blend;
      signal.speed += (mood.speed * (1 + target.divided*.22) - signal.speed) * blend;
      signal.collect += (target.collect-signal.collect)*blend;
      signal.divided += (target.divided-signal.divided)*blend;
      signal.verify += (target.verify-signal.verify)*blend;
      signal.audit += (target.audit-signal.audit)*blend;
      const rest = mood===moods.blocked||mood===moods.offline ? 1 : mood===moods.ready ? .45 : 0;
      signal.rest += (rest-signal.rest)*blend;
      signal.light += (mood.light - signal.light) * blend;
      signal.pulse = reduced.matches ? 0 : signal.pulse * Math.exp(-dt*2.4);
      if (!reduced.matches) {
        elapsed += dt * signal.speed;
        const smoothing = 1 - Math.exp(-dt*4);
        x += (targetX-x)*smoothing;
        y += (targetY-y)*smoothing;
      }
      engine.draw(elapsed,x,y,signal);
      drawActivity(reduced.matches ? 0 : elapsed);
    }
    if (!reduced.matches) schedule();
  }
  function schedule() {
    if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render);
  }
  function resize() {
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width=bounds.width; height=bounds.height;
    const ratio=Math.min(window.devicePixelRatio||1,1.5);
    overlay.width=Math.round(width*ratio); overlay.height=Math.round(height*ratio);
    paint.setTransform(ratio,0,0,ratio,0,0);
    engine.resize(width,height,ratio);
    previous=null;
    schedule();
  }
  host.addEventListener("pointermove", (e) => {
    const b=host.getBoundingClientRect();
    targetX=(e.clientX-b.left)/b.width*2-1;
    targetY=(e.clientY-b.top)/b.height*2-1;
  },{passive:true});
  host.addEventListener("pointerleave", () => {targetX=0;targetY=0;});
  new ResizeObserver(resize).observe(host);
  function updateVisibility() {
    signal.pulse=0;
    previous=null;
    schedule();
  }
  new IntersectionObserver(([entry]) => {visible=entry.isIntersecting;updateVisibility();}).observe(host);
  document.addEventListener("visibilitychange",updateVisibility);
  reduced.addEventListener("change",()=>{previous=null;schedule();});
  resize();
})();
