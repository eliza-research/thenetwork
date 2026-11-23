import "@thenetwork/design-system/fonts.css";
import "@thenetwork/design-system/theme.css";

interface Globals {
  theme: string;
  brand: string;
}

/** The toolbar's switches set what the tokens hang on: the theme class and the `data-brand` attribute of the root element. */
export default {
  globalTypes: {
    theme: { toolbar: { icon: "contrast", items: ["light", "dark"], dynamicTitle: true } },
    brand: { toolbar: { icon: "paintbrush", items: ["network", "slop", "friends", "peon"], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light", brand: "network" },
  decorators: [
    (Story: () => unknown, context: { globals: Globals }) => {
      document.documentElement.className = context.globals.theme;
      document.documentElement.dataset.brand = context.globals.brand;
      return Story();
    },
  ],
};
