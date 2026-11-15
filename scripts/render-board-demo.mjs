#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDir = resolve(projectRoot, "artifacts/board-demo");
const capturesDir = resolve(outputDir, "captures");
const framesDir = resolve(outputDir, "frames");
const renderDir = resolve(outputDir, ".render");
const manifestPath = resolve(capturesDir, "manifest.json");

const scenes = [
    {
        id: "01-home",
        title: "A new season begins",
        narration:
            "Welcome to nethack, the BIBS-C Network Hackathon platform. This walkthrough follows a complete event journey, from the public landing page to participant submissions, peer voting, judging, published results, and administrator review. The site keeps its dark terminal identity while presenting each step in a clear, guided way. The example data is synthetic and comes from an isolated test environment.",
    },
    {
        id: "02-showcase",
        title: "Public showcases and archives",
        narration:
            "The public showcase introduces featured projects and makes past rounds discoverable. Project descriptions and submission links are presented together with their original season, so teams can revisit work after an event closes. The archive is driven by season and team data from the application database. It gives the board a direct view of how historical submissions remain available to the community.",
    },
    {
        id: "03-admin-season",
        title: "Administration and season setup",
        narration:
            "Administrators manage event settings, rubrics, judging controls, and season status from the protected portal. A new round can copy the current settings or start as a blank shell. The R1 2026 to 2027 shell remains inactive until its event dates, theme, rubric, and board approval are recorded. This screen shows the controls that prepare a round while keeping it out of the live participant flow.",
    },
    {
        id: "03-r1-shell",
        title: "R1 stays inactive until ready",
        narration:
            "The R1 season is a true blank start. It has no inherited theme, schedule, rubric, or live event switches, and it cannot be activated while those requirements are missing. The approval record is tied to an administrator account and a timestamp. This keeps the new round visible for planning while protecting the current event from an accidental switch before the board has approved it.",
    },
    {
        id: "04-participant-team",
        title: "Participant team registration",
        narration:
            "A participant signs in through the separate basis-auth service and then creates a team in nethack. Team membership is tied to the signed-in account, and the server checks permissions for every change. The registration flow gives participants a clear starting point before they enter project details. The browser journey also confirms that the form works on narrow mobile layouts and that the controls can be reached by keyboard.",
    },
    {
        id: "04-participant-project",
        title: "Project details and submission",
        narration:
            "Next, the team enters a project name, a plain-language description, a demonstration link, and a source repository link. The description stays attached to the project record and its season. The server validates the fields and accepts submissions only during the configured event window. Before the team commits its work, the confirmation step gives them one final chance to review the submission.",
    },
    {
        id: "04-participant-submitted",
        title: "Submission confirmed",
        narration:
            "After confirmation, the participant sees that the project has been submitted. The submitted team becomes available to the event workflows according to the active season settings. Participants can return to the dashboard to see their project and follow the next stage. The same data later powers peer voting, judge evaluation, participant results, and the public project archive.",
    },
    {
        id: "05-peer-voting",
        title: "Peer voting",
        narration:
            "When voting opens, participants review the eligible projects and distribute exactly ten stars across other teams. They provide a short reason for their choices and submit the vote through a validated API. The server enforces the total and prevents voting for the participant's own team. Event administrators control when voting is available, and submitted votes are associated with the correct season.",
    },
    {
        id: "06-judge-scoring",
        title: "Judge evaluation and feedback",
        narration:
            "Judges move through an assignment queue and score each project against the season's rubric. They can save a draft, review their evaluation, and then finalize it. The rubric uses weighted criteria, while written comments focus on observable evidence and useful next steps. Individual judge identities and scores stay private. Competitors see anonymous feedback only after results are published and the season's anonymity threshold is met.",
    },
    {
        id: "07-results",
        title: "Published results for participants",
        narration:
            "After enough judges complete their work, an administrator publishes the results and recalculates the season rankings. Participants can see their score, rank, and anonymous feedback. The display can show both the original score and a configured presentation curve while preserving the underlying evaluation. Before publication, private results remain hidden. The release controls let organizers verify the event state before the results become visible.",
    },
    {
        id: "08-project-archive",
        title: "Every completed round stays visible",
        narration:
            "Once a round is complete, it becomes available from the public archive. Visitors can browse past seasons without needing an account. This corrects the earlier presentation gap: historic projects and their descriptions were already present in the database, but the public site linked only a small set of curated showcase pages. The new archive surfaces those records by season and keeps the current round separate until it is complete.",
    },
    {
        id: "09-season-archive",
        title: "A season's complete project list",
        narration:
            "Opening a season archive reveals the submitted projects, their descriptions, safe external links, and published placements where those are available. Each project remains connected to the season that received it, which makes previous rounds easier to explore and compare. The public page deliberately omits private account information and judge identities. This gives the board a concrete view of how the historical data recovery translates into a usable archive.",
    },
    {
        id: "10-admin-review",
        title: "Administrator review and close",
        narration:
            "Administrators have a separate review view for project feedback and operational checks. That protected view can show judge names and account-level context to authorized staff, while competitor-facing pages remain anonymous. Across the flow, nethack keeps authentication at basis-auth, event roles in the application, and season data in PostgreSQL. This completes the board walkthrough: prepare a round, run participation and evaluation, publish outcomes, and preserve the work for future seasons.",
    },
];

