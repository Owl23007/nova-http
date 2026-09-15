import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import DocLinks from "./components/DocLinks.vue";
import HomeCommand from "./components/HomeCommand.vue";
import LayerDiagram from "./components/LayerDiagram.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DocLinks", DocLinks);
    app.component("HomeCommand", HomeCommand);
    app.component("LayerDiagram", LayerDiagram);
  },
} satisfies Theme;
