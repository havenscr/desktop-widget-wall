import { tip } from '../ui/HoverTip';
import type { TaskTag } from './model';
import { TagGlyph } from './tagIcons';
import { tagVars } from './tagStyle';

/**
 * A row's tags as the owner chose for Around the house and Due today: each tag is its glyph alone
 * in a round 26 px pill, the glyph in the tag's colour on a tint of it, 4 px apart. The names are
 * in the hover card: one card on the tags lists every tag of the row, with its glyph and name.
 * Tags are not buttons: a click goes through to the row.
 */
export function TaskTags({ tags }: { tags?: TaskTag[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="t-tags" {...tip(() => <TagTip tags={tags} />)}>
      {tags.map((tag, i) => (
        <span
          key={`${tag.label}-${i}`}
          className={['t-tag', 't-dot', tag.color ? '' : 't-none'].filter(Boolean).join(' ')}
          style={tagVars(tag)}
          role="img"
          aria-label={tag.label}
        >
          <TagGlyph name={tag.icon} size={16} />
        </span>
      ))}
    </span>
  );
}

/** The hover card of a row's tags: a line per tag, glyph and name in the tag's colour. */
function TagTip({ tags }: { tags: TaskTag[] }) {
  return (
    <span className="t-tip">
      {tags.map((tag, i) => (
        <span key={`${tag.label}-${i}`} className={['t-tip-row', tag.color ? '' : 't-none'].filter(Boolean).join(' ')} style={tagVars(tag)}>
          <TagGlyph name={tag.icon} size={18} />
          <span className="t-tip-name">{tag.label}</span>
        </span>
      ))}
    </span>
  );
}
