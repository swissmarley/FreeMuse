import type { ActionClass, ScopeDef } from '@muse/core';

export interface OperationDef { connector: string; operation: string; actionClass: ActionClass; scope: string | null; label: string }

const mailScopes: ScopeDef[] = [
  { id: 'read', label: 'Read email', description: 'Search and read your messages', classes: ['read'] },
  { id: 'compose', label: 'Write drafts', description: 'Create drafts you can review', classes: ['draft'] },
  { id: 'send', label: 'Send email', description: 'Send email on your behalf (always asks first)', classes: ['send'] },
];
const calScopes: ScopeDef[] = [
  { id: 'read', label: 'See events', description: 'Read your calendar', classes: ['read'] },
  { id: 'write', label: 'Create & edit events', description: 'Add events and send invites (asks first)', classes: ['write'] },
];
const driveScopes: ScopeDef[] = [{ id: 'read', label: 'Read files', description: 'Search and read your files', classes: ['read'] }];

export const CONNECTOR_SCOPES: Record<string, ScopeDef[]> = {
  gmail: mailScopes,
  demo_mail: mailScopes,
  gcal: calScopes,
  demo_calendar: calScopes,
  gdrive: driveScopes,
};

const mailOps = (c: string): OperationDef[] => [
  { connector: c, operation: 'search_email', actionClass: 'read', scope: 'read', label: 'Search email' },
  { connector: c, operation: 'read_email', actionClass: 'read', scope: 'read', label: 'Read an email' },
  { connector: c, operation: 'draft_email', actionClass: 'draft', scope: 'compose', label: 'Create a draft' },
  { connector: c, operation: 'send_email', actionClass: 'send', scope: 'send', label: 'Send an email' },
];
const calOps = (c: string): OperationDef[] => [
  { connector: c, operation: 'list_events', actionClass: 'read', scope: 'read', label: 'List events' },
  { connector: c, operation: 'create_event', actionClass: 'write', scope: 'write', label: 'Create an event' },
];

export const OPERATIONS: OperationDef[] = [
  ...mailOps('gmail'),
  ...mailOps('demo_mail'),
  ...calOps('gcal'),
  ...calOps('demo_calendar'),
  { connector: 'gdrive', operation: 'search_files', actionClass: 'read', scope: 'read', label: 'Search files' },
  { connector: 'gdrive', operation: 'read_file', actionClass: 'read', scope: 'read', label: 'Read a file' },
  { connector: 'browser', operation: 'submit', actionClass: 'send', scope: null, label: 'Submit a web form' },
  { connector: 'browser', operation: 'login', actionClass: 'login', scope: null, label: 'Log in with a saved password' },
  { connector: 'payments', operation: 'purchase', actionClass: 'spend', scope: null, label: 'Make a purchase' },
];

export function findOperation(connector: string, operation: string): OperationDef | undefined {
  return OPERATIONS.find((o) => o.connector === connector && o.operation === operation);
}
