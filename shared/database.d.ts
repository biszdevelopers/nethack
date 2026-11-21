// Database types inferred from Drizzle ORM schema
// These replace the hand-written type definitions that were previously here.
// The canonical types now live in server/database/schema.ts — use Drizzle's
// type inference helpers (typeof, InferSelectModel, InferInsertModel) when
// you need typed row access.

import type { InferSelectModel } from "drizzle-orm";
import type * as schema from "../server/database/schema";
import type { ScoreCurvePreset } from "./score-curve";

// Drizzle's InferSelectModel gives `string` for text columns, but we need
// literal union types that match the SQL CHECK constraints to maintain
// backward compatibility.
type HackathonStatus = "not_started" | "in_progress" | "voting" | "finished" | "paused";
type TeamPathway = string;
type TeamStatus = "active" | "withdrawn" | "disqualified" | "no_show";

// Base types inferred from the Drizzle schema.
type HackathonBase = InferSelectModel<typeof schema.hackathon>;
type TeamBase = InferSelectModel<typeof schema.teams>;
type TeamScoresBase = InferSelectModel<typeof schema.teamScores>;
type TeamInviteBase = InferSelectModel<typeof schema.teamInvites>;
type UserBase = InferSelectModel<typeof schema.users>;
type BallotBase = InferSelectModel<typeof schema.ballots>;
type BallotScoreBase = InferSelectModel<typeof schema.ballotScores>;
type OAuth2ApplicationBase = InferSelectModel<typeof schema.oauth2Applications>;
type AwardBase = InferSelectModel<typeof schema.awards>;
type TeamAwardBase = InferSelectModel<typeof schema.teamAwards>;
type PeerVotingScoreBase = InferSelectModel<typeof schema.peerVotingScores>;
type SeasonBase = InferSelectModel<typeof schema.seasons>;
type AdminAuditEventBase = InferSelectModel<typeof schema.adminAuditEvents>;
type NotificationBase = InferSelectModel<typeof schema.notifications>;
type JudgeAssignmentBase = InferSelectModel<typeof schema.judgeAssignments>;
type JudgeRecusalBase = InferSelectModel<typeof schema.judgeRecusals>;
type JudgeFlagBase = InferSelectModel<typeof schema.judgeFlags>;

// Re-export with narrowed types for columns that have CHECK constraints
// (Drizzle infers `string` for text columns, but we need the literal union).
export type Hackathon = Omit<HackathonBase, "status"> & { status: HackathonStatus };
export type Team = Omit<TeamBase, "pathway" | "status"> & {
    pathway: TeamPathway | null;
    status: TeamStatus;
};
export type TeamScores = TeamScoresBase;
export type User = UserBase;
export type Ballot = BallotBase;
export type BallotScore = BallotScoreBase;
export type OAuth2Application = OAuth2ApplicationBase;
export type Award = AwardBase;
export type TeamAward = TeamAwardBase;
export type TeamInvite = TeamInviteBase;
export type PeerVotingScore = PeerVotingScoreBase;
export type Season = Omit<SeasonBase, "score_curve_preset"> & {
    score_curve_preset: ScoreCurvePreset;
};
export type AdminAuditEvent = AdminAuditEventBase;
export type Notification = NotificationBase;
export type JudgeAssignment = JudgeAssignmentBase;
export type JudgeRecusal = JudgeRecusalBase;
export type JudgeFlag = JudgeFlagBase;

export type { HackathonStatus, TeamPathway, TeamStatus };

// Ambient declarations for backward compatibility — existing code uses
// these types without explicit imports (they were previously declared
// as global interfaces in this file).
declare global {
    type Hackathon = Omit<HackathonBase, "status"> & { status: HackathonStatus };
    type Team = Omit<TeamBase, "pathway" | "status"> & {
        pathway: TeamPathway | null;
        status: TeamStatus;
    };
    type TeamScores = TeamScoresBase;
    type User = UserBase;
    type BasisAuthSession = BasisAuthSessionBase;
    type Ballot = BallotBase;
    type BallotScore = BallotScoreBase;
    type OAuth2Application = OAuth2ApplicationBase;
    type Award = AwardBase;
    type TeamAward = TeamAwardBase;
    type TeamInvite = TeamInviteBase;
    type PeerVotingScore = PeerVotingScoreBase;
    type Season = Omit<SeasonBase, "score_curve_preset"> & {
        score_curve_preset: ScoreCurvePreset;
    };
    type AdminAuditEvent = AdminAuditEventBase;
    type Notification = NotificationBase;
    type JudgeAssignment = JudgeAssignmentBase;
    type JudgeRecusal = JudgeRecusalBase;
    type JudgeFlag = JudgeFlagBase;
    type HackathonStatus = "not_started" | "in_progress" | "voting" | "finished" | "paused";
    type TeamPathway = string;
    type TeamStatus = "active" | "withdrawn" | "disqualified" | "no_show";
    type ScoreCurvePreset = import("./score-curve").ScoreCurvePreset;
}
