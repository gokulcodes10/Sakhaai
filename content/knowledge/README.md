---
title: How this folder works
visibility: internal
---

# The knowledge folder

Every markdown file in this directory is chunked and indexed into Sakha's
knowledge base. Drop a file in, and she can answer questions from it within
fifteen minutes — no deploy, no database work.

## Frontmatter

```
---
title: What a pilot actually involves
tags: [pricing, process]
visibility: public
url: /pricing
---
```

| Key | Meaning |
|---|---|
| `title` | What Sakha cites the document as. Defaults to the first `#` heading. |
| `tags` | Free-form labels, for filtering in the CMS. |
| `visibility` | `public` (anyone), `client` (signed-in clients), `internal` (staff only). Defaults to `public`. |
| `url` | Where Sakha should link when she cites this. Optional. |

## What belongs here

Things that are true, that people ask about, and that do not belong on a public
page: detailed scoping notes, integration specifics, the long version of an
answer whose short version is on the site.

## What does not

Anything confidential. `visibility: internal` keeps a document away from the
public, but treat this folder as company-readable, not secret. Credentials,
client contracts and personal data do not go here.
