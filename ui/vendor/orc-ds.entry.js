// esbuild entry — bundled to ui/vendor/orc-ds.min.js via `pnpm run build:ui-vendor`.
// Registers the Orc design-system custom elements so orc-ui can use <orc-*> tags.
import { defineOrcElements } from "@orc-tools/orc-design-system/define";
import { OrcStyledThemeToggle } from "./orc-theme-toggle.js";

if (typeof customElements !== "undefined" && !customElements.get("orc-theme-toggle")) {
  customElements.define("orc-theme-toggle", OrcStyledThemeToggle);
}
defineOrcElements();

// <orc-theme-toggle> drives whichever controller is registered on the document,
// so the shell has to create one — and it can only reach the constructor
// through this bundle.
export { createThemeController } from "@orc-tools/orc-design-system/controller";
