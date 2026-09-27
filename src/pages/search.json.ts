import { getCollection, render } from "astro:content";
import type { APIRoute } from "astro";
import { DOC_GROUPS, docPath } from "../consts";

function stripCode(body: string): string {
  return body.replace(/^```[\s\S]*?^```/gm, "");
}

function toPlainText(body: string): string {
  return stripCode(body)
    .replace(/^---[\s\S]*?\n---\n/, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const prerender = true;

export const GET: APIRoute = async () => {
  const docs = await getCollection("docs");
  const payload = await Promise.all(
    docs
      .slice()
      .sort(
        (a, b) =>
          DOC_GROUPS.indexOf(a.data.group) - DOC_GROUPS.indexOf(b.data.group) ||
          a.data.order - b.data.order,
      )
      .map(async (entry) => {
        const { headings } = await render(entry);
        return {
          path: docPath(entry.id),
          title: entry.data.title,
          group: entry.data.group,
          description: entry.data.description,
          headings: headings
            .filter((h) => h.depth <= 3)
            .map((h) => ({ text: h.text, slug: h.slug })),
          // `entry.body` is the markdown source, so drop the frontmatter block
          // before flattening. Reading the file off disk is not an option here:
          // this module is bundled into the build output, so `import.meta.url`
          // no longer points at `src/`.
          body: toPlainText((entry.body ?? "").replace(/^---[\s\S]*?\n---\n/, "")).slice(0, 4000),
        };
      }),
  );

  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
