import { LegalDocument } from "@/frontend/components/legal-document";
import { TERMS_SECTIONS } from "@/frontend/constants/legal";

export default function TermsScreen() {
  return <LegalDocument title="Terms of Service" sections={TERMS_SECTIONS} />;
}
