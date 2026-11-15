<script setup lang="ts">
useHead({
    title: `Contributing | ${WEBSITE_NAME}`,
});
</script>

<template>
    <div class="max-w-3xl mx-auto px-4 py-12 space-y-8">
        <h1 class="text-4xl font-bold">Contributing to nethack</h1>

        <section class="space-y-4">
            <h2 class="text-2xl font-semibold">Welcome</h2>
            <p>
                Thank you for your interest in contributing to nethack, the official platform for
                the BIBS-C Network Hackathon. This document outlines the expectations and processes
                for any person wishing to contribute code, report issues, or otherwise help improve
                the project.
            </p>
        </section>

        <section class="space-y-4">
            <h2 class="text-2xl font-semibold">Commit Guidelines</h2>
            <p>
                All contributions arrive through pull requests to the
                <ULink
                    to="https://www.github.com/basishacks/basishacks-r2"
                    target="_blank"
                    class="text-primary underline"
                >
                    nethack repository
                </ULink>
                . Follow these guidelines when preparing your changes:
            </p>
            <ul class="list-disc list-inside space-y-2">
                <li>
                    <span class="font-semibold">Use conventional commits.</span>
                    Prefix each commit message with a type such as
                    <code>feat</code>
                    ,
                    <code>fix</code>
                    ,
                    <code>docs</code>
                    ,
                    <code>test</code>
                    ,
                    <code>refactor</code>
                    ,
                    <code>chore</code>
                    , or
                    <code>style</code>
                    . Adhere to the format
                    <code>type(scope): description</code>
                    .
                </li>
                <li>
                    <span class="font-semibold">Keep changes focused.</span>
                    Each commit ought to represent a single logical change. Avoid bundling unrelated
                    modifications within the same commit.
                </li>
                <li>
                    <span class="font-semibold">Write meaningful descriptions.</span>
                    The body of the commit message should explain
                    <em>why</em>
                    the change was made, not merely
                    <em>what</em>
                    was changed.
                </li>
                <li>
                    <span class="font-semibold">Run the test suite.</span>
                    Execute
                    <code>bun run test</code>
                    and confirm that all tests pass before submitting a pull request. Also run
                    <code>bun run format</code>
                    to ensure code style compliance.
                </li>
                <li>
                    <span class="font-semibold">Refrain from committing secrets.</span>
                    Never commit API keys, tokens, passwords, or other sensitive credentials. All
                    secrets must be loaded from environment variables.
                </li>
                <li>
                    <span class="font-semibold">Rebase onto main.</span>
                    Before opening a pull request, rebase the working branch onto the latest
                    <code>main</code>
                    and resolve any conflicts.
                </li>
            </ul>
        </section>

        <section class="space-y-4">
            <h2 class="text-2xl font-semibold">Reporting Security Issues</h2>
            <p>
                If you discover a security vulnerability or any other issue that could compromise
                the integrity of the platform or its users, disclose it privately. Do
                <span class="font-semibold">not</span>
                file a public GitHub issue or discuss the matter in public forums. Public disclosure
                of a vulnerability before a fix is deployed places every user of the platform at
                risk, and any person who discloses such information publicly may be considered
                complicit in subsequent misuse of that vulnerability by third parties.
            </p>
            <p>
                If you possess the ability and the willingness to do so, we encourage you to fix the
                issue yourself: fork the repository, implement the correction, commit it, and open a
                pull request. We will review it and decide whether to merge it as promptly as
                possible. To protect the integrity of the fix during the review window, you may
                choose to obfuscate the correction by including unrelated boilerplate changes and by
                refraining from mentioning the vulnerability explicitly in the pull request
                description, as pull requests are publicly visible.
            </p>
            <p>
                To report a security concern, send an email or a Teams message to the BIBS-C
                Developers' Club at
                <span class="font-mono text-primary">devclub-bisz@basischina.com</span>
                . Include a detailed description of the issue, steps to reproduce it, and any
                relevant supporting material.
            </p>
            <p>
                We acknowledge receipt usually within 48 hours and work to address the issue as
                quickly as possible. Depending on the severity and impact of the report, we may
                offer a discretionary reward, though no guarantee of compensation is made in
                advance. If you indicate in your correspondence whether you wish to be publicly
                mentioned or thanked after the hackathon season concludes, we will respect that
                choice.
            </p>
        </section>

        <section class="space-y-4">
            <h2 class="text-2xl font-semibold">Responsible Disclosure</h2>
            <p>
                We ask that you act in good faith and refrain from exploiting any vulnerability you
                discover. Unauthorized access, data exfiltration, service disruption, or any other
                malicious activity is not tolerated.
            </p>
            <p>
                We maintain full logging and audit trails across the platform. In the event that a
                person is found to have exploited a vulnerability rather than reported it, we pursue
                all available remedies, which may include reporting the incident to school
                administration or further authorities depending on the severity of the issue. We
                possess the capability to identify and trace such activity, and we hold accountable
                any person who chooses to abuse the system rather than assist in its protection.
            </p>
        </section>

        <section class="space-y-4">
            <h2 class="text-2xl font-semibold">Code of Conduct</h2>
            <p>
                All contributors are expected to adhere to the principles of respect, integrity, and
                collaboration. Harassment, discrimination, or any form of unprofessional behavior is
                not permitted. By participating in this project, you agree to uphold these
                standards.
            </p>
        </section>

        <USeparator />

        <p class="text-sm text-ui-text-muted">
            nethack is maintained by the BISZ Developers' Club as part of the BIBS-C Network
            Hackathon.
        </p>
    </div>
</template>
