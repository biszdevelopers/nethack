<script setup lang="ts">
useHead({ title: `Rules | ${WEBSITE_NAME}` });
</script>

<template>
    <div class="mt-4 space-y-8 text-gray-900 dark:text-gray-100">
        <header class="space-y-4">
            <h1 class="text-4xl font-bold glow mb-4">Code of Conduct and Competition Rules</h1>
            <p>
                This document sets out the rules, expectations, and terms governing participation in
                {{ WEBSITE_NAME }}. It explains what participants must provide, how projects will be
                evaluated, and the standards of conduct expected throughout the competition.
            </p>
            <p>
                These rules are currently being finalized and
                <span class="font-semibold text-blue-600 dark:text-blue-300">may be revised</span>
                before the competition begins. All participants are responsible for reviewing the
                latest published version before submitting their work. The final published version
                will govern participation and submissions.
            </p>
            <div
                class="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-4 text-gray-800 dark:text-gray-100"
            >
                <p class="font-semibold mb-1">Please read before participating.</p>
                <p>
                    The requirements in this document are binding. A project that works on its
                    creator's computer is not necessarily ready for evaluation. Participants must
                    also meet the source code, documentation, accessibility, demonstration, and
                    conduct requirements described below.
                </p>
            </div>
        </header>

        <section id="quick-guide" class="space-y-3">
            <details
                class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4"
            >
                <summary
                    class="cursor-pointer text-lg font-semibold text-gray-900 dark:text-gray-100 marker:text-gray-500 dark:marker:text-gray-400"
                >
                    Quick Guide: What You Need to Know
                    <span class="mt-1 block text-sm font-normal text-gray-600 dark:text-gray-300">
                        Recommended for readers who prefer a simpler, plain-language explanation.
                    </span>
                </summary>
                <div class="mt-4 space-y-4 text-sm text-gray-800 dark:text-gray-100">
                    <p>
                        This section explains the most important rules in plain language. It is a
                        starting point, not a replacement for reading the complete requirements
                        below.
                    </p>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            1. Make Your Source Code Public
                        </p>
                        <p>
                            Your complete project source code must be available in a public
                            repository on a platform such as GitHub, GitLab, Codeberg, or Gitee.
                            <span class="font-semibold text-red-600 dark:text-red-300">
                                Uploading only an executable file or a compressed archive is not
                                enough.
                            </span>
                            Other people must be able to browse and download your source code.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            2. Include a Complete README
                        </p>
                        <p>
                            Your repository must contain a file named
                            <code
                                class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                            >
                                README.md
                            </code>
                            , written in clear, professional American English. It must explain what
                            your project does, how to use it, which technologies you used, and where
                            to watch your demonstration video.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            3. Make Your Project Available for Testing
                        </p>
                        <p>
                            Judges must have a practical way to try your project. Depending on what
                            you build:
                        </p>
                        <ul class="list-disc list-inside ml-4 space-y-1">
                            <li>Websites must be deployed and publicly accessible.</li>
                            <li>
                                Desktop applications must have downloadable executables for at least
                                one supported platform.
                            </li>
                            <li>Games must be playable in a browser or available as a download.</li>
                            <li>
                                Mobile applications must be available through an app store or as an
                                APK or IPA installer.
                            </li>
                        </ul>
                        <p>
                            Judges should not have to create an account on another website just to
                            see your work. If your own application requires user accounts,
                            additional requirements and penalties may apply.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            4. Follow the Demonstration Video Rules
                        </p>
                        <p>
                            Every project must have a demonstration video
                            <span class="font-semibold text-red-600 dark:text-red-300">
                                between two and three minutes long
                            </span>
                            . The video must contain
                            <span class="font-semibold text-red-600 dark:text-red-300">
                                absolutely no audio
                            </span>
                            and must not reveal your identity, including your face, name, or voice.
                        </p>
                        <p>
                            The video must use H.264, AV1, or VP9 encoding and must be hosted on
                            YouTube, Bilibili, or OneDrive/SharePoint through an accessible sharing
                            link.
                        </p>
                        <p>
                            <span class="font-semibold text-red-600 dark:text-red-300">
                                Do not upload the video to GitHub or any other Git-based hosting
                                platform.
                            </span>
                            Doing so will result in the submission being treated as having no valid
                            video and will lead to disqualification.
                        </p>
                        <p>
                            If your project includes a downloadable executable, you must also
                            display its SHA-256 checksum in the video.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            5. Make Evaluation Easy
                        </p>
                        <p>
                            Judges should be able to experience your project without purchasing
                            hardware, installing uncommon software, or signing up for unrelated
                            services. Any unavoidable access requirements must be explained in your
                            README and may affect your evaluation.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            6. Submit Your Own Work
                        </p>
                        <p>
                            Your project must represent meaningful original work. You may use
                            existing libraries, frameworks, and assets when you have the right to do
                            so and provide proper credit. Simply copying an existing project without
                            meaningful changes is plagiarism and will result in disqualification.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            7. Be Honest About AI
                        </p>
                        <p>
                            AI tools are allowed, but you must explain exactly which parts of your
                            project they helped create, which tools you used, and what assistance
                            they provided. A vague statement such as "AI was used" is not enough.
                            Undeclared or misleading AI use may be treated as plagiarism.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            8. Be Prepared to Explain Your Work
                        </p>
                        <p>
                            Judges may ask you to present your project and answer questions if they
                            suspect excessive or undeclared AI use. All First Prize, Second Prize,
                            Third Prize, and Honorable Mention recipients must also complete a live
                            presentation.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            9. Respect Others and Their Work
                        </p>
                        <p>
                            Harmful software, unauthorized access, deliberate deception, harassment,
                            discrimination, and plagiarism are prohibited. Serious violations may be
                            reported to the school administration.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            10. Understand the Licensing Terms
                        </p>
                        <p>
                            By submitting a project, you agree to the source-code licensing and
                            public showcase terms described in this document. If you do not provide
                            an explicit license file, the default MIT licensing provision applies as
                            described below.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            11. Understand Your Responsibilities
                        </p>
                        <p>
                            Participants are responsible for their own expenses. Prize amounts are
                            subject to confirmation, and the organizers reserve the right to amend
                            these rules or make changes to the competition when necessary.
                        </p>
                    </div>
                    <div class="space-y-2">
                        <p class="font-semibold text-blue-700 dark:text-blue-300">
                            12. Ask Questions When Necessary
                        </p>
                        <p>
                            For questions or clarification, contact
                            <span class="font-semibold text-blue-700 dark:text-blue-300">
                                devclub-bisz@basischina.com
                            </span>
                            . Members of the BISZ Developers' Club leadership will respond.
                        </p>
                    </div>
                </div>
            </details>
        </section>

        <section id="requirements-overview" class="space-y-3">
            <h2 class="text-2xl font-bold">Essential Requirements at a Glance</h2>
            <p>
                The following checklist summarizes the main submission requirements. Read the
                detailed sections for the exact rules and consequences.
            </p>
            <ul class="list-disc list-inside space-y-2">
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Public source code:</strong>
                    Complete source code must be publicly available on a recognized Git hosting
                    platform. Executable-only submissions are not accepted.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">README:</strong>
                    A complete, professional
                    <code
                        class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    >
                        README.md
                    </code>
                    written in American English is required.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Working demonstration:</strong>
                    A publicly accessible demo URL and a valid demonstration video are required.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Evaluation access:</strong>
                    Judges must not be forced to create unrelated third-party accounts, purchase
                    hardware, or install uncommon software.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Original work:</strong>
                    Submissions must contain meaningful original contributions. Closed-source
                    projects are not eligible.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">AI disclosure:</strong>
                    All substantial AI-generated or AI-assisted project components must be described
                    in detail.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Video requirements:</strong>
                    The video must be 2–3 minutes long, silent, and free of personal identification.
                    It must not be hosted on a Git-based platform.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Costs:</strong>
                    Participants are responsible for expenses incurred during development and
                    participation.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Showcase permission:</strong>
                    Submission grants the organizers the rights described in the public showcase
                    license section.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">
                        Default source-code license:
                    </strong>
                    If no explicit license file is provided, the MIT License provision described
                    below applies.
                </li>
            </ul>
            <div
                class="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-gray-800 dark:text-gray-100"
            >
                <p class="font-semibold text-red-700 dark:text-red-300 mb-1">
                    Important: Mandatory requirements
                </p>
                <p>
                    Requirements explicitly marked as mandatory must be met. Failure to meet a
                    mandatory submission requirement will result in disqualification unless that
                    particular rule expressly specifies a different consequence, such as a scoring
                    penalty.
                </p>
            </div>
        </section>

        <section id="phase-1" class="space-y-4">
            <h2 class="text-3xl font-bold">Phase 1: Plan Your Project and Understand the Rules</h2>
            <p>
                Before beginning development, make sure that your project fits the competition, that
                you have the right to use everything you include, and that you understand the
                responsibilities that come with submitting your work.
            </p>
            <h3 class="text-xl font-semibold">1.1. Thematic Relevance</h3>
            <p>
                Every submission must have a meaningful connection to the competition theme. A
                minimal connection is required, and projects with a particularly weak or superficial
                connection will receive point deductions according to the judging rubric.
            </p>
            <p>
                Your project should demonstrate that you have thought about the theme and applied it
                to something meaningful. Simply mentioning the theme in a project description is not
                enough to establish a strong connection.
            </p>
            <h3 class="text-xl font-semibold">1.2. Originality and Intellectual Property</h3>
            <p>
                All submissions must represent your team's own original work. You are welcome to
                build on existing technologies, including open-source libraries, frameworks, and
                other resources, provided that you have the legal right to use them and give
                appropriate credit to their creators.
            </p>
            <p>
                You must respect all applicable licenses and intellectual property rights. Do not
                include copyrighted material, source code, images, music, or other assets without
                permission or a license that allows your intended use.
            </p>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">
                    Copying or directly forking an existing project without making meaningful
                    original contributions constitutes plagiarism.
                </strong>
                Such submissions will be disqualified and may be reported to the school
                administration.
            </p>
            <p>
                Using an existing library or framework does not, by itself, make a project
                unoriginal. What matters is whether your team has made meaningful contributions of
                its own and can explain the work it submits.
            </p>
            <h3 class="text-xl font-semibold">1.3. Open-Source Development</h3>
            <p>
                {{ WEBSITE_NAME }} is built around the belief that software development benefits
                from openness, transparency, and collaboration. We want participants to create work
                that others can study, learn from, and improve.
            </p>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">
                    Closed-source submissions are not eligible.
                </strong>
                Every project must make its complete source code publicly available under an
                appropriate open-source license.
            </p>
            <p>
                We do not dismiss the value of closed-source software. Rather, this competition
                specifically chooses to support open development because it encourages learning,
                makes collaboration possible, and helps build trust within the wider software
                community.
            </p>
            <h3 class="text-xl font-semibold">1.4. Responsible Use of Artificial Intelligence</h3>
            <p>
                AI tools are permitted in this competition. We recognize that they can help
                participants learn, explore ideas, solve problems, and develop software more
                efficiently. However, using AI does not remove your responsibility for the work you
                submit.
            </p>
            <p>
                Every project component that was generated or substantially assisted by an AI tool
                must be disclosed. Your disclosure must identify:
            </p>
            <ul class="list-disc list-inside ml-4 space-y-2">
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">
                        The specific parts involved:
                    </strong>
                    Identify the components or files that received AI assistance, such as user
                    interface components, backend logic, database structures, or scripts.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">The tools used:</strong>
                    Name the AI tools or models involved, such as ChatGPT, GitHub Copilot, or a
                    locally run model.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">
                        The type of assistance:
                    </strong>
                    Explain what the tool actually did. For example, you might state that an AI tool
                    generated a data-processing script that your team subsequently reviewed, tested,
                    and modified.
                </li>
            </ul>
            <p>
                A general statement such as
                <span class="italic">"AI was used during development"</span>
                is not sufficient. The disclosure must allow judges to understand where AI
                contributed and how your team used its output.
            </p>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">
                    Responsible and fully disclosed AI use is not considered plagiarism.
                </strong>
                However, hiding substantial AI assistance, making misleading claims about your work,
                or relying on generated material that your team does not understand may result in
                the submission being treated as plagiarism.
            </p>
            <p>
                We encourage participants to treat AI as a learning and development tool, not as a
                substitute for understanding. Being able to explain, review, test, and improve
                AI-assisted work is an important part of responsible software development.
            </p>
            <h3 class="text-xl font-semibold">1.5. Participant Conduct and Community Standards</h3>
            <p>
                All participants are expected to act responsibly and treat one another with respect.
                Harassment, discrimination, intimidation, and other forms of harmful conduct will
                not be tolerated.
            </p>
            <p>
                The organizers will assess the seriousness of reported incidents. Serious or
                repeated violations may be referred to the school administration for further action.
            </p>
            <p>
                Participants are also expected to respect the work and contributions of others. Do
                not claim someone else's work as your own, deliberately misrepresent your
                contributions, or interfere with another participant's ability to take part in the
                competition.
            </p>
            <h3 class="text-xl font-semibold">1.6. Principles of Open Participation</h3>
            <p>
                By participating in {{ WEBSITE_NAME }}, you agree to uphold the following
                principles. They form the ethical foundation of this competition and the community
                we hope to build.
            </p>
            <ul class="list-disc list-inside space-y-2">
                <li>
                    Build with the intention of creating useful work and providing real value, not
                    causing harm or disruption.
                </li>
                <li>
                    Share your work openly and contribute to the wider community's ability to learn
                    and create.
                </li>
                <li>
                    Respect the same freedoms that you benefit from. Do not unnecessarily restrict
                    others' access to knowledge, tools, or opportunities.
                </li>
                <li>
                    Act with integrity. Take responsibility for your work and respect the
                    contributions and rights of others.
                </li>
            </ul>
        </section>

        <section id="phase-2" class="space-y-4">
            <h2 class="text-3xl font-bold">Phase 2: Build a Project That Can Be Evaluated</h2>
            <p>
                A successful submission must be more than a collection of source files. Judges must
                have a practical way to access, understand, and test your project. Plan for this
                from the beginning rather than leaving it until the final day.
            </p>
            <h3 class="text-xl font-semibold">2.1. Public Access and Demonstration</h3>
            <p>
                Every project must provide a publicly accessible demonstration URL. The link must
                lead directly to the working project, a playable version, or a page where the
                project can be downloaded.
            </p>
            <p>
                The project must be available to judges without unnecessary restrictions. In
                particular, judges must not be required to create an account on an unrelated
                third-party website simply to access or experience your submission.
            </p>
            <p>
                If authentication is an essential part of your own application, your system must
                allow any new user to register freely. Providing only one shared demonstration
                account is not acceptable. Even when registration is available, requiring judges to
                create an account introduces an evaluation barrier and may result in significant
                penalties.
            </p>
            <p>
                If your project is hosted on a platform that inherently requires its users to sign
                in, you must clearly disclose this limitation in your README. You should expect such
                a requirement to negatively affect your evaluation.
            </p>
            <h3 class="text-xl font-semibold">2.2. Requirements by Project Type</h3>
            <p>
                The exact form of your demonstration depends on the type of project you build. The
                following requirements apply:
            </p>
            <ul class="list-disc list-inside space-y-3">
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">
                        Websites and web applications:
                    </strong>
                    Your project must be deployed on a publicly accessible server. Judges must be
                    able to visit and use the live application through a browser. If your
                    application requires authentication, it must allow new users to register freely.
                    A single shared demonstration account is not sufficient.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Desktop applications:</strong>
                    Your project must be compiled into a downloadable executable for at least one of
                    the following: Windows, macOS, or Debian/Debian-based Linux. Supporting at least
                    two of these platforms is
                    <strong>strongly encouraged</strong>
                    . The download link must lead to a page where the executable can be obtained,
                    such as a repository release.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Games:</strong>
                    Your game must be playable directly in a web browser or available as a
                    downloadable executable. Platforms such as
                    <ULink
                        href="https://itch.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="underline"
                    >
                        itch.io
                    </ULink>
                    may be used to host browser-playable games or downloads.
                </li>
                <li>
                    <strong class="text-blue-700 dark:text-blue-300">Mobile applications:</strong>
                    Your application must be published in the appropriate app store or made readily
                    available through an APK installer for Android or an IPA installer for iOS. The
                    demonstration URL must lead to the app store listing or a page providing the
                    installation file.
                </li>
            </ul>
            <p>
                If a desktop application supports only one operating system, its demonstration video
                must include a thorough visual walkthrough of the application's functionality. This
                helps judges understand the complete experience even if they cannot run the
                application on their own devices.
            </p>
            <h3 class="text-xl font-semibold">2.3. Accessibility and Evaluation Requirements</h3>
            <p>
                We want judges and community members to be able to experience your work without
                unnecessary effort. A project should be straightforward to access and use, even for
                someone who has never seen it before.
            </p>
            <p>You must not require judges to:</p>
            <ul class="list-disc list-inside ml-4 space-y-2">
                <li>Create an account on an unrelated third-party platform.</li>
                <li>Purchase hardware or pay for access to your project.</li>
                <li>Install uncommon or unnecessary software just to evaluate it.</li>
                <li>Complete unreasonable setup steps before seeing the main features.</li>
            </ul>
            <p>
                If your project depends on specific hardware, peripherals, or a particular
                environment that judges may not have, you must provide a complete visual
                demonstration in your video. The video must still follow all audio and anonymity
                requirements described in Phase 3.
            </p>
            <p>
                A project that is difficult to access or evaluate may receive significant penalties,
                even if its underlying implementation is technically impressive.
            </p>
        </section>

        <section id="phase-3" class="space-y-4">
            <h2 class="text-3xl font-bold">Phase 3: Prepare and Submit Your Project</h2>
            <p>
                Before submitting, make sure that your repository, documentation, demonstration, and
                supporting materials are complete. The following requirements are mandatory unless
                explicitly marked otherwise.
            </p>
            <h3 class="text-xl font-semibold">3.1. Public Source Code Repository</h3>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">Required.</strong>
                Your complete project source code must be hosted in a publicly accessible repository
                on a recognized version control platform.
            </p>
            <p>Acceptable platforms include, but are not limited to:</p>
            <ul class="list-disc list-inside ml-4 space-y-1">
                <li>
                    <ULink href="https://github.com" target="_blank" rel="noopener noreferrer">
                        GitHub
                    </ULink>
                </li>
                <li>
                    <ULink
                        href="https://about.gitlab.com"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        GitLab
                    </ULink>
                </li>
                <li>
                    <ULink href="https://codeberg.org" target="_blank" rel="noopener noreferrer">
                        Codeberg
                    </ULink>
                </li>
                <li>
                    <ULink href="https://gitee.com" target="_blank" rel="noopener noreferrer">
                        Gitee
                    </ULink>
                </li>
            </ul>
            <p>
                Any other platform is acceptable if it allows the public to browse and clone the
                complete repository without requiring authentication or payment.
            </p>
            <p>
                Your repository must contain the actual source code needed to understand and
                reproduce your project.
                <strong class="text-blue-700 dark:text-blue-300">
                    Providing only a compiled executable, a compressed archive, or another opaque
                    form of delivery is not an acceptable substitute for a public source repository.
                </strong>
            </p>
            <p>
                The repository must remain publicly accessible for evaluation. Do not make it
                private, remove essential files, or restrict access while judging is in progress.
            </p>
            <h3 class="text-xl font-semibold">3.2. README Documentation</h3>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">Required.</strong>
                Every repository must contain a file named
                <code
                    class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                >
                    README.md
                </code>
                . It must be written in clear, professional American English and organized so that
                someone unfamiliar with your project can understand it.
            </p>
            <p>Your README must include all of the following:</p>
            <ul class="list-disc list-inside ml-4 space-y-2">
                <li>
                    <strong>Project description:</strong>
                    A concise explanation of what your project does and what problem, idea, or
                    purpose it addresses.
                </li>
                <li>
                    <strong>Usage instructions:</strong>
                    Clear instructions explaining how to access and use the project. Include the
                    live website link, download link, setup instructions, or a combination of these
                    where appropriate.
                </li>
                <li>
                    <strong>Technology list:</strong>
                    A list of the main programming languages, libraries, frameworks, and other
                    technologies used.
                </li>
                <li>
                    <strong>Demonstration video:</strong>
                    A direct link to the valid demonstration video described in Section 3.3.
                </li>
            </ul>
            <p>
                Any important limitations that affect evaluation, including account requirements or
                platform restrictions, must also be stated clearly.
            </p>
            <h3 class="text-xl font-semibold">3.3. Demonstration Video</h3>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">Required.</strong>
                Every submission must include a demonstration video that clearly presents the main
                features and functionality of the project.
            </p>
            <p>
                The video must meet
                <strong class="text-blue-700 dark:text-blue-300">all</strong>
                of the following requirements:
            </p>
            <div class="space-y-3">
                <div>
                    <p class="font-semibold text-blue-700 dark:text-blue-300">A. Duration</p>
                    <p>
                        The video must be between
                        <strong>two and three minutes long</strong>
                        . Videos outside this range do not satisfy the requirement.
                    </p>
                </div>
                <div>
                    <p class="font-semibold text-blue-700 dark:text-blue-300">
                        B. No Audio or Personal Identification
                    </p>
                    <p>
                        <strong class="text-red-600 dark:text-red-300">
                            The video must contain absolutely no audio.
                        </strong>
                        This includes narration, speech, music, sound effects, system audio, and
                        other recorded sounds.
                    </p>
                    <p>
                        The video must not reveal the identity of any participant. This includes
                        faces, names, voices, and other personal identifying information.
                    </p>
                    <p>
                        Any violation of these anonymity requirements will result in immediate
                        disqualification.
                    </p>
                </div>
                <div>
                    <p class="font-semibold text-blue-700 dark:text-blue-300">C. Video Encoding</p>
                    <p>The video must use one of the following codecs:</p>
                    <ul class="list-disc list-inside ml-4">
                        <li>H.264</li>
                        <li>AV1</li>
                        <li>VP9</li>
                    </ul>
                    <p>
                        No other codecs are permitted. Examples of unacceptable formats include HEVC
                        and ProRes.
                    </p>
                </div>
                <div>
                    <p class="font-semibold text-blue-700 dark:text-blue-300">
                        D. Approved Hosting Platforms
                    </p>
                    <p>The video must be hosted on one of these platforms:</p>
                    <ul class="list-disc list-inside ml-4">
                        <li>YouTube</li>
                        <li>Bilibili</li>
                        <li>OneDrive or SharePoint</li>
                    </ul>
                    <p>
                        You must provide a publicly accessible, view-only sharing link. Anyone with
                        the link must be able to watch the video without requesting permission or
                        signing in.
                    </p>
                    <p>
                        Before submitting, open the link in an incognito or private browser window
                        to confirm that it works.
                    </p>
                    <p>
                        <strong class="text-red-600 dark:text-red-300">
                            A private, broken, or access-restricted link will be treated as a
                            missing video and will result in disqualification.
                        </strong>
                    </p>
                </div>
                <div>
                    <p class="font-semibold text-blue-700 dark:text-blue-300">
                        E. No Git-Based Video Hosting
                    </p>
                    <p>
                        <strong class="text-red-600 dark:text-red-300">
                            Uploading the demonstration video to GitHub or any other Git-based
                            hosting platform is strictly forbidden.
                        </strong>
                    </p>
                    <p>
                        A video hosted on a Git-based platform will be treated as if no valid video
                        had been submitted, resulting in disqualification.
                    </p>
                    <p>
                        This rule helps protect shared development infrastructure. Large video files
                        can consume unnecessary repository storage and make it harder for other
                        developers to use the services they depend on. Choosing an appropriate video
                        hosting service is a small but important part of responsible development.
                    </p>
                </div>
                <div>
                    <p class="font-semibold text-blue-700 dark:text-blue-300">
                        F. Required SHA-256 Checksum
                    </p>
                    <p>
                        If your project includes a downloadable executable, you must display the
                        executable's
                        <strong>SHA-256 checksum</strong>
                        clearly in the demonstration video.
                    </p>
                    <p>
                        The checksum allows judges to verify that the executable they download is
                        the same file shown in your demonstration.
                    </p>
                    <p>
                        If the checksum does not match and you cannot provide a valid explanation,
                        the executable will be treated as potentially malicious. Confirmed malware
                        will be handled under the rules in Section 5.3.
                    </p>
                </div>
                <div>
                    <p class="font-semibold text-blue-700 dark:text-blue-300">
                        G. Required Walkthrough for Single-Platform Desktop Apps
                    </p>
                    <p>
                        If your desktop application supports only one operating system, the
                        demonstration video must include a thorough visual walkthrough of its
                        functionality.
                    </p>
                    <p>
                        This walkthrough must make the application's main features and overall
                        experience clear, even if a judge cannot run it directly.
                    </p>
                </div>
            </div>
            <h3 class="text-xl font-semibold">3.4. Intermediate Build Artifacts</h3>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">
                    Encouraged, but not required.
                </strong>
                If your project is written in a language that compiles to native code or bytecode,
                we encourage you to include human-verifiable intermediate build artifacts in your
                repository.
            </p>
            <p>Examples include:</p>
            <ul class="list-disc list-inside ml-4 space-y-1">
                <li>
                    <code
                        class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    >
                        .asm
                    </code>
                    assembly files
                </li>
                <li>
                    <code
                        class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    >
                        .ll
                    </code>
                    LLVM Intermediate Representation files
                </li>
                <li>
                    <code
                        class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    >
                        .class
                    </code>
                    Java bytecode files
                </li>
                <li>Other comparable intermediate representations</li>
            </ul>
            <p>
                These files can help judges understand how your source code is translated into
                executable instructions and provide another way to verify the relationship between
                your implementation and the demonstrated behavior.
            </p>
            <p>
                Including such artifacts is not mandatory, but doing so demonstrates an additional
                level of transparency and may be viewed positively during evaluation.
            </p>
            <h3 class="text-xl font-semibold">3.5. Optional Extended Project Description</h3>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">Optional.</strong>
                In addition to the required README, you may submit a separate, more detailed written
                description of your project.
            </p>
            <p>
                This document can explain your design decisions, implementation details, technical
                challenges, development process, and other features that may not be immediately
                clear from the demonstration video.
            </p>
            <p>
                A well-prepared extended description may strengthen your submission by helping
                judges understand the reasoning and work behind your project. It is not a substitute
                for any mandatory requirement.
            </p>
            <h3 class="text-xl font-semibold">3.6. Final Submission Check</h3>
            <p>Before submitting, verify that:</p>
            <ul class="list-disc list-inside ml-4 space-y-2">
                <li>Your source code repository is public and complete.</li>
                <li>Your README contains all required information.</li>
                <li>Your project can be accessed or downloaded through the demo URL.</li>
                <li>Your demonstration video is between two and three minutes long.</li>
                <li>The video contains no audio or personal identification.</li>
                <li>The video uses an approved codec and hosting platform.</li>
                <li>The video link works without signing in or requesting access.</li>
                <li>The video is not hosted on a Git-based platform.</li>
                <li>Your SHA-256 checksum is shown if you provide an executable.</li>
                <li>Your AI usage disclosure is complete and accurate.</li>
                <li>Your project complies with the originality and licensing requirements.</li>
            </ul>
        </section>

        <section id="phase-4" class="space-y-4">
            <h2 class="text-3xl font-bold">
                Phase 4: Judging, Verification, and Live Presentations
            </h2>
            <p>
                Every submission will undergo preliminary evaluation according to the competition
                judging rubric. In addition, the organizers may invite certain teams to participate
                in a live presentation and question-and-answer session.
            </p>
            <p>
                This additional phase serves two purposes: verifying the integrity of submissions
                and confirming that prize candidates understand and can demonstrate their work.
            </p>
            <h3 class="text-xl font-semibold">4.1. Preliminary Judging</h3>
            <p>
                Judges will evaluate submissions according to the competition rubric. They may
                consider the project's functionality, implementation, originality, relevance to the
                theme, accessibility, documentation, and other criteria specified in the rubric.
            </p>
            <p>
                Meeting the minimum submission requirements does not guarantee a high score or an
                award. The quality and substance of the project remain important.
            </p>
            <h3 class="text-xl font-semibold">
                4.2. Verification of AI Usage and Project Ownership
            </h3>
            <p>
                If a majority of the judges believe that a submission shows signs of excessive,
                undeclared AI use, the team will be asked to present the project and explain how it
                was developed.
            </p>
            <p>
                The organizers may use AI-detection methods, now or in the future, as part of their
                review to identify possible excessive or undeclared AI use and work that appears to
                rely on unchecked AI-generated material.
            </p>
            <p>
                During the presentation, participants may be asked to explain their implementation,
                demonstrate important features, describe technical decisions, and answer questions
                about their source code.
            </p>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">
                    Responsible, properly disclosed AI use is permitted and does not, by itself,
                    trigger this verification process.
                </strong>
            </p>
            <p>
                Participation in a requested verification session is mandatory. Refusing to
                participate will result in automatic disqualification.
            </p>
            <h3 class="text-xl font-semibold">4.3. Live Presentations for Prize Recipients</h3>
            <p>
                All projects selected for any of the following awards must complete a live
                presentation:
            </p>
            <ul class="list-disc list-inside ml-4 space-y-1">
                <li>First Prize</li>
                <li>Second Prize</li>
                <li>Third Prize</li>
                <li>Honorable Mention</li>
            </ul>
            <p>
                During this presentation, the team must demonstrate that it understands its project
                and can explain the work it has submitted.
            </p>
            <p>
                If a prize candidate refuses to participate or cannot adequately demonstrate
                ownership and understanding of the project, the team will lose its prize eligibility
                and will instead be treated as a regular, non-prize submission.
            </p>
            <p>
                This requirement applies to every prize category listed above, including Honorable
                Mention.
            </p>
            <h3 class="text-xl font-semibold">4.4. Final Recognition</h3>
            <p>
                The competition awards First Prize, Second Prize, and Third Prize, each of which
                carries a guaranteed prize. Honorable Mentions may also be awarded, although they
                are not guaranteed to include a monetary award.
            </p>
            <p>
                The exact monetary value of each prize is
                <strong class="text-blue-700 dark:text-blue-300">
                    tentative and subject to confirmation
                </strong>
                . The organizers nevertheless intend to provide meaningful recognition to the
                selected projects.
            </p>
        </section>

        <section id="phase-5" class="space-y-4">
            <h2 class="text-3xl font-bold">
                Phase 5: Licensing, Public Showcase, and Project Rights
            </h2>
            <p>
                Submitting a project involves more than providing source code and a demonstration.
                Participants must also understand how their code may be licensed, how their projects
                may be presented publicly, and which rights they grant to the organizers.
            </p>
            <h3 class="text-xl font-semibold">5.1. Source-Code License</h3>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">
                    An explicit open-source license is strongly encouraged.
                </strong>
                Every participant should include a valid license file in the project repository,
                such as
                <code
                    class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                >
                    LICENSE
                </code>
                or
                <code
                    class="rounded bg-gray-100 px-1 py-0.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                >
                    LICENSE.md
                </code>
                .
            </p>
            <p>
                If your repository contains a valid license file specifying an OSI-approved
                open-source license, that license will govern your project source code. Examples
                include:
            </p>
            <ul class="list-disc list-inside ml-4 space-y-1">
                <li>MIT License</li>
                <li>GNU General Public License (GPL)</li>
                <li>Apache License 2.0</li>
                <li>BSD licenses</li>
            </ul>
            <p>
                <strong class="text-blue-700 dark:text-blue-300">
                    Default MIT License provision:
                </strong>
                If your repository does not contain an explicit, valid license file at the time of
                submission, you agree that your own project source code is automatically made
                available under the terms of the MIT License.
            </p>
            <p>
                This provision is intended to ensure that the community can study, use, and build
                upon submitted work when no other open-source license has been specified. The rights
                granted by third-party libraries, assets, and other materials remain subject to
                their respective licenses.
            </p>
            <h3 class="text-xl font-semibold">5.2. License to Showcase Submitted Projects</h3>
            <p>
                By submitting a project to {{ WEBSITE_NAME }}, you grant the organizers a
                <strong class="text-blue-700 dark:text-blue-300">
                    non-exclusive, worldwide, royalty-free, perpetual, irrevocable, and
                    sublicensable license
                </strong>
                to use, reproduce, modify, adapt, publish, translate, create derivative works from,
                distribute, and publicly display your submitted project, in whole or in part,
                through any medium.
            </p>
            <p>
                This license is granted solely for the purpose of advertising, promoting, and
                showcasing the competition and its results.
            </p>
            <p>
                This showcase license is separate from the source-code license you choose for your
                repository. It does not prevent you from continuing to develop, distribute, or
                license your own project under the terms you select.
            </p>
            <p>
                The license also allows the organizers to authorize others to use the relevant
                material for the same promotional and showcase purposes.
            </p>
            <h3 class="text-xl font-semibold">5.3. Malware, Deception, and Academic Integrity</h3>
            <p>
                Software intended to harm, disrupt, damage, or gain unauthorized access to any
                system is strictly prohibited. Participants must not submit malware or use deceptive
                methods to gain an unfair advantage.
            </p>
            <p>Examples of prohibited conduct include, but are not limited to:</p>
            <ul class="list-disc list-inside ml-4 space-y-2">
                <li>Submitting software designed to harm users or systems.</li>
                <li>Attempting to access systems or data without authorization.</li>
                <li>
                    Providing source code that deliberately misrepresents the submitted executable.
                </li>
                <li>Providing misleading or unexplained SHA-256 checksum information.</li>
                <li>
                    Making false claims about the use of AI tools or the originality of submitted
                    work.
                </li>
                <li>
                    Deliberately misleading judges about the functionality or authorship of a
                    project.
                </li>
            </ul>
            <p>
                Confirmed incidents will be treated as serious misconduct and academic dishonesty
                and will be reported to the upper school administration.
            </p>
            <p>
                Such conduct is not simply a violation of competition rules. It also violates the
                trust and safety expected of everyone participating in this community.
            </p>
            <h3 class="text-xl font-semibold">5.4. Public Listing of Participants and Projects</h3>
            <p>
                By entering the competition, you agree that your project may be included in the
                final public showcase of {{ WEBSITE_NAME }}.
            </p>
            <p>
                The showcase may appear on the competition website, in promotional materials, or in
                press releases. It may include your project name, a brief project description, and
                other relevant presentation materials.
            </p>
            <p>
                Participants who have legitimate privacy concerns must contact the organizers at
                least
                <strong>24 hours before the submission deadline</strong>
                . Requests will be considered by the organizers. If a participant requests that
                their project not be included in the public showcase and the request is accepted
                under the withdrawal procedure below, the submission will be disqualified.
            </p>
            <h3 class="text-xl font-semibold">5.5. Withdrawal of Showcase Consent</h3>
            <p>
                If you do not wish to grant the organizers permission to showcase your project, you
                must contact the organizers with a legitimate reason at least
                <strong>24 hours before the competition submission deadline</strong>
                .
            </p>
            <p>
                If the request is accepted, your submission will be disqualified from the
                competition.
            </p>
            <p>
                If you attempt to withdraw showcase consent without meeting the stated deadline and
                requirements, the license granted in Section 5.2 will remain in full force and
                effect.
            </p>
            <h3 class="text-xl font-semibold">5.6. Ownership and Permissions</h3>
            <p>
                By submitting your project, you represent and warrant that you are the owner of all
                rights necessary to submit the work and grant the permissions described in this
                document, or that you have obtained all necessary permissions and licenses from the
                relevant rights holders.
            </p>
            <p>
                You also confirm that your submission does not violate the intellectual property
                rights of any third party or any applicable law.
            </p>
            <h3 class="text-xl font-semibold">5.7. No Obligation to Use Submitted Work</h3>
            <p>
                The organizers are under no obligation to exercise any of the rights granted through
                the showcase license. Receiving permission to use submitted material does not
                require the organizers to publish, promote, distribute, or otherwise use it.
            </p>
            <h3 class="text-xl font-semibold">5.8. Compensation</h3>
            <p>
                Participants agree that they will receive no compensation for the use of their
                projects under the showcase license beyond any prizes explicitly awarded by the
                competition.
            </p>
        </section>

        <section id="phase-6" class="space-y-4">
            <h2 class="text-3xl font-bold">Phase 6: General Terms and Responsibilities</h2>
            <h3 class="text-xl font-semibold">6.1. Financial Responsibility</h3>
            <p>
                Participants are responsible for all costs and expenses they incur while preparing
                for or taking part in the competition.
            </p>
            <p>This includes, but is not limited to:</p>
            <ul class="list-disc list-inside ml-4 space-y-1">
                <li>Fees for third-party software and online services.</li>
                <li>Cloud computing, hosting, and server expenses.</li>
                <li>AI tool subscriptions and usage fees.</li>
                <li>Hardware, peripherals, and other equipment.</li>
                <li>Any other development or participation expenses.</li>
            </ul>
            <p>
                The organizers are not responsible for reimbursing these expenses. Any possible
                reimbursement of offline-event costs is
                <strong class="text-blue-700 dark:text-blue-300">
                    tentative and not guaranteed
                </strong>
                . Participants should plan their budgets accordingly and should not assume that any
                expense will be covered.
            </p>
            <h3 class="text-xl font-semibold">6.2. Limitation of Liability</h3>
            <p>
                To the extent permitted by applicable law, the organizers shall not be liable for
                any direct, indirect, incidental, special, or consequential damages arising from
                participation in the competition.
            </p>
            <p>
                This includes, but is not limited to, loss of data, profits, business opportunities,
                or other losses resulting from participation, project development, submission, or
                the use of third-party services.
            </p>
            <p>
                The organizers provide no express or implied warranties regarding the competition,
                judging process, or prizes. Participants submit their projects and take part in the
                competition at their own risk.
            </p>
            <h3 class="text-xl font-semibold">6.3. Changes to the Competition and Rules</h3>
            <p>
                The organizers reserve the right to modify, suspend, or cancel the competition at
                any time for any reason. They may also amend these rules when necessary and will
                provide reasonable notice of changes.
            </p>
            <p>
                The organizers are responsible for interpreting and applying these rules. Their
                decisions regarding the competition and the interpretation of its requirements are
                <strong class="text-blue-700 dark:text-blue-300">final and binding</strong>
                .
            </p>
            <p>
                If any provision of these rules is found to be invalid or unenforceable, the
                remaining provisions will continue to apply to the fullest extent permitted by
                applicable law.
            </p>
            <h3 class="text-xl font-semibold">6.4. Contact and Clarification</h3>
            <p>
                If you have questions about these rules, need clarification on a requirement, or
                wish to raise a concern regarding the competition, please contact the organizers
                through email or Microsoft Teams:
            </p>
            <p>
                <a
                    href="mailto:devclub-bisz@basischina.com"
                    class="font-semibold text-blue-700 dark:text-blue-300 hover:underline dark:hover:text-blue-200"
                >
                    devclub-bisz@basischina.com
                </a>
            </p>
            <p>Members of the BISZ Developers' Club leadership will respond to inquiries.</p>
        </section>

        <footer class="my-8 text-center">
            <blockquote
                class="inline-block border-l-4 border-gray-300 dark:border-gray-600 pl-4 text-left italic"
            >
                <p class="mb-1">May careful work take root and grow,</p>
                <p class="mb-1">May curiosity guide what you know.</p>
                <p class="mb-1">May shared ideas help good work shine,</p>
                <p>And leave something useful for all in time.</p>
            </blockquote>
        </footer>
    </div>
</template>
