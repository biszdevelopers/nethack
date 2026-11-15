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
        picture: "https://auth.example.test/api/picture/linked-subject",
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
            profile_picture: identity.picture,
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
            profile_picture: identity.picture,
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
            profile_picture: identity.picture,
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

    it("promotes a designated initial administrator on link and on creation", async () => {
        const existing = await findOrLinkBasisAuthUser(event, identity);
        const relinked = await findOrLinkBasisAuthUser(event, {
            ...identity,
            email: "Cindy.Cheng-Bisz@basischina.com",
        });
        const created = await findOrLinkBasisAuthUser(event, {
            ...identity,
            subject: "another-subject",
            email: "zhiyu.jiang90454-bisz@basischina.com",
        });

        expect(relinked).toMatchObject({
            id: existing.id,
            email: "cindy.cheng-bisz@basischina.com",
            is_admin: 1,
        });
        expect(created).toMatchObject({ is_admin: 1 });
    });
});

describe("concurrent basis-auth first logins", () => {
    it("returns the winning row when the unique identity index rejects the race", async () => {
        const event = await createMockEvent();
        const identity = {
            issuer: "https://auth.example.test",
            subject: "racing-subject",
            email: "racing@example.test",
            name: "Racing Member",
            picture: null,
        };
        const winner = await findOrLinkBasisAuthUser(event, identity);
        const drizzle = new Proxy(event.context.drizzle, {
            get(target, property) {
                if (property === "transaction") {
                    return async () => {
                        throw Object.assign(new Error("duplicate key"), { code: "23505" });
                    };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });

        const user = await findOrLinkBasisAuthUser({ context: { drizzle } } as any, identity);

        expect(user.id).toBe(winner.id);
    });

    it("rethrows a unique violation when no linked row is visible", async () => {
        const event = await createMockEvent();
        const drizzle = new Proxy(event.context.drizzle, {
            get(target, property) {
                if (property === "transaction") {
                    return async () => {
                        throw Object.assign(new Error("duplicate key"), { code: "23505" });
                    };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });

        await expect(
            findOrLinkBasisAuthUser({ context: { drizzle } } as any, {
                issuer: "https://auth.example.test",
                subject: "missing-subject",
                email: "missing@example.test",
                name: null,
                picture: null,
            }),
        ).rejects.toThrow("duplicate key");
    });
});
