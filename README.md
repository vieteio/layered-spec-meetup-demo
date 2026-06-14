# Construction Drawing Estimation — layered-spec example

This app was created with **layered-spec**: spec-first planning with an AI agent, then implementation driven from the workflow-bearing spec.

![Estimation results UI](assets/screenshot.png)

The screenshot shows a completed document detail page with parsed and estimation markdown rendered in the UI.

## Creation process

The planning and implementation trail is kept in this folder so you can review how the app was built:

- [`chats/`](chats/) — interactive session log with the AI agent
- [`specs/`](specs/) — workflow-bearing spec that drove implementation

## Runnable app

The service code lives in [`service/`](service/). See [`service/README.md`](service/README.md) for setup and API details.

```bash
cd service
cp .env.example .env
yarn install
yarn run db:push
yarn run dev
```
