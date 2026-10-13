import { h } from "../views/dom";
import { AVATARS, defaultStyle, getAppearance, normalizePreferences, type AvatarStyle, type CompanionPreferences } from "../companion/appearance";
import { drawPortrait } from "../companion/render";

export function wardrobe(initial: unknown, persist: (value: CompanionPreferences) => Promise<boolean>): HTMLElement {
  let preferences = normalizePreferences(initial), busy = false;
  const section = h("section", { class: "wardrobe", "aria-label": "Companion wardrobe" });
  const status = h("p", { class: "wardrobe-status hint", role: "status", "aria-live": "polite" });
  const grid = h("div", { class: "wardrobe-grid" });
  const editor = h("div", { class: "wardrobe-editor", hidden: true });
  section.append(h("div", { class: "wardrobe-heading" }, h("h2", { text: "Wardrobe" }), h("span", { class: "wardrobe-count", text: `${AVATARS.length} companions` })),
    h("p", { class: "hint", text: "Pick a companion. Your choice follows you everywhere, with all the same animations." }), grid, status, editor);
  function portrait(id: string, style?: AvatarStyle, size = 68) {
    const canvas = h("canvas", { width: size * 2, height: size * 2, "data-avatar-preview": id, "aria-hidden": "true" }) as HTMLCanvasElement;
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d")!; ctx.scale(2, 2);
    drawPortrait(ctx, size, style ? { avatar: AVATARS.find(a => a.id === id)!, style } : getAppearance(id, preferences));
    return canvas;
  }
  async function commit(next: CompanionPreferences, message: string): Promise<boolean> {
    if (busy) return false;
    busy = true; section.setAttribute("aria-busy", "true");
    const controls = [...section.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")];
    controls.forEach(c => c.disabled = true); status.textContent = "Saving your companion…";
    try {
      if (!await persist(next)) { status.textContent = "Could not save. Your changes are still here—please try again."; return false; }
      preferences = normalizePreferences(next); status.textContent = message; drawCards(); return true;
    } catch {
      status.textContent = "Could not save. Your changes are still here—please try again."; return false;
    } finally {
      busy = false; section.removeAttribute("aria-busy"); controls.forEach(c => c.disabled = false);
    }
  }
  function drawCards() {
    grid.replaceChildren();
    for (const avatar of AVATARS) {
      const active = preferences.avatarId === avatar.id;
      const choose = h("button", { type: "button", class: "wardrobe-pick", "data-avatar-id": avatar.id,
        "aria-pressed": String(active), "aria-label": `Use ${avatar.name}, ${avatar.kind}` },
        portrait(avatar.id), h("strong", { text: avatar.name }), h("span", { class: "wardrobe-kind", text: avatar.kind }),
        h("span", { class: "wardrobe-selection", text: active ? "✓" : "", "aria-hidden": "true" }));
      choose.addEventListener("click", async () => {
        if (busy || preferences.avatarId === avatar.id) return;
        if (await commit({ ...preferences, avatarId: avatar.id }, `${avatar.name} is your companion.`)) editor.hidden = true;
      });
      const customize = h("button", { type: "button", class: "wardrobe-customize", "data-customize": avatar.id, text: "Customize", "aria-label": `Customize ${avatar.name}` });
      customize.addEventListener("click", () => { if (!busy) edit(avatar.id); });
      grid.append(h("div", { class: `wardrobe-card${active ? " selected" : ""}` }, choose, customize));
    }
  }
  function edit(id: string) {
    const avatar = AVATARS.find(a => a.id === id)!;
    let draft = { ...getAppearance(id, preferences).style };
    const preview = h("div", { class: "wardrobe-live-preview" });
    const controls = h("div", { class: "wardrobe-controls" });
    const update = () => preview.replaceChildren(portrait(id, draft, 124), h("strong", { text: avatar.name }), h("span", { class: "hint", text: "Preview" }));
    function drawControls() {
      controls.replaceChildren();
      for (const [key, label] of [["color", "Body colour"], ["accent", "Accent colour"]] as const) {
        const input = h("input", { type: "color", value: draft[key], "aria-label": label, "data-style": key }) as HTMLInputElement;
        const hex = h("span", { class: "wardrobe-hex", text: draft[key] });
        input.addEventListener("input", () => { draft[key] = input.value.toUpperCase(); hex.textContent = draft[key]; update(); });
        const swatches = h("div", { class: "wardrobe-swatches", "aria-label": `${label} presets` });
        for (const [name, colour] of [["Pink", "#F0A6CA"], ["Mint", "#A6D7BE"], ["Lavender", "#BAACE3"], ["Sky", "#99C4EB"], ["Peach", "#EFB38D"], ["Ink", "#424956"]]) {
          const button = h("button", { type: "button", style: `--swatch:${colour}`, "aria-label": `${label}: ${name}`, title: name });
          button.addEventListener("click", () => { draft[key] = colour; input.value = colour; hex.textContent = colour; update(); });
          swatches.append(button);
        }
        controls.append(h("div", { class: "wardrobe-colour" }, h("label", {}, h("span", { text: label }), input, hex), swatches));
      }
      for (const [key, label, options] of [
        ["accessory", "Accessory", [["none", "None"], ["scarf", "Little scarf"], ["bow", "Ribbon bow"], ["sparkle", "Star pins"]]],
        ["markings", "Face details", [["plain", "Plain"], ["cheeks", "Rosy cheeks"], ["freckles", "Freckles"]]],
      ] as const) {
        const select = h("select", { "aria-label": label, "data-style": key }) as HTMLSelectElement;
        for (const [value, text] of options) select.append(h("option", { value, text }));
        select.value = draft[key];
        select.addEventListener("change", () => { (draft as any)[key] = select.value; update(); });
        controls.append(h("label", { class: "wardrobe-select" }, h("span", { text: label }), select));
      }
    }
    const apply = h("button", { class: "primary", type: "button", text: "Save & use", "data-wardrobe-apply": id });
    apply.addEventListener("click", async () => {
      const next = { avatarId: id, styles: { ...preferences.styles, [id]: { ...draft } } };
      if (await commit(next, `${avatar.name} is ready. Colours and details saved.`)) {
        editor.hidden = true;
        grid.querySelector<HTMLButtonElement>(`[data-avatar-id="${id}"]`)?.focus();
      }
    });
    const reset = h("button", { type: "button", text: "Reset colours & details", onclick: () => { draft = defaultStyle(avatar); update(); drawControls(); } });
    const cancel = h("button", { type: "button", text: "Cancel", onclick: () => { editor.hidden = true; grid.querySelector<HTMLButtonElement>(`[data-customize="${id}"]`)?.focus(); } });
    editor.replaceChildren(h("h3", { text: `Make ${avatar.name} yours` }), h("div", { class: "wardrobe-edit-body" }, preview, controls),
      h("div", { class: "wardrobe-edit-actions" }, reset, cancel, apply));
    editor.hidden = false; update(); drawControls();
    editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
    controls.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }
  drawCards();
  return section;
}

export function musicHeadphonesToggle(enabled:boolean, persist:(enabled:boolean)=>Promise<boolean>) {
  const input=h('input',{type:'checkbox','aria-label':'Show headphones when playing music'}) as HTMLInputElement;
  input.checked=enabled;
  const status=h('span',{class:'hint',role:'status'});
  input.addEventListener('change',async()=>{
    input.disabled=true;
    try{if(!await persist(input.checked))throw new Error('save');status.textContent='';}
    catch{input.checked=!input.checked;status.textContent='Could not save. Please try again.';}
    finally{input.disabled=false;}
  });
  return h('div',{class:'wardrobe-music-toggle'},h('label',{},input,h('span',{text:'Show headphones when playing music'})),status);
}
