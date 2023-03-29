export const VOCABULARY = {
  // Responses
  'telegram.unauthorized-user': 'Unauthorized user!',
  'telegram.usage': 'Usage',
  'telegram.invalid-config': 'Invalid configuration',
  'telegram.unknown-error': 'Sorry, an unknown error occurred :(',
  'telegram.unknown-command': 'Beep boop, don\'t undestand...',
  'telegram.help': 'Help',
  'telegram.chart-tags': 'Chart tags',
  'telegram.chart-error': 'Could not create a chart.',
  'telegram.actions-run': 'Actions (Run)',
  'telegram.actions-remove': 'Actions (Remove)',
  'telegram.actions-get': 'Actions (Get)',
  'telegram.action-added': 'Action added',
  'telegram.action-removed': 'Action removed',
  'telegram.action-running': 'Running',
  'telegram.action': (a: string) => `Action (${a})`,
  'telegram.notification': (n: string) => `Notification (${n})`,
  'telegram.notifications-get': 'Notifications (Get)',
  'telegram.notifications-remove': 'Notifications (Remove)',
  'telegram.notification-added': 'Notification added',
  'telegram.notification-removed': 'Notification removed',

  // Commands
  'telegram.command.start': 'Start a new conversation.',
  'telegram.command.help': 'GitHub command documentation.',
  'telegram.command.buckets': 'List InfluxDB buckets.',
  'telegram.command.measurements': 'List InfluxDB measurements.',
  'telegram.command.fields': 'List InfluxDB fields.',
  'telegram.command.tags': 'List InfluxDB tags.',
  'telegram.command.tag': 'List InfluxDB tag values.',
  'telegram.command.get': 'Get latest values from InfluxDB.',
  'telegram.command.chart': 'Create chart visualization.',
  'telegram.command.actions': 'Run saved action.',
  'telegram.command.actions_get': 'View saved action.',
  'telegram.command.actions_add': 'Save new action.',
  'telegram.command.actions_remove': 'Remove saved action.',
  'telegram.command.notifications': 'View current notification.',
  'telegram.command.notifications_add': 'Add new notification.',
  'telegram.command.notifications_remove': 'Remove notification.',

  // Influx terms
  'influx.buckets': 'Buckets',
  'influx.measurements': 'Measurements',
  'influx.measurements-not-found': 'No measurements found.',
  'influx.fields': 'Fields',
  'influx.fields-not-found': 'No fields found.',
  'influx.tags': 'Tags',
  'influx.tags-not-found': 'No tags found.',
  'influx.tag-values': (t: string) => `Tag (\`${t}\`)`,
  'influx.tags-values-not-found': 'No tag values found.',
  'influx.values': 'Values',
  'influx.values-not-found': 'No values found.'
} as const
