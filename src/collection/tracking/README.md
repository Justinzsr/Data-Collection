# First-Party Tracking

The website connector collects events through `POST /api/track`.

Payload fields:
- `source_id` or `public_tracking_key`
- `anonymous_id`
- `session_id`
- `user_id` optional
- `event_name`
- `path`
- `url`
- `referrer`
- `user_agent`
- `properties`
- `occurred_at`

Validation limits event names and property payload size. Raw IP is not stored; if IP is used, it is hashed.
