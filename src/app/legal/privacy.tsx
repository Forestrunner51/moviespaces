import { LegalDocument } from "@/frontend/components/legal-document";
import { PRIVACY_SECTIONS } from "@/frontend/constants/legal";

export default function PrivacyScreen() {
  return <LegalDocument title="Privacy Policy" sections={PRIVACY_SECTIONS} />;
}
