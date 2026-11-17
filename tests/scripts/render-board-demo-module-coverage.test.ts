import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputDir = resolve(projectRoot, "artifacts/board-demo");
const capturesDir = resolve(outputDir, "captures");
const framesDir = resolve(outputDir, "frames");
const renderDir = resolve(outputDir, ".render");
const manifestPath = resolve(capturesDir, "manifest.json");
const videoPath = resolve(outputDir, "nethack-board-demo.mp4");
const gifPath = resolve(outputDir, "nethack-board-demo.gif");

const sceneIds = [
    "01-home",
    "02-showcase",
    "03-admin-season",
    "03-r1-shell",
    "04-participant-team",
    "04-participant-project",
    "04-participant-submitted",
    "05-peer-voting",
    "06-judge-scoring",
    "07-results",
    "08-project-archive",
    "09-season-archive",
    "10-admin-review",
];
const captures = sceneIds.map((id) => ({ id, image: `${id}.png` }));

interface RenderOptions {
    manifest?: unknown[];
    manifestRaw?: string;
    manifestError?: Error;
    /** 0-based spawnSync call index -> result */
    spawnFailures?: Record<number, { error?: Error; status?: number | null }>;
    probe?: { narration?: number; video?: number; gif?: number };
    patchReplace?: boolean;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("playwright");
    vi.resetModules();
});

async function render(options: RenderOptions = {}) {
    vi.resetModules();

    const writes = new Map<string, string>();
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async (path: string, content: string) => {
        writes.set(path, content);
    });
    const readFile = vi.fn(async (path: string, encoding?: string) => {
        if (path === manifestPath) {
            if (options.manifestError) throw options.manifestError;
            return options.manifestRaw ?? JSON.stringify(options.manifest ?? captures);
        }
        if (encoding === "utf8") return "";
        return Buffer.from(`frame-bytes:${path}`);
    });
    vi.doMock("node:fs/promises", () => ({ mkdir, readFile, writeFile }));

    let spawnCall = 0;
    const spawnSync = vi.fn(() => {
        const result = options.spawnFailures?.[spawnCall] ?? { status: 0 };
        spawnCall += 1;
        return result;
    });
    const probe = options.probe ?? {};
    const execFileSync = vi.fn((_command: string, args: string[]) => {
        const target = String(args.at(-1) ?? "");
        const duration = target.endsWith(".gif")
            ? (probe.gif ?? 40.4)
            : target.endsWith("nethack-board-demo.mp4")
              ? (probe.video ?? 350.4)
              : (probe.narration ?? 30.2);
        return `${duration}\n`;
    });
    vi.doMock("node:child_process", () => ({ execFileSync, spawnSync }));

    const page = {
        setContent: vi.fn(async () => undefined),
        screenshot: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
    };
    const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
    const launch = vi.fn(async () => browser);
    vi.doMock("playwright", () => ({ chromium: { launch } }));

    if (options.patchReplace) {
        const originalReplace = String.prototype.replace;
        vi.spyOn(String.prototype, "replace").mockImplementation(function (
            this: string,
            pattern: string | RegExp,
            replacement: string | ((substring: string) => string),
        ) {
            if (
                pattern instanceof RegExp &&
                pattern.source === "[&<>\"']" &&
                typeof replacement === "function"
            ) {
                return ["&", "<", ">", '"', "'"]
                    .map((character) => replacement(character))
                    .join("");
            }
            return originalReplace.call(this, pattern, replacement);
        } as typeof String.prototype.replace);
    }

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    let error: unknown;
    try {
        await import("../../scripts/render-board-demo.mjs");
    } catch (caught) {
        error = caught;
    }

    return {
        error,
        writes,
        mkdir,
        readFile,
        writeFile,
        spawnSync,
        execFileSync,
        launch,
        browser,
        page,
        info,
    };
}

