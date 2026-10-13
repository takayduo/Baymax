import { getAppearance, shade, companionInk, musicAppearance, type Appearance } from "./appearance";
import accessories from "../../public/companions/accessories.json";

// Original vector artwork. All silhouettes share a facial anchor, never a body shape.
const paths = new Map<string, Path2D>();
function path(data: string, rx: number, ry: number): Path2D {
  if (!paths.has(data)) paths.set(data, new Path2D(data));
  const result = new Path2D();
  result.addPath(paths.get(data)!, new DOMMatrix().scale(rx / 110, ry / 100));
  return result;
}
export function companionPath(rx: number, ry: number, appearance = getAppearance()) {
  // Isotropic coordinates preserve true circles and rounded ears at every canvas size.
  if (appearance.avatar.minimal) { const unit = Math.min(rx / 110, ry / 100); rx = unit * 110; ry = unit * 100; }
  return path(appearance.avatar.body, rx, ry);
}
export function drawCompanionBody(ctx: CanvasRenderingContext2D, rx: number, ry: number, appearance = getAppearance(), pose = { yaw: 0, pitch: 0 }, headphones = musicAppearance().headphones) {
  const { avatar, style } = appearance;
  if (headphones) drawMusicHeadphones(ctx, rx, ry, appearance, pose, true);
  const body = companionPath(rx, ry, appearance);
  const px = Math.sin(pose.yaw) * rx, py = -Math.sin(pose.pitch) * ry;
  const hx = -rx * .32 + px * .22, hy = -ry * .43 + py * .22;
  const g = ctx.createRadialGradient(hx, hy, 0, hx * .45, hy * .35, Math.max(rx, ry) * 1.22);
  g.addColorStop(0, shade(style.color, .38)); g.addColorStop(.44, shade(style.color, .1));
  g.addColorStop(.73, style.color); g.addColorStop(1, shade(style.color, -.26));
  ctx.fillStyle = g; ctx.fill(body);
  ctx.save(); ctx.clip(body);
  ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = Math.max(.5, rx * .018); ctx.stroke(body);
  const shadow = ctx.createRadialGradient(px * .12, ry * .99 + py * .12, 0, px * .12, ry * .99 + py * .12, ry * .95);
  shadow.addColorStop(0, "rgba(22,18,43,.16)"); shadow.addColorStop(1, "rgba(22,18,43,0)");
  ctx.fillStyle = shadow; ctx.fill(body);
  ctx.save(); attachToHead(ctx, rx, ry, pose);
  for (const detail of avatar.details) {
    const p = path(detail.path, rx, ry);
    ctx.fillStyle = style.accent; ctx.strokeStyle = shade(style.accent, -.18);
    if (detail.tone === "line") { ctx.lineWidth = rx * .028; ctx.lineCap = "round"; ctx.stroke(p); }
    else ctx.fill(p);
  }
  // A softly tinted face keeps every expression legible, including on black bodies.
  if (!avatar.minimal && avatar.face) { ctx.fillStyle = shade(style.color, .76); ctx.fill(path(avatar.face, rx, ry)); }
  if (style.markings === "cheeks") {
    ctx.fillStyle = "rgba(207,104,135,.35)";
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * rx * .42, ry * .27, rx * .11, ry * .055, -.1 * side, 0, Math.PI * 2); ctx.fill(); }
  } else if (style.markings === "freckles") {
    ctx.fillStyle = shade(style.accent, -.1);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(side * rx * (.3 + i * .075), ry * (.28 - (i % 2) * .07), rx * .019, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore(); ctx.restore();
  ctx.save(); attachToHead(ctx, rx, ry, pose);
  drawAccessory(ctx, rx, ry, appearance);
  ctx.restore();
  if(headphones)drawMusicHeadphones(ctx,rx,ry,appearance,pose);
  return body;
}
export function projectHead(x:number,y:number,z:number,pose:{yaw:number;pitch:number}) {
  const cy=Math.cos(pose.yaw),sy=Math.sin(pose.yaw),cp=Math.cos(pose.pitch),sp=Math.sin(pose.pitch);
  const xx=x*cy+z*sy, zz=z*cy-x*sy, yy=y*cp-zz*sp, depth=y*sp+zz*cp;
  const scale=4/(4-depth);
  return {x:xx*scale,y:yy*scale,scale,depth};
}
function attachToHead(ctx:CanvasRenderingContext2D,rx:number,ry:number,pose:{yaw:number;pitch:number}) {
  // Tangent plane follows the same spherical yaw/pitch as the eyes; outer tilt
  // is inherited from the engine's canvas transform.
  const a=projectHead(0,0,.45,pose),b=projectHead(1,0,.45,pose),c=projectHead(0,1,.45,pose);
  ctx.transform(b.x-a.x,(b.y-a.y)*ry/rx,(c.x-a.x)*rx/ry,c.y-a.y,a.x*rx,a.y*ry);
}
function drawMusicHeadphones(ctx:CanvasRenderingContext2D,rx:number,ry:number,{style}:Appearance,pose:{yaw:number;pitch:number},back=false) {
  ctx.save();ctx.lineCap='round';
  if(!back){
    ctx.beginPath();
    for(let i=0;i<=40;i++){const a=Math.PI+i*Math.PI/40,p=projectHead(Math.cos(a)*.84,Math.sin(a)*.88-.06,.12,pose);if(i===0)ctx.moveTo(p.x*rx,p.y*ry);else ctx.lineTo(p.x*rx,p.y*ry);}
    ctx.strokeStyle=shade(style.accent,-.55);ctx.lineWidth=rx*.14;ctx.stroke();
    ctx.strokeStyle=shade(style.accent,.28);ctx.lineWidth=rx*.055;ctx.stroke();
  }
  for(const side of [-1,1]){
    const p=projectHead(side*.84,0,.04,pose);
    if((p.depth<-.12)!==back)continue;
    ctx.save();ctx.translate(p.x*rx,p.y*ry);ctx.rotate(-side*Math.sin(pose.pitch)*.2);
    ctx.scale(p.scale*Math.max(.5,Math.cos(pose.yaw)),p.scale);
    const x=0;
    ctx.fillStyle=shade(style.accent,-.62);ctx.beginPath();ctx.roundRect(x-rx*.15,-ry*.29,rx*.3,ry*.58,rx*.11);ctx.fill();
    const gradient=ctx.createLinearGradient(x-rx*.1,-ry*.25,x+rx*.1,ry*.25);
    gradient.addColorStop(0,shade(style.accent,.35));gradient.addColorStop(1,shade(style.accent,-.16));
    ctx.fillStyle=gradient;ctx.beginPath();ctx.roundRect(x-rx*.1,-ry*.24,rx*.2,ry*.48,rx*.07);ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
function drawAccessory(ctx: CanvasRenderingContext2D, rx: number, ry: number, { style }: Appearance) {
  ctx.save();
  for (const detail of style.accessory === "none" ? [] : accessories[style.accessory]) {
    const p = path(detail.path, rx, ry);
    ctx.fillStyle = detail.tone === "light" ? shade(style.accent, .4) : style.accent;
    if (detail.tone === "line") { ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = ry * .015; ctx.stroke(p); }
    else ctx.fill(p);
  }
  ctx.restore();
}

/** Static portrait used by settings, native window icons and installer assets. */
export function drawPortrait(ctx: CanvasRenderingContext2D, size: number, appearance = getAppearance(), blink = 1, headphones = musicAppearance().headphones) {
  ctx.clearRect(0, 0, size, size); ctx.save(); ctx.translate(size / 2, size / 2);
  const rx = size * .43, ry = size * .4;
  const body = drawCompanionBody(ctx, rx, ry, appearance, {yaw:0,pitch:0}, headphones);
  ctx.save(); ctx.clip(body); ctx.fillStyle = companionInk(appearance);
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * rx * .31, ry * .04, rx * .058, ry * .13 * Math.max(.1, blink), 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = companionInk(appearance); ctx.lineWidth = size * .012; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(0, ry * .19, rx * .068, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
  ctx.restore(); ctx.restore();
}
