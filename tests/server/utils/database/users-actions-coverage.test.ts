import { beforeEach, describe, expect, it } from "vitest";
import { findOrLinkBasisAuthUser, getUserByBasisAuthSubject } from "~~/server/utils/database/users";
import { createMockEvent } from "./helpers";

describe("existing basis-auth link update actions", () => {
    let event: Awaited<ReturnType<typeof createMockEvent>>;
    const identity = {
        issuer: "https://auth.example.test",
        subject: "linked-subject",
        email: "member@example.test",
        name: "Initial Member",
    };

    beforeEach(async () => {
        event = await createMockEvent();
    });

    it("updates the address and trims the display name for a linked subject", async () => {
        const initial = await findOrLinkBasisAuthUser(event, identity);

        const updated = await findOrLinkBasisAuthUser(event, {
            ...identity,
            email: "updated-address@example.test",
            name: "  Current Display Name  ",
        });

        expect(updated).toMatchObject({
            id: initial.id,
            email: "updated-address@example.test",
            name: "Current Display Name",
            auth_issuer: identity.issuer,
            auth_subject: identity.subject,
        });
    });

    it("creates a new local account when a subject has no matching email", async () => {
        const user = await findOrLinkBasisAuthUser(event, {
            ...identity,
            email: "new-member@example.test",
        });

        expect(user).toMatchObject({
            email: "new-member@example.test",
            name: "Initial Member",
            auth_issuer: identity.issuer,
            auth_subject: identity.subject,
        });
    });

    it("links an email match without overwriting its existing name when none is supplied", async () => {
        event.context.drizzle
            .prepare("INSERT INTO users(email, name) VALUES('member@example.test', 'Local Name')")
            .run();

        const linked = await findOrLinkBasisAuthUser(event, { ...identity, name: undefined });

        expect(linked).toMatchObject({
            id: 1,
            email: identity.email,
            name: "Local Name",
            auth_issuer: identity.issuer,
            auth_subject: identity.subject,
        });
    });

    it("keeps a linked display name when the provider omits its name", async () => {
        const initial = await findOrLinkBasisAuthUser(event, identity);

        const updated = await findOrLinkBasisAuthUser(event, {
            ...identity,
            email: "renamed-address@example.test",
            name: undefined,
        });

        expect(updated).toMatchObject({
            id: initial.id,
            email: "renamed-address@example.test",
            name: "Initial Member",
        });
    });

    it.each([undefined, " \t "])(
        "preserves an existing name when the provider has no useful name (%s)",
        async (name) => {
            const initial = await findOrLinkBasisAuthUser(event, identity);

            const updated = await findOrLinkBasisAuthUser(event, {
                ...identity,
                email: "updated-address@example.test",
                name,
            });

            expect(updated).toMatchObject({
                id: initial.id,
                email: "updated-address@example.test",
                name: identity.name,
            });
        },
    );

    it("treats an empty user deletion request as a no-op", async () => {
        const user = await findOrLinkBasisAuthUser(event, identity);
        const { deleteUsers, getUser } = await import("~~/server/utils/database/users");

        await expect(deleteUsers(event, [])).resolves.toBeUndefined();
        await expect(getUser(event, user.id)).resolves.toMatchObject({ id: user.id });
    });

    it("returns null when no user matches an identity subject", async () => {
        await expect(
            getUserByBasisAuthSubject(event, identity.issuer, "missing-subject"),
        ).resolves.toBeNull();
    });
});
