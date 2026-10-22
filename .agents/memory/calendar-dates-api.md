---
name: Calendar dates in generated APIs
description: Preserve timezone-free calendar dates through OpenAPI, generated Zod schemas, and JSON API responses.
---

Treat planning dates as calendar values, not instants. With this workspace's OpenAPI-to-Zod generation, annotating date-only fields with `format: date` can make generated schemas coerce strings into JavaScript `Date` objects. JSON responses then serialize as timestamps, which can break date inputs and shift calculations.

**Why:** The generated transformation turned valid plan dates into ISO timestamps and caused invalid date inputs and timeline calculations.

**How to apply:** For fields representing calendar days, keep the API contract and response values as `YYYY-MM-DD` strings end to end. Reserve timestamp formats for actual instants such as `updatedAt`.
