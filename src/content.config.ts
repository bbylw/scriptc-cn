import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    group: z.enum(["开始使用", "指南", "参考"]),
    order: z.number(),
    source: z.string().url(),
  }),
});

export const collections = { docs };
