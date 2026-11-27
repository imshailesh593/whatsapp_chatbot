/**
 * A saved message can carry a photo. While a reply is being put together the photo travels as a tag in front of the text it
 * belongs to; delivery takes the tag out and sends the photo with that text. Customers, prompts and chat logs never see it.
 */
const TAG_RE = /\[photo:([0-9a-f-]{36})\][ \t]*\n?/gi;

export const photoTag = (id: string) => `[photo:${id}]`;

export function takePhotos(text: string): { text: string; photos: string[] } {
  const photos: string[] = [];
  const rest = text.replace(TAG_RE, (_m, id: string) => {
    photos.push(id.toLowerCase());
    return '';
  });
  return { text: photos.length ? rest.trim() : text, photos };
}
