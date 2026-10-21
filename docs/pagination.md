# Pagination Guide

This guide covers basic pagination mechanics in StellarKit API. For enterprise and high-volume data pipeline patterns, see the [Advanced Pagination Patterns Guide](pagination-patterns.md).

---

## Overview

All endpoints in StellarKit API that return lists of records (such as accounts, transactions, payments, operations, and offers) support pagination via query parameters.

### Query Parameters

| Parameter | Type | Default | Maximum | Description |
| :--- | :---: | :---: | :---: | :--- |
| \limit\ | Integer | \20\ | \200\ | Number of records to return per page. |
| \order\ | String | \"desc"\ | — | Sort order: \"desc"\ (newest first) or \"asc"\ (oldest first). |
| \cursor\ | String | \undefined\ | — | Opaque Horizon paging token indicating starting record position. |
| \page\ | Integer | \1\ | — | Convenience 1-based page number (cursor takes precedence). |

---

## Cursor vs Page Pagination

1. **Cursor Pagination (Recommended)**:
   - Uses opaque tokens from previous responses.
   - Stable against concurrent writes or newly closed ledgers.
   - Example: \GET /account/:id/payments?limit=20&order=desc&cursor=137424838656-1\

2. **Page Pagination (Convenience)**:
   - Suitable for simple administrative screens.
   - Translates page numbers to underlying cursors via \esolveCursorForPage\.
   - Example: \GET /account/:id/payments?page=2&limit=20\

---

## Response Envelope

Paginated responses provide pagination metadata under the \meta\ object:

\\\json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "total": 20,
    "limit": 20,
    "order": "desc",
    "nextCursor": "137424838656-1",
    "hasMore": true
  }
}
\\\

---

## Next Steps

- For streaming large datasets, cursor resumption across worker crashes, parallel pagination, and a complete Node.js streaming implementation, read the [Advanced Pagination Patterns Guide](pagination-patterns.md).
- For general API design conventions, see the [API Design Guidelines](api-design.md).
