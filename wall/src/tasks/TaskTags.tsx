import { tip } from '../ui/HoverTip';
import type { TaskTag } from './model';
import { TagGlyph } from './tagIcons';
import { tagLayout, tagVars } from './tagStyle';

/**
 * A row's tags as the owner chose for Around the house: the first tag as a chip (its glyph
 * and name, in the tag's colour on a faint wash of it), each further tag as a round dot with
 * its glyph. `room` is the row's width for the title and the tags together; when the chip
 * would leave the title under 180 px, every tag is a dot. Every chip and dot has a hover
 * card with the tag's name. Tags are not buttons: a click goes through to the row.
 */
export function TaskTags({ tags, room }: { tags?: TaskTag[]; room: number }) {
  if (!tags || tags.length === 0) return null;
  const chip = tagLayout(tags, room) === 'chip';
  return (
    <span className="t-tags" data-layout={chip ? 'chip' : 'dots'}>
      {tags.map((tag, i) => {
        const named = chip && i === 0;
        const cls = ['t-tag', named ? 't-chip' : 't-dot', tag.color ? '' : 't-none'].filter(Boolean).join(' ');
        return (
          <span
            key={`${tag.label}-${i}`}
            className={cls}
            style={tagVars(tag)}
            {...tip(tag.label)}
            {...(named ? {} : { role: 'img', 'aria-label': tag.label })}
          >
            <TagGlyph name={tag.icon} size={16} />
            {named && <span className="t-label">{tag.label}</span>}
          </span>
        );
      })}
    </span>
  );
}
