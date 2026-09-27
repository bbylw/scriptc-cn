import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// github-dark renders comments at ~3:1 on the panel background, which fails
// WCAG AA for small text. Lift only that token.
const COMMENT = "#6a737d";
const COMMENT_RAISED = "#9daab8";
const brightenComments = {
  name: "brighten-comments",
  span(node) {
    if (node.type !== "element" || node.tagName !== "span") return;
    const style = node.properties?.style;
    if (typeof style === "string" && style.toLowerCase().includes(COMMENT)) {
      node.properties.style = style.replace(/#6a737d/gi, COMMENT_RAISED);
    }
  },
};

export default defineConfig({
  output: "static",
  site: "https://scriptc.ndjp.net",
  build: { format: "file" },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    smartypants: false,
    shikiConfig: {
      theme: "github-dark",
      langs: ["ts", "js", "bash", "json", "c", "text"],
      wrap: false,
      transformers: [brightenComments],
    },
  },
});
