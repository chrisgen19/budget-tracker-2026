# Analytics telemetry

`GET /api/analytics` writes one structured JSON record to standard output for every request. It is intended for the application logs collected by Coolify, so operators can calculate request volume, error rate, database time, and p50/p95/p99 route latency.

The application does not write telemetry to PostgreSQL or send it to an external service. Coolify's configured log retention controls how long these records remain available; delete them through Coolify's log controls or let that retention expire them. This repository does not impose a production retention period.

Each record is named `analytics_request` and may include only:

- `outcome` and the coarse `errorCode`
- route and database duration in milliseconds
- fetched transaction-row count, chart-bucket count, and response size in bytes

It never includes a user identifier, request dates, amounts, transaction descriptions, category or label names, balances, or any analytics response content.
