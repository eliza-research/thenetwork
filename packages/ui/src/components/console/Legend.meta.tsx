import type { ComponentMeta } from "../../lib/meta.ts";
import { LegendItem, type LegendProps } from "./Legend.tsx";

const noop = () => undefined;

export const meta: ComponentMeta<LegendProps> = {
  args: {
    open: true,
    children: (
      <>
        <LegendItem label="met" checked onCheckedChange={noop} tone="ok" count={31} />
        <LegendItem label="blocked" checked={false} onCheckedChange={noop} tone="destructive" count={2} />
        <LegendItem label="open opportunities" checked onCheckedChange={noop} tone="warn" dashedLine />
      </>
    ),
  },
  examples: { Closed: { open: false } },
};
