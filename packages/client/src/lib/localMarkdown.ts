import { katex as markdownItKatex } from "@mdit/plugin-katex";
import MarkdownIt from "markdown-it";

// Server augments remain the preferred renderer. This keeps replies readable
// when an older session or an interrupted stream has no HTML augment yet.
const renderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

renderer.use(markdownItKatex, {
  delimiters: "all",
  mathFence: false,
  output: "html",
  throwOnError: false,
  trust: false,
});

export function renderLocalMarkdown(source: string): string {
  return renderer.render(source);
}
