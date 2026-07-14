import { LegalDocument, type LegalSection } from "../../components/legal/LegalDocument";

export const CONTENT_POLICY_EFFECTIVE = "Effective — placeholder draft, pending counsel review.";

export const CONTENT_POLICY_SECTIONS: LegalSection[] = [
  {
    heading: "1. The line we hold",
    body: [
      "This shelf carries dark fiction — dread, peril, and grim endings are welcome. But some content is never allowed, whatever the story, and whatever the age gate says.",
      "This policy governs everything you publish to the community shelf, everything you type into a tale, and everything the AI generates in response.",
    ],
  },
  {
    heading: "2. Never allowed",
    body: [
      "Sexual content involving minors, in any form, real or fictional. This is reported and removed without exception.",
      "Content that sexualizes real, identifiable people without consent; credible threats of violence; incitement to terrorism; instructions for serious real-world harm; and the coordination of illegal activity.",
      "Hate that dehumanizes people for who they are, and harassment of a real, identifiable person.",
    ],
  },
  {
    heading: "3. Handled with care",
    body: [
      "Themes of self-harm and suicide are steered by the safety system toward a gentle, safe ending rather than depicted as instruction or encouragement. The candle stays lit.",
      "Mature themes — strong language, adult subject matter — are gated to verified adults who have opted in, and stay off by default. They are never available on the general-audience shelf.",
    ],
  },
  {
    heading: "4. How the AI is guided",
    body: [
      "Scene generation runs through a safety classifier before it reaches you. Blocked categories are redirected to a safe ending; mature categories are withheld unless your account is adult-verified and opted in.",
      "Attempting to jailbreak, prompt-inject, or otherwise coerce the generator into prohibited content is itself a breach of this policy.",
    ],
  },
  {
    heading: "5. Reporting and enforcement",
    body: [
      "Every published tale, community seed, and AI-generated scene carries a Report affordance. Reports reach a moderation queue that a keeper reviews.",
      "We may hide or take down content, revoke a published tale's access, and suspend or remove accounts. Serious violations — above all, content that exploits children — are preserved and referred to the authorities.",
    ],
  },
  {
    heading: "6. Appeals",
    body: [
      "If your content was actioned and you believe it was a mistake, you can reach the support address in the app's settings to ask for a review.",
    ],
  },
];

export default function ContentPolicyRoute() {
  return (
    <LegalDocument
      kicker="the shelf's rules"
      title="Content Policy"
      effective={CONTENT_POLICY_EFFECTIVE}
      intro="Dark fiction is welcome here; harm is not. This is the line between the two, and what happens when it is crossed."
      sections={CONTENT_POLICY_SECTIONS}
    />
  );
}
