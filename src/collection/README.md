# Collection Layer / 采集层

Owns source onboarding concepts, connector registry, platform connectors, webhooks, scheduled sync, manual sync, and first-party tracking.

- `connectors/`: connector interface, registry, real MVP connectors, and scaffolded future connectors.
- `sync/`: shared sync engine used by cron, manual buttons, initial sync, and webhooks.
- `tracking/`: `/api/track` validation plus JavaScript and React/Next tracking snippet generation.

Production rule: collect through official APIs, webhooks, first-party tracking, cron/scheduler, and manual sync buttons. Do not scrape dashboards as the normal data collection method.