describe("board demo render pipeline", () => {
    it("renders every frame, narrates each chapter, and assembles the video and gif", async () => {
        const run = await render();

        expect(run.error).toBeUndefined();
        expect(run.launch).toHaveBeenCalledWith({ headless: true });
        expect(run.mkdir).toHaveBeenCalledWith(framesDir, { recursive: true });
        expect(run.mkdir).toHaveBeenCalledWith(renderDir, { recursive: true });
        expect(run.browser.close).toHaveBeenCalledOnce();
        expect(run.page.setContent).toHaveBeenCalledTimes(sceneIds.length);
        expect(run.page.screenshot).toHaveBeenCalledTimes(sceneIds.length);
        expect(run.page.close).toHaveBeenCalledOnce();
        expect(run.page.screenshot).toHaveBeenNthCalledWith(1, {
            path: resolve(framesDir, "01-01-home.png"),
        });
        expect(run.page.setContent).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining('src="data:image/png;base64,'),
            { waitUntil: "load" },
        );
        expect(run.page.setContent).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("01 / 13 · BOARD PREVIEW"),
            expect.anything(),
        );

        expect(run.spawnSync).toHaveBeenCalledTimes(sceneIds.length * 2 + 2);
        expect(run.execFileSync).toHaveBeenCalledTimes(sceneIds.length + 2);
        expect(run.execFileSync).toHaveBeenCalledWith(
            "ffprobe",
            expect.arrayContaining([resolve(renderDir, "01-01-home.wav")]),
            expect.objectContaining({ encoding: "utf8" }),
        );
        expect(run.spawnSync).toHaveBeenNthCalledWith(
            1,
            "ffmpeg",
            expect.arrayContaining([
                "-i",
                "flite=textfile=artifacts/board-demo/.render/01-01-home.txt:voice=slt",
            ]),
            expect.objectContaining({ stdio: "inherit" }),
        );
        expect(run.spawnSync).toHaveBeenLastCalledWith(
            "ffmpeg",
            expect.arrayContaining(["-i", resolve(renderDir, "gif-slides.txt")]),
            expect.anything(),
        );

        const speechText = run.writes.get(resolve(renderDir, "01-01-home.txt"));
        expect(speechText).toMatch(/^Welcome to nethack/);
        expect(speechText?.endsWith("\n")).toBe(true);
        const segmentList = run.writes.get(resolve(renderDir, "video-segments.txt"));
        expect(segmentList).toContain("file '");
        expect(segmentList).toContain("/artifacts/board-demo/.render/01-01-home.mp4'");
        expect(segmentList?.trim().split("\n")).toHaveLength(sceneIds.length);
        const slides = run.writes.get(resolve(renderDir, "gif-slides.txt"));
        expect(slides?.trim().split("\n")).toHaveLength(sceneIds.length * 2 + 1);
        expect(slides).toContain("duration 3");
        const narration = run.writes.get(resolve(outputDir, "narration.md"));
        expect(narration).toContain("# nethack board demo narration");
        expect(narration).toContain("## 1. A new season begins");
        expect(narration).toContain("## 13. Administrator review and close");

        expect(run.info).toHaveBeenNthCalledWith(1, `Rendered ${videoPath} (350 seconds).`);
        expect(run.info).toHaveBeenNthCalledWith(2, `Rendered ${gifPath} (40.4 seconds).`);
    });

    it("escapes HTML entities in scene titles", async () => {
        const run = await render({ patchReplace: true });

        expect(run.error).toBeUndefined();
        expect(run.page.setContent).toHaveBeenCalledWith(
            expect.stringContaining("<h1>&amp;&lt;&gt;&quot;&#39;</h1>"),
            expect.anything(),
        );
    });

    it("reports missing browser captures", async () => {
        const run = await render({ manifestError: new Error("ENOENT: manifest.json") });

        expect(run.error).toBeInstanceOf(Error);
        expect((run.error as Error).message).toBe(
            "Browser captures are missing. Run `bun run demo:capture` first.",
        );
        expect((run.error as Error).cause).toBeInstanceOf(Error);
        expect(run.launch).not.toHaveBeenCalled();
    });

    it("reports malformed browser capture manifests", async () => {
        const run = await render({ manifestRaw: "{" });

        expect((run.error as Error).message).toBe(
            "Browser captures are missing. Run `bun run demo:capture` first.",
        );
        expect((run.error as Error).cause).toBeInstanceOf(SyntaxError);
    });

    it("closes the browser when a scene checkpoint is missing", async () => {
        const run = await render({
            manifest: captures.filter((capture) => capture.id !== "03-admin-season"),
        });

        expect((run.error as Error).message).toBe(
            "Missing browser checkpoint 03-admin-season; rerun demo:capture.",
        );
        expect(run.page.screenshot).toHaveBeenCalledTimes(2);
        expect(run.browser.close).toHaveBeenCalledOnce();
    });

    it("propagates ffmpeg spawn errors", async () => {
        const run = await render({ spawnFailures: { 0: { error: new Error("spawn ENOENT") } } });

        expect((run.error as Error).message).toBe("spawn ENOENT");
        expect(run.browser.close).toHaveBeenCalledOnce();
    });

    it("reports a non-zero chapter voiceover exit", async () => {
        const run = await render({ spawnFailures: { 0: { status: 2 } } });

        expect((run.error as Error).message).toBe("Voiceover chapter 01 failed with exit code 2.");
    });

    it("reports a non-zero MP4 assembly exit", async () => {
        const run = await render({
            spawnFailures: { [sceneIds.length * 2]: { status: 1 } },
        });

        expect((run.error as Error).message).toBe("MP4 assembly failed with exit code 1.");
    });

    it("reports a failed GIF assembly", async () => {
        const run = await render({
            spawnFailures: { [sceneIds.length * 2 + 1]: { error: new Error("gif boom") } },
        });

        expect((run.error as Error).message).toBe("gif boom");
    });

    it("rejects a narrated video that is too short", async () => {
        const run = await render({ probe: { video: 200.7 } });

        expect((run.error as Error).message).toBe(
            "Narrated video duration is 201 seconds; expected 300–420 seconds. Adjust the speech rate or narration before delivery.",
        );
    });

    it("rejects a narrated video that is too long", async () => {
        const run = await render({ probe: { video: 500.2 } });

        expect((run.error as Error).message).toContain("Narrated video duration is 500 seconds");
    });

    it("rejects a gif that is too short", async () => {
        const run = await render({ probe: { gif: 10.2 } });

        expect((run.error as Error).message).toBe(
            "GIF duration is 10.2 seconds; expected 30–45 seconds.",
        );
    });

    it("rejects a gif that is too long", async () => {
        const run = await render({ probe: { gif: 60.9 } });

        expect((run.error as Error).message).toBe(
            "GIF duration is 60.9 seconds; expected 30–45 seconds.",
        );
    });
});
