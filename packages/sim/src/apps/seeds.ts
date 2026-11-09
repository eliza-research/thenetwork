/** One numeric seed or an ascending range in unit steps. A sign or exponent minus is not a separator. */
export function parseSeedRange(value: string | undefined): number[] {
  const text = value?.trim() ?? "";
  if (text) {
    const single = Number(text);
    if (Number.isFinite(single)) return [single];
    for (let i = 1; i < text.length; i++) {
      if (text[i] !== "-") continue;
      const left = text.slice(0, i).trim(), right = text.slice(i + 1).trim();
      if (!left || !right) continue;
      const from = Number(left), to = Number(right);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      const length = Math.floor(to - from + 1);
      // Array.from used this same unit-step expansion; reject empty or unrepresentable ranges first.
      if (to < from || !Number.isSafeInteger(length) || length < 1 || length > 0xffff_ffff) break;
      return Array.from({ length }, (_, n) => from + n);
    }
  }
  throw new Error(`invalid --seeds ${JSON.stringify(value ?? "")}; expected a finite seed or an ascending start-end range`);
}
