/** Display names only. Never rewrite user content or stable storage/protocol IDs. */
export function assistantName(value?: string): string {
  return (value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40) || "Baymax";
}

export function assistantText(template: string, value?: string): string {
  return template.replaceAll("{assistant}", assistantName(value));
}
