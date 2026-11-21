# Nethack JWT Permissions

nethack authorizes protected actions from the verified basis-auth access-token `permissions` array. OAuth is used only to obtain the resource token: login requests `openid profile email offline_access`; feature permissions are never requested as OAuth scopes.

`shared/permissions.ts` defines the canonical `NethackPermissions` values. Protected routes require the least-privilege leaf for their action, while ownership and event-state rules remain route-specific.

| Area | Permissions |
| --- | --- |
| Global administration | `nethack.all` |
| Profile | `nethack.Profile.updateSelf` |
| Teams and projects | `nethack.Teams.*`, `nethack.Projects.*` leaves |
| Voting and judging | `nethack.Voting.*`, `nethack.Judging.*` leaves |
| Event administration | `nethack.Seasons.*`, `nethack.Hackathon.*` leaves |
| Operations | `nethack.Users.*`, `nethack.Debug.*`, `nethack.Chatbot.use`, `nethack.Database.export` |

`nethack.all` is an explicit basis-auth assignment. The shared permission matcher recognizes its `.all` hierarchy and lets it satisfy any `nethack.*` requirement. There is no wildcard `.*` syntax.

Local administrator state adds `nethack.all` only when `users.is_admin` is true. A stored `is_admin = 0` is authoritative; the `INITIAL_ADMIN_EMAILS` allowlist only supplies a grant when the caller has no local admin state. Initial-admin addresses are also elevated at sign-in, so remove the address from the allowlist before demoting the account. Self-demotion and the demotion or deletion of the last administrator are rejected.

During migration, `expandLegacyNethackPermissions()` provides a compatibility bridge for existing basis-auth accounts. A legacy `participant` grant receives the self-service profile, team, project, voting, and chatbot leaves; `judge` receives those leaves plus assignment and assigned-score access (early result reading requires an explicit `nethack.Judging.resultsRead` grant), and `admin` receives `nethack.all`. Existing granular and unrelated application permissions are preserved. The expansion is applied both during server authorization and when returning display permissions to the frontend.

The browser receives the current permission list from `/api/auth/session` only to hide unavailable UI. Every protected API independently verifies the JWT and enforces its permission server-side.
