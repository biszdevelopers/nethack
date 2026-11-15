import { describe, it, expect } from "vitest";
import {
    isAdminScope,
    parseScopes,
    hasScope,
    addScopes,
    removeScope,
    OAuth2Scopes,
    OAuth2ScopeDescriptions,
    OAuth2ScopesList,
} from "~~/shared/oauth2-scopes";

describe("isAdminScope", () => {
    it("returns false for a non-admin scope", () => {
        expect(isAdminScope("openid")).toBe(false);
    });

    it("returns false for profile scope", () => {
        expect(isAdminScope("profile")).toBe(false);
    });

    it("returns false for an unknown scope", () => {
        expect(isAdminScope("nonexistent.scope")).toBe(false);
    });
});

describe("parseScopes", () => {
    it("parses a normal scope string", () => {
        const result = parseScopes("openid profile email");
        expect(result).toEqual(["openid", "profile", "email"]);
    });

    it("parses a single scope", () => {
        const result = parseScopes("openid");
        expect(result).toEqual(["openid"]);
    });

    it("returns an empty array for an empty string", () => {
        const result = parseScopes("");
        expect(result).toEqual([]);
    });

    it("returns an empty array for null", () => {
        const result = parseScopes(null);
        expect(result).toEqual([]);
    });

    it("returns an empty array for undefined", () => {
        const result = parseScopes(undefined);
        expect(result).toEqual([]);
    });

    it("handles whitespace-only strings", () => {
        const result = parseScopes("   ");
        expect(result).toEqual([]);
    });

    it("handles leading and trailing whitespace", () => {
        const result = parseScopes("  openid  profile  ");
        expect(result).toEqual(["openid", "profile"]);
    });
});

describe("hasScope", () => {
    it("returns true when the scope is present", () => {
        expect(hasScope("openid profile", "openid")).toBe(true);
    });

    it("returns false when the scope is not present", () => {
        expect(hasScope("openid profile", "email")).toBe(false);
    });

    it("returns false for null scopes", () => {
        expect(hasScope(null, "openid")).toBe(false);
    });

    it("returns false for undefined scopes", () => {
        expect(hasScope(undefined, "openid")).toBe(false);
    });

    it("returns false for empty scopes string", () => {
        expect(hasScope("", "openid")).toBe(false);
    });
});

describe("addScopes", () => {
    it("adds a new scope to existing scopes", () => {
        const result = addScopes("openid profile", ["email"]);
        const scopes = parseScopes(result);
        expect(scopes).toContain("openid");
        expect(scopes).toContain("profile");
        expect(scopes).toContain("email");
        expect(scopes).toHaveLength(3);
    });

    it("adds multiple new scopes at once", () => {
        const result = addScopes("openid", ["profile", "email"]);
        const scopes = parseScopes(result);
        expect(scopes).toContain("openid");
        expect(scopes).toContain("profile");
        expect(scopes).toContain("email");
        expect(scopes).toHaveLength(3);
    });

    it("does not add a duplicate scope", () => {
        const result = addScopes("openid profile", ["openid"]);
        const scopes = parseScopes(result);
        expect(scopes).toEqual(["openid", "profile"]);
    });

    it("adds scopes to an empty string", () => {
        const result = addScopes("", ["openid"]);
        const scopes = parseScopes(result);
        expect(scopes).toEqual(["openid"]);
    });

    it("adds scopes to null", () => {
        const result = addScopes(null, ["openid"]);
        const scopes = parseScopes(result);
        expect(scopes).toEqual(["openid"]);
    });

    it("adds scopes to undefined", () => {
        const result = addScopes(undefined, ["openid"]);
        const scopes = parseScopes(result);
        expect(scopes).toEqual(["openid"]);
    });
});

describe("removeScope", () => {
    it("removes an existing scope", () => {
        const result = removeScope("openid profile email", "profile");
        const scopes = parseScopes(result);
        expect(scopes).toEqual(["openid", "email"]);
    });

    it("does nothing when removing a non-existing scope", () => {
        const result = removeScope("openid profile", "email");
        const scopes = parseScopes(result);
        expect(scopes).toEqual(["openid", "profile"]);
    });

    it("returns an empty string when removing from empty", () => {
        const result = removeScope("", "openid");
        expect(result).toBe("");
    });

    it("returns an empty string when removing from null", () => {
        const result = removeScope(null, "openid");
        expect(result).toBe("");
    });

    it("returns an empty string when removing the only scope", () => {
        const result = removeScope("openid", "openid");
        const scopes = parseScopes(result);
        expect(scopes).toEqual([]);
    });
});

describe("OAuth2Scopes", () => {
    it("has all required scope entries", () => {
        const requiredScopes = ["openid", "profile", "email"];
        for (const scope of requiredScopes) {
            expect(OAuth2Scopes[scope]).toBeDefined();
        }
    });

    it("each scope has a description", () => {
        for (const [, meta] of Object.entries(OAuth2Scopes)) {
            expect(meta.description).toBeTruthy();
            expect(typeof meta.description).toBe("string");
        }
    });

    it("each scope has adminOnly boolean", () => {
        for (const [, meta] of Object.entries(OAuth2Scopes)) {
            expect(typeof meta.adminOnly).toBe("boolean");
        }
    });

    it("each scope has sensitive boolean", () => {
        for (const [, meta] of Object.entries(OAuth2Scopes)) {
            expect(typeof meta.sensitive).toBe("boolean");
        }
    });
});

describe("OAuth2ScopeDescriptions", () => {
    it("has the same keys as OAuth2Scopes", () => {
        const scopeKeys = Object.keys(OAuth2Scopes).sort();
        const descKeys = Object.keys(OAuth2ScopeDescriptions).sort();
        expect(descKeys).toEqual(scopeKeys);
    });

    it("each description matches the corresponding scope description", () => {
        for (const [key, meta] of Object.entries(OAuth2Scopes)) {
            expect(OAuth2ScopeDescriptions[key]).toBe(meta.description);
        }
    });
});

describe("OAuth2ScopesList", () => {
    it("matches the keys of OAuth2Scopes", () => {
        const scopeKeys = Object.keys(OAuth2Scopes).sort();
        const list = [...OAuth2ScopesList].sort();
        expect(list).toEqual(scopeKeys);
    });
});
