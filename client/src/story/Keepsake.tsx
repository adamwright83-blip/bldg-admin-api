/** The chapter's closing keepsake, as the server reveals it, set as a small printed card. */
export function Keepsake({
  chapterNumber,
  title,
  text,
  headingLevel = 2,
}: {
  chapterNumber: number;
  title: string;
  text: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="sh-keepsake" data-testid="story-keepsake">
      <p className="sh-keepsake-label">
        Kept from tonight <span>Chapter {String(chapterNumber).padStart(2, "0")}</span>
      </p>
      <Heading className="sh-keepsake-title">{title}</Heading>
      <p className="sh-keepsake-text">{text}</p>
    </article>
  );
}
