import { defineConfig } from "tsup";

export default defineConfig({
  format: ["cjs", "esm"],
  entry: ["./src/index.ts"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  shims: true,
  skipNodeModulesBundle: true,
  target: "esnext",
  /**
   * This below tsconfig is a workaround for the error: https://github.com/egoist/tsup/issues/571, also: https://github.com/Swatinem/rollup-plugin-dts/issues/127
   * It seems that rollup-plugin-dts, which is used by tsup to output .d.ts files, doesn't support composite if we directly use it to bundle .ts files.
    It could support composite if we bundle .d.ts with tsc first and then use rollup-plugin-dts to bundle these .d.ts files. But that means extra work on tsup side.
   */
  tsconfig: "./tsconfig.build.json",
});
