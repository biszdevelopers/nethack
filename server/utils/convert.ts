import type { ResolvedAward } from "./database/awards";

function parseProfileTheme(input?: string): ProfileTheme {
    const str = input ?? "";
    const sepIndex = str.indexOf("|");
    const rawMode = sepIndex === -1 ? str : str.slice(0, sepIndex);
    const rawValue = sepIndex === -1 ? "" : str.slice(sepIndex + 1);

    const allowedModes: ProfileTheme["mode"][] = ["url", "emoji", "gradient"];

    const mode: ProfileTheme["mode"] = allowedModes.includes(rawMode as any)
        ? (rawMode as ProfileTheme["mode"])
        : "emoji"; // default fallback

    return { mode, value: rawValue };
}

export function convertUserToPublic(
    user: User,
    options: { includeEmail?: boolean; includeTeam?: boolean } = {},
): APIUser {
    return {
        id: user.id,
        ...(options.includeEmail === false ? {} : { email: user.email }),
        name: user.name,
        ...(options.includeTeam === false ? {} : { team_id: user.team_id }),
        profile_theme: parseProfileTheme(user.profile_theme ?? undefined),
        profile_picture: user.profile_picture,
    };
}

export function convertTeamToPublic(
    team: Team,
    options: { withScore?: boolean; withRank?: boolean } | boolean = {},
    awards: ResolvedAward[] = [],
): APITeam {
    const { withScore = false, withRank = true } =
        typeof options === "boolean" ? { withScore: options } : options;

    return {
        id: team.id,
        name: team.name,
        pathway: team.pathway,
        rank: withRank ? team.rank : null,
        score: withScore ? team.score : null,
        season_id: team.season_id,
        project: {
            name: team.project_name,
            description: team.project_description,
            demo_url: team.project_demo_url,
            repo_url: team.project_repo_url,
            submitted: team.project_submitted ? true : false,
            sourcing: team.sourcing,
        },
        awards: awards.map(({ team_id, text, ...award }) => ({
            ...award,
            text: Array.isArray(text) ? text.join(", ") : text,
        })),
    };
}
