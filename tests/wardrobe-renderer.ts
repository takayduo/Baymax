import { AVATARS, getAppearance, setCompanionPreferences, normalizePreferences, companionInk } from '../src/companion/appearance';
import { drawPortrait, drawCompanionBody } from '../src/companion/render';
import { BotEngine, BOT_STATES } from '../src/mochi/engine';
import { Greeting } from '../src/mochi/greeting';
import { UploadCanvas } from '../src/upload/canvas';
import { UploadSeq } from '../src/upload/sequence';
import { companionMouth } from '../src/companion/geometry';
import { Sound } from '../src/core/sound';
import { verifyHoldToTalk } from './voice-renderer';
Sound.setEnabled(false);
let time = 10000;
Object.defineProperty(performance, 'now', { value: () => time });
let timerId = 0;
const timers = new Map<number, { at: number; run: () => void }>();
(window as any).setTimeout = (run: () => void, delay = 0) => { const id = ++timerId; timers.set(id, { at: time + delay, run }); return id; };
window.clearTimeout = id => { timers.delete(id); };
function advance(ms: number) {
  time += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.run(); }
}
function canvas(w = 160, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function verify(c: HTMLCanvasElement) {
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let pixels = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) pixels++;
  if (pixels < 12) throw new Error('Empty avatar rendering');
  return pixels;
}
(window as any).wardrobeTest = {
  async run() {
    const voice = await verifyHoldToTalk();
    setCompanionPreferences(null);
    const movement = new BotEngine();
    const dizzy=new BotEngine();dizzy.eyeOverride='line';dizzy.eyeOverrideUntil=Infinity;dizzy.setState('dizzy');
    const shapes:string[]=[];
    const drawEye=(dizzy as any).drawEyeShape.bind(dizzy);
    (dizzy as any).drawEyeShape=(ctx:any,shape:string,...rest:any[])=>{shapes.push(shape);drawEye(ctx,shape,...rest);};
    const spirals=canvas(),spiralCtx=spirals.getContext('2d')!;
    dizzy.draw(spiralCtx,160,160);const firstSpiral=spirals.toDataURL();advance(180);dizzy.draw(spiralCtx,160,160);
    if(firstSpiral===spirals.toDataURL())throw new Error('Dizzy spirals do not spin');
    for(let i=0;i<190;i++){advance(16);dizzy.update(.016);dizzy.draw(spiralCtx,160,160);}
    if(!shapes.length || shapes.some(s=>s!=='spiral'))throw new Error('Dizzy eyes were masked by an expression override');
    dizzy.setState('idle');shapes.length=0;dizzy.draw(spiralCtx,160,160);
    if(shapes.some(s=>s==='spiral'))throw new Error('Normal eyes did not restore after dizzy');
    function centre() {
      const frame = canvas(); movement.draw(frame.getContext('2d')!, 160, 160);
      const pixels = frame.getContext('2d')!.getImageData(0, 0, 160, 160).data;
      let weight = 0, x = 0, y = 0;
      for (let i = 3; i < pixels.length; i += 4) { const a = pixels[i]; weight += a; x += ((i >> 2) % 160) * a; y += Math.floor((i >> 2) / 160) * a; }
      return { x: x / weight, y: y / weight };
    }
    const start = centre(); movement.yaw = .5; movement.pitch = .35; const tracked = centre();
    if (tracked.x - start.x < 4 || start.y - tracked.y < 1) throw new Error('The whole silhouette does not follow the cursor');
    for (let i = 0; i < 40; i++) { advance(16); movement.update(.016); }
    const motion = [movement.sx, movement.sy, movement.oy];
    for (let i = 0; i < 60; i++) { advance(16); movement.update(.016); }
    if (!BOT_STATES.idle.breathes || Math.abs(motion[2] - movement.oy) < .001 || Math.abs(motion[1] - movement.sy) < .001) throw new Error('Idle breathing or hover stopped');
    const shading = canvas(); const ctx = shading.getContext('2d')!; ctx.translate(80, 80);
    drawCompanionBody(ctx, 55, 44); const front = shading.toDataURL();
    ctx.clearRect(-80, -80, 160, 160); drawCompanionBody(ctx, 55, 44, getAppearance(), {yaw:.5,pitch:.4});
    if (front === shading.toDataURL()) throw new Error('Lighting does not respond to pose');
    setCompanionPreferences({ avatarId: 'puff', styles: { puff: {color:'#000000',accessory:'scarf',markings:'plain'} } });
    if (companionInk() !== '#F7F3FF') throw new Error('Dark minimal bodies lose their expressions');
    const images: string[] = [], stateChecks: string[] = [], greetingImages: string[] = [], uploadImages: string[] = [];
    const gallery = document.getElementById('gallery')!;
    for (const avatar of AVATARS) {
      setCompanionPreferences({ avatarId: avatar.id });
      const c = canvas(192); drawPortrait(c.getContext('2d')!, 192); verify(c);
      images.push(c.toDataURL());
      const card = document.createElement('article'); const name = document.createElement('strong'); name.textContent = avatar.name;
      const kind = document.createElement('span'); kind.textContent = avatar.kind;
      card.append(c, name, kind); gallery.append(card);
      for (const state of Object.keys(BOT_STATES)) {
        const bot = new BotEngine(); bot.setState(state as any, true);
        for (let i = 0; i < 50; i++) { advance(16); bot.update(.016); }
        const frame = canvas(); bot.draw(frame.getContext('2d')!, 160, 160); verify(frame);
        stateChecks.push(`${avatar.id}:${state}`);
        if (state === 'thinking') {
          if (bot.badge?.kind !== 'dots' || bot.badgeS < .9) throw new Error('Thinking dots never appeared');
          const ctx = frame.getContext('2d')!;
          ctx.clearRect(0, 0, 160, 160); (bot as any).drawBadge(ctx, bot.badge, 48, 80, 80);
          const first = frame.toDataURL(); advance(160); ctx.clearRect(0, 0, 160, 160); (bot as any).drawBadge(ctx, bot.badge, 48, 80, 80);
          if (first === frame.toDataURL()) throw new Error('Thinking badge is not animated');
        }
      }
      const mini = new BotEngine(); mini.isMini = true;
      const small = canvas(32); mini.draw(small.getContext('2d')!, 32, 32); verify(small);
      const greeting = new Greeting(); greeting.start(); advance(1900);
      const gc = canvas(640, 150); greeting.draw(gc.getContext('2d')!); verify(gc); greetingImages.push(gc.toDataURL());
      const uc = new UploadCanvas({ openDrive() {}, done() {} });
      UploadSeq.enterZone(140, 65); advance(350); UploadSeq.frame(); UploadSeq.performDrop(2.4);
      for (const offset of [100, 70, 80, 150, 180, 220]) {
        advance(offset); const f = UploadSeq.frame(); uc.draw(f, time / 1000);
        const picture = uc.el.querySelector('canvas')!; verify(picture);
        const m = companionMouth(f.d / 2 / 1.04, f.morph, f.mouth);
        if (Math.abs(f.mouthRect.y - (f.y + f.hop + m.y * f.sy)) > .001) throw new Error('Mouth and file clipping diverged');
        if (offset === 80) uploadImages.push(picture.toDataURL());
      }
    }
    if (new Set(images).size !== AVATARS.length || new Set(greetingImages).size !== AVATARS.length || new Set(uploadImages).size !== AVATARS.length) throw new Error('Avatar selection did not reach every renderer');
    const defaults = normalizePreferences(null);
    const malformed = normalizePreferences({ avatarId: '__proto__', styles: { sprout: { color: 'url(https://invalid)', accessory: 'unknown' }, unknown: {} } });
    if (malformed.avatarId !== defaults.avatarId || Object.keys(malformed.styles).length !== 1 || malformed.styles.sprout.color !== AVATARS.find(a => a.id === 'sprout')!.color) throw new Error('Invalid preference fallback');
    const samples = document.getElementById('samples')!;
    setCompanionPreferences({ avatarId: 'nori', styles: { nori: { color: '#F0A6CA', accent: '#765593', accessory: 'bow', markings: 'freckles' } } });
    for (const state of ['idle', 'thinking', 'sleeping', 'finished']) {
      const bot = new BotEngine(); bot.setState(state as any, true);
      for (let i = 0; i < 90; i++) { advance(16); bot.update(.016); }
      const c = canvas(110); bot.draw(c.getContext('2d')!, 110, 110);
      const item = document.createElement('article'); const label = document.createElement('span'); label.textContent = state; item.append(c, label); samples.append(item);
    }
    return { avatars: images.length, states: stateChecks.length, minis: AVATARS.length, greetings: greetingImages.length, uploadFrames: AVATARS.length * 6, voice, uploadImages, greetingImages };
  },
  icons() {
    setCompanionPreferences(null);
    return [32, 128, 256, 512].map(size => { const c = canvas(size); drawPortrait(c.getContext('2d')!, size); return { size, png: c.toDataURL() }; });
  },
};
