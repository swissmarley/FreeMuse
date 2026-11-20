import { performAction } from '../gateway.js';
import { fn, pickConnector, S, SA, withDemo, type Tool } from './types.js';

const none = 'No calendar is connected. Ask the user to connect Google Calendar in Connections.';

export const calendarTools: Tool[] = [
  {
    def: fn('calendar_list', 'List calendar events in a time range (ISO 8601).', { from: S('Start, ISO date-time'), to: S('End, ISO date-time') }, ['from', 'to']),
    label: () => 'Checking your calendar',
    async run(ctx, a, callId) {
      const c = await pickConnector(ctx, withDemo('gcal', 'demo_calendar'));
      if (!c) return none;
      return performAction(ctx, { actionClass: 'read', connector: c, operation: 'list_events', payload: { from: String(a.from), to: String(a.to) }, title: 'List events', callId, sourceLabel: () => `calendar:${c}` });
    },
  },
  {
    def: fn('calendar_create', 'Create a calendar event (needs the user\'s approval; invites are sent to attendees).', { title: S('Event title'), start: S('ISO date-time'), end: S('ISO date-time'), location: S('Location'), notes: S('Notes'), attendees: SA('Attendee emails') }, ['title', 'start', 'end']),
    label: (a) => `Adding “${a.title}” to your calendar`,
    async run(ctx, a, callId) {
      const c = await pickConnector(ctx, withDemo('gcal', 'demo_calendar'));
      if (!c) return none;
      const payload = { title: String(a.title), start: String(a.start), end: String(a.end), location: String(a.location ?? ''), notes: String(a.notes ?? ''), attendees: a.attendees ?? [] };
      return performAction(ctx, { actionClass: 'write', connector: c, operation: 'create_event', payload, title: `Add event “${payload.title}” (${payload.start})`, callId });
    },
  },
];

export const driveTools: Tool[] = [
  {
    def: fn('drive_search', 'Search the user\'s Google Drive documents.', { query: S('Search words') }, ['query']),
    label: (a) => `Searching your files for “${a.query}”`,
    async run(ctx, a, callId) {
      if (!(await pickConnector(ctx, ['gdrive']))) return 'Google Drive is not connected.';
      return performAction(ctx, { actionClass: 'read', connector: 'gdrive', operation: 'search_files', payload: { query: String(a.query) }, title: 'Search files', callId, sourceLabel: () => 'drive-search' });
    },
  },
  {
    def: fn('drive_read', 'Read a Google Drive document as text.', { id: S('File id') }, ['id']),
    label: () => 'Reading a document',
    async run(ctx, a, callId) {
      if (!(await pickConnector(ctx, ['gdrive']))) return 'Google Drive is not connected.';
      return performAction(ctx, { actionClass: 'read', connector: 'gdrive', operation: 'read_file', payload: { id: String(a.id) }, title: 'Read file', callId, sourceLabel: () => `drive:${a.id}` });
    },
  },
];
