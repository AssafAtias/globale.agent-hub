# Workflow: Jira Ticket → GitLab Merge Request

A recipe for taking one open Jira ticket and turning it into a draft GitLab merge request,
with the implementation and tests done — but with the user approving every risky step.

## When to use this
The user gives you a single Jira ticket (or asks you to pick one from their open CORE items)
and wants you to do the work and open a draft MR for it.

## Golden rules (do not break these)
- **One ticket at a time.** Never batch-process the whole board.
- **Only `Open` tickets are eligible.** If the ticket's Jira status is anything other than
  `Open` (e.g. `In Progress`, `In Code Review`, `Done`), STOP. Do not implement, do not open
  an MR. This prevents re-running on work that is already in flight or finished.
- **Stop at every ⛔ gate** and wait for the user before continuing.
- **Only code tickets get an MR.** Config, test-writing, and design tickets stop at the
  classify step with an explanation — no MR.
- **The MR is always a draft.** Never mark it ready, never force-push, never push straight
  to a protected branch (e.g. main/master/develop). Always state in the progress log that the
  MR is a **draft** so the run history makes the draft status explicit.
- **Secrets come from environment variables only.** Never read a token from a file, never
  write one to a file, never print it.

## Preconditions (check before doing anything)
1. A GitLab access token is available in the `GITLAB_TOKEN` environment variable.
   - If it is missing, STOP. Tell the user to set it (PowerShell:
     `$env:GITLAB_TOKEN = "..."` for this session) and that you'll continue once it's set.
2. You can reach the Jira ticket.

---

## The steps

### 1. Fetch the ticket
- Read the ticket: title, full description, all comments, acceptance criteria, labels,
  components, and any linked development info or attachments.
- Read the ticket's **Jira status**.
- ⛔ **GATE — status must be `Open`.** If the status is anything other than `Open`, STOP here.
  Report the actual status to the user, explain that only `Open` tickets are eligible, and do
  nothing else (no branch, no implementation, no MR). Do not "re-run" or "continue" an
  in-flight or completed ticket.
- Summarise it back to the user in a few bullets so they can confirm you understood it.

### 2. Classify the ticket
Decide which kind of work it is:
- **code** — a change to a codebase (bug fix, new feature, analytics event, etc.)
- **config** — A/B test setup, feature-flag or merchant configuration (no code change)
- **test** — writing/updating automation tests
- **design** — UX/copy/visual design work
- **unclear** — not enough information to tell

⛔ **GATE.** State the classification and your reasoning.
- If it is **not `code`**, stop here. Explain why there's no MR and, if useful, outline what
  the ticket actually needs. Do not continue.
- If **`unclear`**, ask the user to clarify before going on.

### 3. Clarify open questions
- List anything ambiguous: unclear scope, missing acceptance criteria, edge cases.
- Ask the user these questions (plainly, no jargon) and wait for answers.
- If the ticket is fully clear, say so and move on.

### 4. Confirm the target
- Propose the GitLab repository and the base branch to branch from, based on the ticket
  (component/labels/links) and what you know of the user's repos.
- ⛔ **GATE.** Ask the user to confirm the repo and base branch. Do not assume.

### 5. Implement
- Create a branch named `CORE-<number>-<short-slug>` from the confirmed base branch.
- Make the change. Follow the existing patterns and conventions in that repo.
- Add or update tests that cover the change.
- Build the project and run the relevant tests.
- ⛔ **GATE.** Show the user the diff summary and the build/test results.
  - If the build or tests fail, STOP. Report what failed. Do not open an MR.

### 6. Open the draft merge request
- ⛔ **GATE.** Only after the user approves the diff:
  - Push the branch.
  - Open a **draft** merge request via the GitLab API, using `GITLAB_TOKEN`.
  - Title it with the ticket key and summary; in the description, link the Jira ticket and
    briefly describe the change.
  - **Set assignees by name.** The user provides assignees by name (e.g. "Assaf Atias"),
    not by GitLab user ID. Resolve each name to its numeric ID yourself before calling the
    API — the API only accepts `assignee_ids[]`. To resolve a name:
    - Query `GET /users?search=<name>` (or `?username=<handle>` if a handle is given) on
      `https://gitlab.com/api/v4`, authenticated with `GITLAB_TOKEN`.
    - If exactly one user matches, use that `id`.
    - If **zero** matches, tell the user the name didn't resolve and ask for the exact
      GitLab username — never guess or assign someone else.
    - If **multiple** match, list the candidates (name + username + id) and ask the user
      which one. Do not pick one silently.
    - Confirm the final resolved list (name → id) back to the user before assigning.
- Give the user the MR link, and **explicitly state in the progress log that it is a draft
  merge request** (e.g. "Opened **draft** MR !NNN"). Confirm the draft flag is set via the
  GitLab API response (`draft: true` / `work_in_progress: true`) — if it comes back `false`,
  report that the draft flag did not stick instead of claiming success.
- Optionally (ask first): add a comment on the Jira ticket linking the MR.

---

## If something goes wrong
- Build/test failure → stop, report, no MR.
- Can't determine the repo → ask; don't guess.
- API call fails → report the error to the user; never retry blindly with different params.
- At any point you're unsure → stop and ask. A stopped workflow is always safe; a wrong MR is not.
