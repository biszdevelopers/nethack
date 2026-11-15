import type { RubricDefinition } from "~~/shared/rubric";

export interface RubricTemplateSummary {
    id: number;
    name: string;
    description: string | null;
    definition: RubricDefinition;
    updated_at?: number | string | Date;
}
