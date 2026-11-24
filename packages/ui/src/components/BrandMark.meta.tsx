import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { BrandMarkProps } from "./BrandMark.tsx";

const tokenClasses = /^(?:size-\d+|shrink-0|dark|fill-(?:primary|primary-foreground|background|foreground)|stroke-primary-foreground)$/;

const onlyTokens = (svg: SVGSVGElement) => {
  const classes = [svg, ...svg.querySelectorAll("*")].flatMap((node) => (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
  const foreign = classes.filter((name) => !tokenClasses.test(name));
  if (foreign.length) throw new Error(`The mark uses classes that are not tokens: ${foreign.join(" ")}.`);
};

const tileOf = (canvasElement: HTMLElement) => {
  const svg = canvasElement.querySelector("svg");
  if (!svg) throw new Error("The mark is not drawn.");
  onlyTokens(svg);
  const tile = svg.firstElementChild;
  if (tile?.tagName !== "rect" || tile.getAttribute("width") !== "64") throw new Error("The mark has no tile under it.");
  return tile.getAttribute("class");
};

export const meta: ComponentMeta<BrandMarkProps> = {
  args: { logo: "GraphMark", className: "size-16" },
  examples: {
    Named: { logo: "HeartMark", "aria-label": "slop.date" },
    Necktie: { logo: "NecktieMark" },
    TwoCircles: { logo: "TwoCirclesMark" },
    TwoCirclesDark: { logo: "TwoCirclesMark", className: "size-16 dark" },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(tileOf(canvasElement)).toBe("fill-primary");
      await expect(canvasElement.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    },
    Named: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("img", { name: "slop.date" })).toBeTruthy();
      await expect(tileOf(canvasElement)).toBe("fill-primary");
    },
    Necktie: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(tileOf(canvasElement)).toBe("fill-primary");
    },
    TwoCircles: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(tileOf(canvasElement)).toBe("fill-background");
      await expect(canvasElement.querySelector(".fill-current")).toBeNull();
    },
    TwoCirclesDark: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(tileOf(canvasElement)).toBe("fill-background");
      const svg = canvasElement.querySelector("svg")!;
      const tile = svg.children.item(0);
      const right = svg.children.item(2);
      await expect(tile).not.toBeNull();
      await expect(right).not.toBeNull();
      if (/HappyDOM/.test(navigator.userAgent)) return;
      await expect(getComputedStyle(right as Element).fill).not.toBe(getComputedStyle(tile as Element).fill);
    },
  },
};
