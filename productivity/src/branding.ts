let name = 'Baymax';
export const assistantName = () => name;
export function setAssistantName(value: unknown) {
  if (typeof value !== 'string') return;
  name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Baymax';
  document.title = `${name} · Productivity`;
}
