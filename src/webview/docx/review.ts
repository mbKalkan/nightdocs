import type { ViewerStrings } from '../../shared/protocol';
import { NOT_TEXT } from '../diff/marks';
import { icons } from '../icons';
import { describe, pick } from '../picker';
import type { RenderContext } from '../renderers/types';

interface WordComment {
  author: string;
  date: Date | undefined;
  /** The comment's paragraphs. */
  text: string[];
  /** Stands where the comment is anchored, and shows it. */
  button: HTMLButtonElement;
  /** Markers docx-preview leaves around the commented text. */
  start: Comment | undefined;
  end: Comment | undefined;
  range?: Range;
}

/** Comment ranges, and the one whose comment is open, for the CSS Custom Highlight API. */
const HIGHLIGHT = 'nd-comment';
const ACTIVE_HIGHLIGHT = 'nd-comment-active';

/** Space kept between a comment button and its popup. */
const GAP = 4;

/**
 * Comments and tracked changes the way Word shows them with "All Markup": insertions and
 * deletions marked, commented text highlighted, and a button there that shows the comment.
 * Comparisons read the text without them, as it reads with all changes accepted.
 */
export class WordReview {
  readonly changes: number;
  private readonly comments: WordComment[] = [];
  private visible = true;
  private context: RenderContext | undefined;
  private toggle: HTMLButtonElement | undefined;
  private popup: HTMLElement | undefined;
  /** The comment whose popup is open, and whether a click or the list opened it to stay. */
  private open: { comment: WordComment; pinned: boolean } | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    shown = true,
  ) {
    this.visible = shown;
    root.toggleAttribute('data-markup-hidden', !shown);
    for (const element of root.querySelectorAll('del, .docx-comment-popover')) {
      element.setAttribute(NOT_TEXT, '');
    }
    this.changes = root.querySelectorAll('ins, del').length;

    const markers = new Map<string, { start?: Comment; end?: Comment }>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const marker = /^(start|end) of comment #(.+)$/.exec((node as Comment).data);
      if (!marker) continue;
      const entry = markers.get(marker[2]) ?? {};
      entry[marker[1] as 'start' | 'end'] = node as Comment;
      markers.set(marker[2], entry);
    }

    for (const reference of root.querySelectorAll<HTMLElement>('.docx-comment-ref')) {
      // docx-preview writes `comment #0 by Author on 2026-10-01T09:30:00Z` before the reference.
      const info =
        reference.previousSibling instanceof Comment ? reference.previousSibling.data : '';
      const parsed = /^comment #(\S+)(?: by (.*?))?(?: on (\S+))?$/.exec(info);
      const popover = reference.nextElementSibling;
      const text = [...(popover?.querySelectorAll(':scope > p') ?? [])]
        .map((paragraph) => paragraph.textContent?.trim() ?? '')
        .filter(Boolean);
      const author = parsed?.[2] ?? '';
      const date = parsed?.[3] ? new Date(parsed[3]) : undefined;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nd-comment';
      button.innerHTML = icons.comment;
      button.setAttribute(NOT_TEXT, '');
      button.setAttribute(
        'aria-label',
        `${strings.commentBy.replace('{0}', author)}: ${text.join(' ')}`,
      );
      reference.replaceWith(button);
      const { start, end } = markers.get(parsed?.[1] ?? '') ?? {};
      this.comments.push({
        author,
        date: date && !Number.isNaN(date.getTime()) ? date : undefined,
        text,
        button,
        start,
        end,
      });
    }
  }

  get hasMarkup(): boolean {
    return this.comments.length > 0 || this.changes > 0;
  }

  get shown(): boolean {
    return this.visible;
  }

  /** Called once the document is on screen: its comments get their ranges and controls. */
  activate(context: RenderContext): void {
    this.context = context;
    // Ranges are taken now, as moving the content onto the screen would collapse them.
    for (const comment of this.comments) {
      if (!comment.start || !comment.end) continue;
      const range = document.createRange();
      range.setStartAfter(comment.start);
      range.setEndBefore(comment.end);
      comment.range = range;
    }
    for (const comment of this.comments) {
      const { button } = comment;
      button.addEventListener('mouseenter', () => this.show(comment, false));
      button.addEventListener('mouseleave', () => this.hideSoon());
      button.addEventListener('focus', () => this.show(comment, false));
      button.addEventListener('blur', () => this.hideSoon());
      button.addEventListener('click', () => this.show(comment, true));
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.open) this.hide();
    };
    const onScroll = () => {
      if (this.open?.pinned) this.place(this.open.comment);
      else this.hide();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        this.open &&
        !this.popup?.contains(target) &&
        !this.open.comment.button.contains(target)
      ) {
        this.hide();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    context.viewport.addEventListener('scroll', onScroll, { passive: true });
    this.cleanup.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      context.viewport.removeEventListener('scroll', onScroll);
    });
    this.addControls(context.footer);
    this.setShown(this.visible);
  }

  setShown(shown: boolean): void {
    this.visible = shown;
    this.root.toggleAttribute('data-markup-hidden', !shown);
    if (!shown) this.hide();
    this.highlight();
    if (this.toggle) {
      this.toggle.setAttribute('aria-pressed', String(shown));
      this.toggle.title = shown ? this.strings.hideMarkup : this.strings.showMarkup;
    }
  }

  dispose(): void {
    this.hide();
    this.cleanup.splice(0).forEach((fn) => fn());
    CSS.highlights.delete(HIGHLIGHT);
    CSS.highlights.delete(ACTIVE_HIGHLIGHT);
  }

  /** The status bar's comment list and the switch that shows or hides the markup. */
  private addControls(footer: HTMLElement): void {
    if (!this.hasMarkup) return;
    const { strings } = this;
    const button = (label: string, icon: string, onClick: () => void) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'ov-status-button';
      element.innerHTML = icon;
      element.append(label);
      element.addEventListener('click', onClick);
      return element;
    };
    const controls: HTMLElement[] = [];
    if (this.comments.length > 0) {
      const count = this.comments.length;
      const label =
        count === 1 ? strings.oneComment : strings.comments.replace('{0}', String(count));
      const list = button(label, icons.comment, () => void this.pickComment());
      list.title = strings.goToComment.replace('{0}', String(count));
      controls.push(list);
    }
    this.toggle = button(strings.markup, icons.eye, () => this.setShown(!this.visible));
    controls.push(this.toggle);
    footer.append(...controls);
    footer.hidden = false;
    this.cleanup.push(() => controls.forEach((control) => control.remove()));
  }

  /** Lists the comments to pick one from, and opens the one picked where it is. */
  private async pickComment(): Promise<void> {
    const format = new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium' });
    const index = await pick(
      this.strings.goToComment.replace('{0}', String(this.comments.length)),
      this.comments.map((comment) => ({
        label: comment.text.join(' '),
        description: describe(comment.author, comment.date && format.format(comment.date)),
      })),
    );
    if (index === undefined || !this.context) return;
    const comment = this.comments[index];
    this.setShown(true);
    const { viewport } = this.context;
    const top = comment.button.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.scrollTop += top - viewport.clientHeight / 3;
    this.show(comment, true);
  }

  private highlight(): void {
    const ranges = this.comments.flatMap((comment) => (comment.range ? [comment.range] : []));
    if (this.visible && ranges.length > 0) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    else CSS.highlights.delete(HIGHLIGHT);
    const active = this.open?.comment.range;
    if (this.visible && active) CSS.highlights.set(ACTIVE_HIGHLIGHT, new Highlight(active));
    else CSS.highlights.delete(ACTIVE_HIGHLIGHT);
  }

  /** Opens a comment's popup; `pinned` keeps it open until Escape or a click elsewhere. */
  private show(comment: WordComment, pinned: boolean): void {
    clearTimeout(this.hideTimer);
    if (!this.context || !this.visible) return;
    if (this.open?.comment === comment) {
      this.open.pinned ||= pinned;
      return;
    }
    this.hide();
    const popup = document.createElement('div');
    popup.className = 'nd-comment-popup';
    popup.setAttribute('role', 'tooltip');
    const header = document.createElement('div');
    header.className = 'nd-comment-header';
    const author = document.createElement('span');
    author.className = 'nd-comment-author';
    author.textContent = comment.author;
    header.append(author);
    if (comment.date) {
      const date = document.createElement('span');
      date.className = 'nd-comment-date';
      date.textContent = new Intl.DateTimeFormat(this.locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(comment.date);
      header.append(date);
    }
    popup.append(header);
    for (const text of comment.text) {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      popup.append(paragraph);
    }
    popup.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    popup.addEventListener('mouseleave', () => this.hideSoon());
    this.context.overlay.append(popup);
    this.popup = popup;
    this.open = { comment, pinned };
    comment.button.setAttribute('aria-expanded', 'true');
    this.place(comment);
    this.highlight();
  }

  /** Puts the popup under the comment's button, or over it when there's no room below. */
  private place(comment: WordComment): void {
    const { popup, context } = this;
    if (!popup || !context) return;
    const overlay = context.overlay.getBoundingClientRect();
    const viewport = context.viewport.getBoundingClientRect();
    const anchor = comment.button.getBoundingClientRect();
    const left = Math.min(anchor.left, overlay.right - popup.offsetWidth - 8);
    const below = anchor.bottom + GAP + popup.offsetHeight <= viewport.bottom;
    const top = below ? anchor.bottom + GAP : anchor.top - GAP - popup.offsetHeight;
    popup.style.left = `${Math.max(8, left - overlay.left)}px`;
    popup.style.top = `${top - overlay.top}px`;
  }

  private hideSoon(): void {
    if (this.open?.pinned) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), 300);
  }

  private hide(): void {
    clearTimeout(this.hideTimer);
    this.open?.comment.button.removeAttribute('aria-expanded');
    this.popup?.remove();
    this.popup = undefined;
    this.open = undefined;
    this.highlight();
  }
}
