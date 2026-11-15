import z from "zod";

export const MicrosoftWebhookQuery = z.object({
    validationToken: z.string().max(4096).optional(),
});

const MicrosoftWebhookNotification = z
    .object({
        clientState: z.string().max(4096),
        changeType: z.string().max(100).optional(),
        resource: z.string().max(4096).optional(),
        lifecycleEvent: z.string().max(100).optional(),
    })
    .passthrough();

export const MicrosoftWebhookBody = z
    .object({ value: z.array(MicrosoftWebhookNotification).min(1) })
    .passthrough();
