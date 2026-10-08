import { createFileRoute } from "@tanstack/react-router";
import { SITE_HOME_URL } from "~/lib/seo";
import LandingPage from "~/components/LandingPage";

export const Route = createFileRoute("/")({
  head: () => ({ links: [{ rel: "canonical", href: SITE_HOME_URL }] }),
  component: LandingPage,
});
