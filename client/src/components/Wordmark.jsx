import { BRAND } from "../config/brand";

/**
 * The name, drawn the one way it is drawn.
 *
 * Five screens each held their own copy of this markup, which is how a rename
 * turns into a hunt. Size and colour still belong to the caller, because the
 * navbar, the dark sign in panel and the footer are genuinely different; the
 * spelling and the two tone split do not.
 */
const Wordmark = ({ className = "", accent = "text-clay" }) => (
  <span className={className}>
    {BRAND.lead}
    <span className={accent}>{BRAND.tail}</span>
  </span>
);

export default Wordmark;
