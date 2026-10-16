/**
 * The books a form offers.
 *
 * A paused marketplace account takes no new sales, so it is left out, unless
 * it is the book the record being edited is already in. Leaving it out then
 * would show the first choice in the box and quietly move the sale to the
 * counter the moment it was saved.
 */
export const channelChoices = (channels, current) =>
  channels.filter((c) => !c.paused || c.code === current);

/** The name of a book, for showing a record that is in it. */
export const channelLabel = (channels, code) =>
  channels.find((c) => c.code === code)?.label || code;
