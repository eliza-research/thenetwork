import "@thenetwork/design-system/fonts.css";
import "@thenetwork/design-system/theme.css";
import * as a11y from "@storybook/addon-a11y/preview";
import { brandIds } from "@thenetwork/design-system/brands";

declare const __STORY_MATRIX__: boolean | undefined;

interface Globals {
  theme: string;
  brand: string;
}

const themes = ["light", "dark"] as const;

interface Violation {
  help: string;
}

interface Report {
  type: string;
  version?: number;
  status: string;
  result: { violations?: Violation[]; error?: unknown };
}

interface Context {
  globals: Globals;
  parameters: { a11y?: { options?: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>;
  reporting: { addReport(report: Report): void };
}

const runA11y = a11y.afterEach as unknown as (context: Context) => Promise<void>;

const tagged = (report: Report, label: string): Report =>
  report.result.violations ? { ...report, result: { ...report.result, violations: report.result.violations.map((v) => ({ ...v, help: `${v.help} (${label})` })) } } : report;

const contrastInEveryBrand = async (context: Context) => {
  if (typeof __STORY_MATRIX__ === "undefined" || !__STORY_MATRIX__) return;
  const root = document.documentElement;
  const kept = { className: root.className, brand: root.dataset.brand };
  const still = document.createElement("style");
  still.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.append(still);
  try {
    for (const brand of brandIds)
      for (const theme of themes) {
        if (brand === context.globals.brand && theme === context.globals.theme) continue;
        root.className = theme;
        root.dataset.brand = brand;
        const reports: Report[] = [];
        const options = { ...context.parameters.a11y?.options, runOnly: ["color-contrast"] };
        await runA11y({ ...context, reporting: { addReport: (report) => reports.push(report) }, parameters: { ...context.parameters, a11y: { ...context.parameters.a11y, options } } });
        for (const report of reports) context.reporting.addReport(tagged(report, `${brand} ${theme}`));
      }
  } finally {
    root.className = kept.className;
    if (kept.brand === undefined) delete root.dataset.brand;
    else root.dataset.brand = kept.brand;
    still.remove();
  }
};

/** The toolbar's switches set what the tokens hang on: the theme class and the `data-brand` attribute of the root element. */
export default {
  globalTypes: {
    theme: { toolbar: { icon: "contrast", items: [...themes], dynamicTitle: true } },
    brand: { toolbar: { icon: "paintbrush", items: [...brandIds], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light", brand: "network" },
  decorators: [
    (Story: () => unknown, context: { globals: Globals }) => {
      document.documentElement.className = context.globals.theme;
      document.documentElement.dataset.brand = context.globals.brand;
      return Story();
    },
  ],
  afterEach: contrastInEveryBrand,
};
