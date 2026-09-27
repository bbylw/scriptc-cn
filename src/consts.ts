export const SITE = {
  name: "scriptc",
  tagline: "把普通的 TypeScript 编译成小而快的原生可执行文件",
  repo: "https://github.com/vercel-labs/scriptc",
  upstream: "https://scriptc.dev",
  npm: "https://www.npmjs.com/package/scriptc",
};

export const DOC_GROUPS = ["开始使用", "指南", "参考"] as const;

export type DocGroup = (typeof DOC_GROUPS)[number];

export type DocNavItem = {
  slug: string;
  title: string;
  group: DocGroup;
  path: string;
};

/** `introduction` is served at the docs root, the rest get their own segment.
 *  The site builds with `format: "file"`, so paths carry no trailing slash. */
export function docPath(slug: string): string {
  return slug === "introduction" ? "/docs" : `/docs/${slug}`;
}
