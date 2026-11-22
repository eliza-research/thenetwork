// The console bundler (esbuild) loads a stylesheet import, such as Leaflet's CSS in map.ts, as CSS.
// This tells the type checker that such an import exists; it exports nothing.
declare module "*.css";