function run(command, args, label) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        stdio: "inherit",
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

function getDuration(path) {
    const output = execFileSync(
        "ffprobe",
        [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        { cwd: projectRoot, encoding: "utf8", windowsHide: true },
    );
    return Number(output.trim());
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
        const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
        return escapes[character];
    });
}

function concatEscape(path) {
    return path.replaceAll("\\", "/").replaceAll("'", "'\\''");
}

async function renderFrames(browser, manifest) {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
    });
    const frames = [];
    for (const [index, scene] of scenes.entries()) {
        const capture = manifest.get(scene.id);
        if (!capture)
            throw new Error(`Missing browser checkpoint ${scene.id}; rerun demo:capture.`);
        const imagePath = resolve(capturesDir, capture.image);
        const image = await readFile(imagePath);
        const framePath = resolve(
            framesDir,
            `${String(index + 1).padStart(2, "0")}-${scene.id}.png`,
        );
        const count = `${String(index + 1).padStart(2, "0")} / ${String(scenes.length).padStart(2, "0")}`;
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>
            *{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#04070b;color:#f4f7fb;font-family:Arial,Helvetica,sans-serif}
            .screen{position:relative;width:1280px;height:720px;overflow:hidden}.screen img{position:absolute;width:100%;height:100%;object-fit:cover;object-position:center;filter:brightness(.69) saturate(.86)}
            .veil{position:absolute;inset:0;background:linear-gradient(90deg,rgba(2,7,12,.04) 15%,rgba(2,7,12,.12) 55%,rgba(2,7,12,.84) 100%),linear-gradient(0deg,rgba(2,7,12,.91),transparent 42%)}
            .top{position:absolute;top:34px;left:42px;display:flex;align-items:center;gap:14px;font:700 15px/1.2 Consolas,monospace;letter-spacing:.19em;text-transform:uppercase;color:#a4f5ff;text-shadow:0 2px 12px #000}
            .dot{width:9px;height:9px;border-radius:50%;background:#46edff;box-shadow:0 0 18px #46edff}.count{position:absolute;right:44px;top:35px;font:13px Consolas,monospace;color:#c5d1df;letter-spacing:.12em}
            .copy{position:absolute;right:54px;bottom:56px;width:470px;border-left:2px solid #50edff;padding:8px 0 8px 24px;text-shadow:0 2px 16px #000}
            .kicker{font:700 12px Consolas,monospace;color:#7df2ff;letter-spacing:.23em;text-transform:uppercase;margin-bottom:16px}
            h1{font-size:43px;line-height:1.04;letter-spacing:-.035em;margin:0 0 16px;font-weight:700}
            .sub{font:14px/1.55 Consolas,monospace;color:#d6e0e9}.rule{height:1px;background:linear-gradient(90deg,#5bf2ff,transparent);margin-top:22px}
        </style></head><body><main class="screen"><img src="data:image/png;base64,${image.toString("base64")}"><div class="veil"></div>
            <div class="top"><span class="dot"></span>NETHACK <span style="color:#f7fbff">/</span> BIBS-C NETWORK</div><div class="count">${count} · BOARD PREVIEW</div>
            <div class="copy"><div class="kicker">R1 · 2026—2027 HACKATHON</div><h1>${escapeHtml(scene.title)}</h1><div class="sub">A complete event flow, from registration to results.</div><div class="rule"></div></div>
        </main></body></html>`;
        await page.setContent(html, { waitUntil: "load" });
        await page.screenshot({ path: framePath });
        frames.push(framePath);
    }
    await page.close();
    return frames;
}

async function renderNarration(frames) {
    const segments = [];
    for (const [index, scene] of scenes.entries()) {
        const number = String(index + 1).padStart(2, "0");
        const speechTextPath = resolve(renderDir, `${number}-${scene.id}.txt`);
        const narrationPath = resolve(renderDir, `${number}-${scene.id}.wav`);
        const segmentPath = resolve(renderDir, `${number}-${scene.id}.mp4`);
        await writeFile(speechTextPath, `${scene.narration}\n`, "utf8");
        const relativeSpeechTextPath = relative(projectRoot, speechTextPath).split(sep).join("/");
        run(
            "ffmpeg",
            [
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostats",
                "-f",
                "lavfi",
                "-i",
                `flite=textfile=${relativeSpeechTextPath}:voice=slt`,
                "-af",
                "atempo=0.75",
                "-ar",
                "24000",
                "-ac",
                "1",
                narrationPath,
            ],
            `Voiceover chapter ${number}`,
        );
        const duration = getDuration(narrationPath);
        const framePath = frames[index];
        run(
            "ffmpeg",
            [
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostats",
                "-loop",
                "1",
                "-framerate",
                "30",
                "-i",
                framePath,
                "-i",
                narrationPath,
                "-vf",
                "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.0003,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,format=yuv420p",
                "-t",
                String(duration),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "24",
                "-r",
                "30",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-shortest",
                "-movflags",
                "+faststart",
                segmentPath,
            ],
            `Video chapter ${number}`,
        );
        segments.push({ path: segmentPath, narrationPath, duration });
    }

    const listPath = resolve(renderDir, "video-segments.txt");
    await writeFile(
        listPath,
        `${segments.map(({ path }) => `file '${concatEscape(path)}'`).join("\n")}\n`,
        "utf8",
    );
    const videoPath = resolve(outputDir, "nethack-board-demo.mp4");
    run(
        "ffmpeg",
        [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            listPath,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            videoPath,
        ],
        "MP4 assembly",
    );

    const transcript = scenes
        .map((scene, index) => `## ${index + 1}. ${scene.title}\n\n${scene.narration}`)
        .join("\n\n");
    await writeFile(
        resolve(outputDir, "narration.md"),
        `# nethack board demo narration\n\n${transcript}\n`,
        "utf8",
    );
    return { videoPath, segments };
}

async function renderGif(frames) {
    const slidesPath = resolve(renderDir, "gif-slides.txt");
    const records = frames.map((frame) => `file '${concatEscape(frame)}'\nduration 3`);
    records.push(`file '${concatEscape(frames.at(-1))}'`);
    await writeFile(slidesPath, `${records.join("\n")}\n`, "utf8");
    const gifPath = resolve(outputDir, "nethack-board-demo.gif");
    run(
        "ffmpeg",
        [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            slidesPath,
            "-filter_complex",
            "fps=10,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            "-loop",
            "0",
            gifPath,
        ],
        "GIF assembly",
    );
    return gifPath;
}

await mkdir(framesDir, { recursive: true });
await mkdir(renderDir, { recursive: true });
let captureManifest;
try {
    captureManifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
    throw new Error("Browser captures are missing. Run `bun run demo:capture` first.", {
        cause: error,
    });
}
const manifest = new Map(captureManifest.map((chapter) => [chapter.id, chapter]));
const browser = await chromium.launch({ headless: true });
let frames;
try {
    frames = await renderFrames(browser, manifest);
} finally {
    await browser.close();
}

const { videoPath } = await renderNarration(frames);
const gifPath = await renderGif(frames);
const videoDuration = getDuration(videoPath);
const gifDuration = getDuration(gifPath);
if (videoDuration < 300 || videoDuration > 420) {
    throw new Error(
        `Narrated video duration is ${Math.round(videoDuration)} seconds; expected 300–420 seconds. Adjust the speech rate or narration before delivery.`,
    );
}
if (gifDuration < 30 || gifDuration > 45) {
    throw new Error(`GIF duration is ${gifDuration.toFixed(1)} seconds; expected 30–45 seconds.`);
}
console.info(`Rendered ${videoPath} (${Math.round(videoDuration)} seconds).`);
console.info(`Rendered ${gifPath} (${gifDuration.toFixed(1)} seconds).`);
