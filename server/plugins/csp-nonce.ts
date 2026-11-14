import { useServerHooks } from "nuxt/server";

const SCRIPT_TAG = /<script\b(?![^>]*\bnonce=)(?=[\s>])/gi;

function addNonce(chunks: string[], nonce: string): string[] {
    return chunks.map((chunk) => chunk.replace(SCRIPT_TAG, `<script nonce="${nonce}"`));
}

export default defineNitroPlugin(() => {
    useServerHooks().hook("render:html", (html, { event }) => {
        const nonce = event.context.cspNonce;
        if (!nonce) return;

        // These arrays contain renderer-owned scripts, separate from page content.
        html.head = addNonce(html.head, nonce);
        html.bodyPrepend = addNonce(html.bodyPrepend, nonce);
        html.bodyAppend = addNonce(html.bodyAppend, nonce);
    });
});
