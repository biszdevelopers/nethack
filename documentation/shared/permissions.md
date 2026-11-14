# Nethack JWT Permissions

basishacks authorizes protected actions from the verified basis-auth access-token `permissions` array. OAuth is used only to obtain the resource token: login requests `openid profile email offline_access nethack.access`; feature permissions are never requested as OAuth scopes.

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

During migration, `expandLegacyNethackPermissions()` provides a compatibility bridge for existing basis-auth accounts. A legacy `participant` grant receives the self-service profile, team, project, voting, and chatbot leaves; `judge` receives those leaves plus assignment, assigned-score, and result-reading access; and `admin` receives `nethack.all`. Existing granular and unrelated application permissions are preserved. The expansion is applied both during server authorization and when returning display permissions to the frontend.

The browser receives the current permission list from `/api/auth/session` only to hide unavailable UI. Every protected API independently verifies the JWT and enforces its permission server-side.
