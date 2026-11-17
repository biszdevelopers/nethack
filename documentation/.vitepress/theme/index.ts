import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "./style.css";

import Layout from "./Layout.vue";

import TerminalWindow from "./components/TerminalWindow.vue";
import StatusBadge from "./components/StatusBadge.vue";
import CopyButton from "./components/CopyButton.vue";
import CollapsibleDetails from "./components/CollapsibleDetails.vue";
import AnimatedCounter from "./components/AnimatedCounter.vue";
import InteractiveHero from "./components/InteractiveHero.vue";
import QuoteCycler from "./components/QuoteCycler.vue";
import EasterEggOverlay from "./components/EasterEggOverlay.vue";
import PackageVersions from "./components/PackageVersions.vue";
import TestCount from "./components/TestCount.vue";

import { useEasterEggs } from "./composables/useEasterEggs";

export default {
    extends: DefaultTheme,
    Layout,
    enhanceApp({ app }) {
        app.component("TerminalWindow", TerminalWindow);
        app.component("StatusBadge", StatusBadge);
        app.component("CopyButton", CopyButton);
        app.component("CollapsibleDetails", CollapsibleDetails);
        app.component("AnimatedCounter", AnimatedCounter);
        app.component("InteractiveHero", InteractiveHero);
        app.component("QuoteCycler", QuoteCycler);
        app.component("EasterEggOverlay", EasterEggOverlay);
        app.component("PackageVersions", PackageVersions);
        app.component("TestCount", TestCount);
    },
    setup() {
        useEasterEggs();
    },
} satisfies Theme;
