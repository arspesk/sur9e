---
exec: interactive
needs_tools: [file_read, file_write]
---

# Mode: tracker -- Application Tracker

Reads and displays `data/applications.md`.

**Tracker format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```

Possible statuses: `Screened` -- `Evaluated` -- `Applied` -- `Responded` -- `Contact` -- `Interview` -- `Offer` / `Rejected` / `Discarded`

- `Applied` = the candidate submitted their application
- `Responded` = a recruiter/company reached out and the candidate replied (inbound)
- `Contact` = the candidate proactively contacted someone at the company (outbound, e.g., LinkedIn power move)

If the user asks to update a status, edit the corresponding row.

Also display statistics:

- Total applications
- By status
- Average score
- % with PDF generated
- % with report generated
