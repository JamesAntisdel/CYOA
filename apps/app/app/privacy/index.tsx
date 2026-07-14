import { LegalDocument, type LegalSection } from "../../components/legal/LegalDocument";

export const PRIVACY_EFFECTIVE = "Effective — placeholder draft, pending counsel review.";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "1. What we keep",
    body: [
      "We store only what the tale needs: an age range (never a birthday), a guest token or claimed email, your saves and the scenes within them, and the entitlements attached to your account.",
      "We do not ask for your real name to read. If you claim an account, we keep the email you provide so your saves follow you across devices.",
    ],
  },
  {
    heading: "2. What we measure",
    body: [
      "We record de-identified analytics events — funnel steps, turn counts, cost, and safety outcomes — to keep the service healthy. These are aggregate operator metrics; they never surface your prose.",
      "Safety classification runs on scene text to enforce the Content Policy. Classifier decisions are logged in redacted form, without the underlying prose.",
    ],
  },
  {
    heading: "3. AI processing",
    body: [
      "To generate a scene, the text of your run and your choices are sent to the AI model providers we use. Providers process this to return the next scene and are bound not to use it to train their models beyond what their terms allow.",
      "Do not enter real secrets, credentials, or another person's private information into a tale.",
    ],
  },
  {
    heading: "4. Who we share with",
    body: [
      "We share data with the infrastructure and model providers that run the service, and with the app store that processes your payments. We do not sell your personal data.",
      "Content you publish to the community shelf is visible to other readers by design; that is the point of publishing, and its visibility is governed by the privacy setting you choose at publish time.",
    ],
  },
  {
    heading: "5. Retention and deletion",
    body: [
      "We keep your saves while your account is active. You can delete individual saves or close your account; on closure we delete your saves and personal range data within a reasonable window, except records we must retain for legal, safety, or fraud reasons.",
      "Reports you file and moderation records are retained so we can act on repeat abuse.",
    ],
  },
  {
    heading: "6. Children",
    body: [
      "The service is not directed to children under 13, and the age gate blocks guest saves for that range. If we learn we have collected data from a child under 13, we delete it.",
    ],
  },
  {
    heading: "7. Your choices",
    body: [
      "You can change your reader and mature-content settings in-app at any time, and you can request access to or deletion of your data through the support address in settings.",
      "Depending on where you live, you may have additional rights over your data; we honor those rights where they apply.",
    ],
  },
  {
    heading: "8. Changes and contact",
    body: [
      "We may update this Policy; material changes will be surfaced in-app. Reach us at the support address listed in the app's settings for any privacy question.",
    ],
  },
];

export default function PrivacyRoute() {
  return (
    <LegalDocument
      kicker="what the keeper knows"
      title="Privacy Policy"
      effective={PRIVACY_EFFECTIVE}
      intro="We keep as little as the tale needs and no birthday at all. This is what we hold, why we hold it, and how to make us let it go."
      sections={PRIVACY_SECTIONS}
    />
  );
}
