// "Use sample policy" on the start screen: the Proclinical Content Governance Ruleset
// (from Proclinical Brand Guidelines 2021), written out as text so every rule - including the
// voice and sub-brand rules that are pictures in the PDF - reaches the live checks and the AI audit.
export const SAMPLE_POLICY = {
  name: "Proclinical governance ruleset (sample)",
  pages: 3,
  text: `Platform Governance Ruleset: Proclinical
Target environment: PUBLIVRA AI automated brand governance. Source document: Proclinical Brand Guidelines (2021).
Purpose: structured rules for AI content analysis - tone, terminology and sub-brand routing.

1. TERMINOLOGY & LEXICON CONTROLS
Flag restricted vocabulary and suggest the approved alternative. Proclinical are long-term partners, not a transactional sales business.
Restricted term (flag) | Approved alternative (suggest) | Governance reason
Client | Partner | Reinforces long-term relationships over transactional business.
Deals, Placements | Included in the team, Helped a company grow | Avoids commoditising people; keeps an empathetic tone.
Candidate (if not currently hiring) | Job-seeker, Applicant | Respects the person's status outside a pipeline.
Incentive, Commission, Fee, Targets, | Remove or rephrase based on context | Restricted recruitment and sales jargon.
Budgets, KPIs | Remove or rephrase based on context | Restricted recruitment and sales jargon.
Secure, Secured, Securing, Won | Partnered with, Joined | Prevents aggressive, boastful or competitive language.
Humble, Humbled | Omit or rephrase | The brand voice is quietly confident, not falsely modest or boastful.

2. BRAND VOICE & SEMANTIC RULES
Rule 2.1 Collective identity (automated check): flag third-person references to the brand such as "Proclinical uses its" or "Proclinical offers". The brand speaks as a collective of people with "we", "us" and "our", not as a corporate entity.
Avoid phrases such as "Proclinical uses its", "Proclinical offers", "Proclinical Consulting uses its".
Rule 2.2 Purpose-first sequencing (automated check): messaging begins with the "why" before the "what" or "how". Example: "We help you grow so you can reach your goals faster. Our suite of services includes..."
Rule 2.3 Tone limits (human-in-the-loop review): the tone must be professional - personable and self-assured, never over-familiar, matey or aggressively salesy.
Avoid phrases such as "we've got your back", "sit back and let us", "at your fingertips", "got you covered".
Avoid phrases such as "the only search firm", "no problem or project we can't handle", "beat the competition", "aggressive".
Flag colloquialisms and overly bold claims for human review with a moderation prompt.

3. SUB-BRAND CONTEXTUAL GOVERNANCE
Route rules by the declared sub-brand: what is compliant for one division can be a violation for another.
Proclinical Staffing - tone target: approachable, inclusive, highly empathetic, energetic. Restricted: stiff corporate language such as "Proclinical offers bespoke staffing solutions".
Proclinical Executive - tone target: informative, considered, expertise-driven, mitigates risk. Restricted: empty bold statements and language that treats executives as commodities, such as "expert talent at your fingertips".
Proclinical Consulting - tone target: highly technical; complex scientific terminology is permitted; knowledgeable. Restricted: casual language and sweeping generalisations such as "there is no problem we can't handle".
Proclinical Engage - tone target: empathetic, agile, tailored. Language implies listening rather than telling: "advise", "guide", "support".`,
};
