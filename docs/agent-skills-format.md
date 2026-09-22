# Skills are Agent Skills

DoubleOh's compiled skills are stored and served in the Agent Skills format, the open `SKILL.md` shape
that Claude, Cursor, Copilot and the growing list of tools that read it already understand. This was
true before it was a strategy: the compiler was written against "the spec's own SKILL.md shape" so a
customer's library could leave with them.

What that means in practice:

- A skill is a name, a one-sentence description that says when to reach for it, and Markdown
  instructions: numbered steps ending in a "Done when" line. That is the Agent Skills body.
- Metadata rides in frontmatter-equivalent fields: `tags` (owner, host, `learned`), `permissions`,
  and the `authority` boundary (`requiresHuman`, `never`). Tools that do not know the extra fields
  ignore them; tools that do, respect them.
- Export is a directory of `SKILL.md` files per customer, from the portal or the API, and import
  accepts the same. A library built here ports into any Agent Skills reader, and a library built
  elsewhere ports in.

If Agent Skills lands as a first-class MCP primitive, the value was never the format: it is the
recording, the compilation with refusals, the boundary, and the record of who intervened. The format
being open is what lets customers trust that.
